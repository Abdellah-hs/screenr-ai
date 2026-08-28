import type { SupabaseDb } from "@/lib/supabase/types";
import {
  uploadResumeToStorage,
  upsertCandidate,
  createApplicationIfNotExists,
  logAiAudit,
} from "@/lib/data/candidates";
import {
  mergeApplicantIdentity,
  readResumeDocument,
  type ApplicantIdentity,
} from "./read-resume";
import type { ParsedResumeData } from "@/lib/services/openai";
import { evaluateResumeScoringOutcome } from "@/lib/rules/resume-scoring";
import { evaluateApplicationResume } from "@/lib/resume-ingest/score-resume";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";

/**
 * Why a CV was not ingested. Surfaced (not swallowed) so a candidate-facing
 * caller can explain the failure instead of silently dropping the applicant —
 * the Gmail intake paths only skip-and-log because there is no human waiting.
 *  - `unreadable`: Marker read the file and could not convert it
 *                  (corrupt/empty/unsupported). An extractor timeout or
 *                  outage is NOT this — that throws, because it is ours.
 *  - `not_a_cv`:   the document classified as a motivation letter / other.
 *  - `no_email`:   a CV with no extractable email (we never invent contact data).
 */
export type IngestRejectionReason = "unreadable" | "not_a_cv" | "no_email";

/**
 * What happened to one CV.
 *
 * `processing_failed` is the third arm because the alternative was losing the
 * applicant. Marker timing out, OpenAI refusing, Datalab returning a 502 — all
 * of it used to propagate out of here, and the caller could do nothing with an
 * exception except email the candidate and forget them. Nothing was written, so
 * nobody at the company ever knew somebody had applied.
 *
 * It carries an `applicationId` like a success does, because that is the point:
 * the person is in the pipeline, in an explicit failure state, with their CV in
 * storage and a retry available. See {@link recordProcessingFailure}.
 */
export type IngestResult =
  | { outcome: "ingested"; applicationId: string }
  | { outcome: "processing_failed"; applicationId: string }
  | { outcome: "rejected"; reason: IngestRejectionReason };

/**
 * Identity the applicant asserted themselves (e.g. typed into the apply form).
 * When present it is authoritative over whatever the AI extracts from the CV —
 * self-declared contact data beats inferred contact data — and it satisfies
 * the `no_email` requirement even when the CV itself carries no address.
 */
export type { ApplicantIdentity } from "./read-resume";

export interface IngestResumeArgs {
  /** Supabase client to use — admin (service-role) for session-less callers. */
  db: SupabaseDb;
  campaignId: string;
  /** Campaign owner — needed to load the (owner-scoped) scoring config. */
  ownerUserId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  /**
   * Tag persisted on the scoring audit row. Today there is exactly one value,
   * `"apply_form"` — the public apply page is the only intake channel (see the
   * 2026-08-23 decision in docs/prd.md 3.2.1, which retired inbox ingestion).
   * Kept as a field rather than inlined because the audit row should say where
   * a CV came from even once that is not a question, and because the LinkedIn
   * channels in the PRD would each be one.
   */
  source: string;
  /** Self-declared identity; overrides the CV-extracted name/email when set. */
  applicant?: ApplicantIdentity;
}

/**
 * The single resume-ingest pipeline for every channel that brings a CV into a
 * campaign — today just the public apply page. Runs entirely on the injected
 * `db` client, so a session-less caller (a cron sweep, a future channel) can
 * drive it exactly as the apply action does.
 *
 * Steps: extract text (Marker) → parse + classify (OpenAI) → upload the file →
 * upsert candidate → create/refresh application → AI audit → score → rule-driven
 * advance (Control > AI > Data; the rule decides, this only executes).
 *
 * Classification runs BEFORE the storage upload so a rejected document never
 * leaves an orphan file behind. Scoring is best-effort: a scoring/transition
 * failure is logged, not thrown — the application still lands in `new`, so the
 * caller still sees `ingested` and a recruiter can re-score manually.
 *
 * **A failure of OURS does not lose the applicant.** Extraction and
 * classification are the two steps that depend on somebody else's uptime, and
 * when either breaks the candidate is still filed — `processing_failed`, with
 * the CV stored and the identity they typed into the form — rather than thrown
 * away with an email asking them to apply again. See
 * {@link recordProcessingFailure}.
 */
export async function ingestResumeDocument(args: IngestResumeArgs): Promise<IngestResult> {
  const { db, campaignId, ownerUserId, filename, mimeType, buffer, source, applicant } = args;

  const read = await readResumeDocument(buffer, mimeType);

  if (read.outcome === "unreadable") {
    console.warn(`ingestResumeDocument: ${filename} could not be converted:`, read.cause);
    return { outcome: "rejected", reason: "unreadable" };
  }

  // An outage of OURS costs the applicant a delay, never their application:
  // file them at `processing_failed` off the identity the form already
  // validated, so a real person is in the pipeline and contactable.
  if (read.outcome === "failed") {
    console.error(`ingestResumeDocument: processing failed for ${filename}:`, read.cause);
    return recordProcessingFailure({
      db,
      campaignId,
      filename,
      buffer,
      applicant,
      cause: read.cause,
    });
  }

  if (read.outcome === "not_a_cv") {
    return { outcome: "rejected", reason: "not_a_cv" };
  }

  const { markdown, extracted } = read;

  // Candidate/application rows carry the merged identity; the AI audit below
  // keeps the raw extraction so the evidence stays untouched.
  const structured = mergeApplicantIdentity(extracted, markdown, applicant);
  if (!structured) {
    return { outcome: "rejected", reason: "no_email" };
  }

  const resumeUrl = await uploadResumeToStorage(campaignId, filename, buffer, db);

  const candidateId = await upsertCandidate(structured, db);
  const applicationId = await createApplicationIfNotExists(
    candidateId,
    campaignId,
    resumeUrl,
    structured,
    db,
  );
  await logAiAudit(
    { campaignId, candidateId, textContent: markdown, filename, structuredData: extracted },
    db,
  );

  // Best-effort: scoring must never undo a successful ingest.
  try {
    await scoreAndAdvance({
      db,
      applicationId,
      campaignId,
      candidateId,
      ownerUserId,
      parsed: structured,
      rawResumeText: markdown,
      source,
    });
  } catch (err) {
    console.error(`ingestResumeDocument: scoring failed for ${applicationId} (non-blocking):`, err);
  }

  return { outcome: "ingested", applicationId };
}

/**
 * Everything we know about somebody when the CV itself could not be read.
 *
 * The apply form asks for a name and an email and validates both, so a failed
 * extraction is not a failed application — the identifying half arrived by a
 * route that cannot time out. The CV-shaped fields are empty rather than
 * guessed, which is the same rule the extractor runs under: never invent
 * contact data.
 *
 * `document_type` says `cv` because the classifier never ran and this is what
 * the candidate submitted to a CV upload field. The alternative renders a
 * "this doesn't look like a CV" warning on their file over a document nothing
 * ever looked at. A retry replaces the whole parse with a real reading.
 */
function identityOnlyParse(applicant: ApplicantIdentity): ParsedResumeData & { email: string } {
  return {
    document_type: "cv",
    first_name: applicant.first_name,
    last_name: applicant.last_name,
    email: applicant.email,
    linkedin_url: applicant.linkedin_url ?? null,
    portfolio_url: applicant.portfolio_url ?? null,
    headline: null,
    summary: null,
    phone: null,
    location: null,
    github_url: null,
    skills: [],
    languages: [],
    interests: [],
    certifications: [],
    experience: [],
    education: [],
  };
}

/**
 * File an applicant whose CV we could not process, so that our outage costs
 * them a delay rather than their application.
 *
 * The candidate is a real person who filled in a form and pressed submit. When
 * Marker times out or OpenAI is down, the only thing actually missing is the
 * READING of their CV — we still have their name, their email and the file
 * itself. So all three are written down, and the application lands in
 * `processing_failed`: an explicit failure state, visible in the recruiter's
 * pipeline, recoverable by `reprocessFailedApplication`.
 *
 * This is CLAUDE.md's "every error path ends in an explicit failure state"
 * applied to the one path that did not have one.
 *
 * Two things it deliberately does NOT do:
 *
 * - **It does not score.** There is nothing to score against; the CV has not
 *   been read. `processing_failed` is not a verdict on the candidate and must
 *   never be reachable by the scoring rule.
 * - **It does not rescue a caller with no identity to file.** `applicant` is
 *   optional on the pipeline, and without it there is no name and no email —
 *   a row would be an anonymous CV nobody could act on or contact. The
 *   original failure is rethrown instead. Today the apply form always supplies
 *   one, so this is a guard on a future channel rather than a live path.
 */
async function recordProcessingFailure(args: {
  db: SupabaseDb;
  campaignId: string;
  filename: string;
  buffer: Buffer;
  applicant: ApplicantIdentity | undefined;
  cause: unknown;
}): Promise<IngestResult> {
  const { db, campaignId, filename, buffer, applicant, cause } = args;

  if (!applicant) throw cause;

  const structured = identityOnlyParse(applicant);

  // If THIS throws, our own database is down too, and there is no shape of
  // recovery left — the original failure goes to the caller as it always did.
  const resumeUrl = await uploadResumeToStorage(campaignId, filename, buffer, db);
  const candidateId = await upsertCandidate(structured, db);
  const applicationId = await createApplicationIfNotExists(
    candidateId,
    campaignId,
    resumeUrl,
    structured,
    db,
  );

  await transitionApplicationAsSystem(
    applicationId,
    "processing_failed",
    // The transitions log is where a recruiter finds out WHY, so the upstream
    // message goes in verbatim rather than being flattened to "failed".
    `Could not read the CV: ${cause instanceof Error ? cause.message : String(cause)}`,
  );

  return { outcome: "processing_failed", applicationId };
}

/**
 * Score one application's CV and let the rule decide where it goes.
 *
 * Exported so the retry path grades a recovered CV through the identical
 * function — a candidate whose ingest happened to fail must not end up scored
 * by a second implementation of the same step.
 */
export async function scoreAndAdvance(args: {
  db: SupabaseDb;
  applicationId: string;
  campaignId: string;
  candidateId: string;
  ownerUserId: string;
  parsed: ParsedResumeData;
  rawResumeText: string;
  source: string;
}): Promise<void> {
  const scored = await evaluateApplicationResume({
    db: args.db,
    applicationId: args.applicationId,
    campaignId: args.campaignId,
    candidateId: args.candidateId,
    ownerUserId: args.ownerUserId,
    parsedResume: args.parsed as unknown as Record<string, unknown>,
    rawResumeText: args.rawResumeText,
    source: args.source,
  });

  // No active resume criteria — nothing to score against; the application
  // stays `new` and a recruiter can score it once criteria exist.
  if (!scored) return;

  const decision = evaluateResumeScoringOutcome(scored.result, scored.config);
  await transitionApplicationAsSystem(
    args.applicationId,
    decision.toState,
    decision.rationale,
    decision.disposition,
  );
}
