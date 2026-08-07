import type { SupabaseDb } from "@/lib/supabase/types";
import type { Database } from "@/types/database.types";
import {
  uploadResumeToStorage,
  upsertCandidate,
  createApplicationIfNotExists,
  logAiAudit,
  saveResumeScore,
} from "@/lib/data/candidates";
import {
  fetchCampaignScoringConfig,
  fetchActiveRubricVersion,
} from "@/lib/data/campaigns";
import { extractMarkdownWithMarker } from "@/lib/services/marker";
import {
  extractResumeData,
  scoreResumeAgainstCriteria,
  type ParsedResumeData,
} from "@/lib/services/openai";
import { evaluateResumeScoringOutcome } from "@/lib/rules/resume-scoring";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";

type ScreeningTierEnum = Database["public"]["Enums"]["screening_tier_enum"];

/**
 * Why a CV was not ingested. Surfaced (not swallowed) so a candidate-facing
 * caller can explain the failure instead of silently dropping the applicant —
 * the Gmail intake paths only skip-and-log because there is no human waiting.
 *  - `unreadable`: Marker could not extract text (corrupt/empty/unsupported).
 *  - `not_a_cv`:   the document classified as a motivation letter / other.
 *  - `no_email`:   a CV with no extractable email (we never invent contact data).
 */
export type IngestRejectionReason = "unreadable" | "not_a_cv" | "no_email";

export type IngestResult =
  | { outcome: "ingested"; applicationId: string }
  | { outcome: "rejected"; reason: IngestRejectionReason };

/**
 * Identity the applicant asserted themselves (e.g. typed into the apply form).
 * When present it is authoritative over whatever the AI extracts from the CV —
 * self-declared contact data beats inferred contact data — and it satisfies
 * the `no_email` requirement even when the CV itself carries no address.
 */
export interface ApplicantIdentity {
  first_name: string;
  last_name: string;
  email: string;
  /** Normalized profile links; null/absent means the candidate left them blank. */
  linkedin_url?: string | null;
  portfolio_url?: string | null;
}

export interface IngestResumeArgs {
  /** Supabase client to use — admin (service-role) for session-less callers. */
  db: SupabaseDb;
  campaignId: string;
  /** Campaign owner — needed to load the (owner-scoped) scoring config. */
  ownerUserId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  /** Tag persisted on the scoring audit row (e.g. "apply_form", "gmail_sync"). */
  source: string;
  /** Self-declared identity; overrides the CV-extracted name/email when set. */
  applicant?: ApplicantIdentity;
}

/**
 * The single resume-ingest pipeline, shared by every channel that brings a CV
 * into a campaign (Gmail sweep, public apply form, …). Runs entirely on the
 * injected `db` client so it works without a recruiter session.
 *
 * Steps: extract text (Marker) → parse + classify (OpenAI) → upload the file →
 * upsert candidate → create/refresh application → AI audit → score → rule-driven
 * advance (Control > AI > Data; the rule decides, this only executes).
 *
 * Classification runs BEFORE the storage upload so a rejected document never
 * leaves an orphan file behind. Scoring is best-effort: a scoring/transition
 * failure is logged, not thrown — the application still lands in `new`, so the
 * caller still sees `ingested` and a recruiter can re-score manually.
 */
export async function ingestResumeDocument(args: IngestResumeArgs): Promise<IngestResult> {
  const { db, campaignId, ownerUserId, filename, mimeType, buffer, source, applicant } = args;

  let markdown: string;
  try {
    markdown = (await extractMarkdownWithMarker(buffer, mimeType)).markdown;
  } catch (err) {
    console.warn(`ingestResumeDocument: Marker extraction failed for ${filename}:`, err);
    return { outcome: "rejected", reason: "unreadable" };
  }

  const extracted = await extractResumeData(markdown);
  if (extracted.document_type !== "cv") {
    return { outcome: "rejected", reason: "not_a_cv" };
  }
  const email = applicant?.email ?? extracted.email;
  if (email == null) {
    return { outcome: "rejected", reason: "no_email" };
  }

  // Candidate/application rows carry the merged identity (self-declared wins,
  // but a blank optional link falls back to whatever the CV carries); the AI
  // audit below keeps the raw extraction so the evidence stays untouched.
  const structured: ParsedResumeData & { email: string } = {
    ...extracted,
    ...(applicant
      ? {
          first_name: applicant.first_name,
          last_name: applicant.last_name,
          linkedin_url: applicant.linkedin_url ?? extracted.linkedin_url,
          portfolio_url: applicant.portfolio_url ?? extracted.portfolio_url,
        }
      : {}),
    email,
  };

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
    await scoreAndAdvance({ db, applicationId, campaignId, candidateId, ownerUserId, parsed: structured, source });
  } catch (err) {
    console.error(`ingestResumeDocument: scoring failed for ${applicationId} (non-blocking):`, err);
  }

  return { outcome: "ingested", applicationId };
}

async function scoreAndAdvance(args: {
  db: SupabaseDb;
  applicationId: string;
  campaignId: string;
  candidateId: string;
  ownerUserId: string;
  parsed: ParsedResumeData;
  source: string;
}): Promise<void> {
  const { db, applicationId, campaignId, candidateId, ownerUserId, parsed, source } = args;

  const config = await fetchCampaignScoringConfig(campaignId, ownerUserId, db);
  // No active criteria → nothing to score against; the application stays `new`.
  if (!config || config.screening_criteria.length === 0) return;

  const [evidence, rubricVersion] = await Promise.all([
    scoreResumeAgainstCriteria(parsed, config.screening_criteria, config.description),
    fetchActiveRubricVersion(campaignId, "resume", db),
  ]);

  await saveResumeScore(
    {
      applicationId,
      campaignId,
      candidateId,
      score: evidence.result.overall_score,
      tier: evidence.result.tier as ScreeningTierEnum,
      rationale: evidence.result.rationale,
      factors: evidence.result.factors,
      rubricVersion,
      audit: {
        model: evidence.model,
        promptVersion: evidence.promptVersion,
        rawOutput: evidence.rawOutput,
        inputSnapshot: {
          criteria_count: config.screening_criteria.length,
          source,
        },
      },
    },
    db,
  );

  const decision = evaluateResumeScoringOutcome(evidence.result, config);
  await transitionApplicationAsSystem(
    applicationId,
    decision.toState,
    decision.rationale,
    decision.disposition,
  );
}
