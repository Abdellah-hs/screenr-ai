import type { SupabaseDb } from "@/lib/supabase/types";
import { logAiAudit, saveReprocessedResume } from "@/lib/data/candidates";
import { downloadResumeFromStorage } from "@/lib/data/candidates";
import { mergeApplicantIdentity, readResumeDocument } from "./read-resume";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";
import { resumeMimeTypeForPath } from "./mime";
import {
  scoreAndAdvance,
  type ApplicantIdentity,
  type IngestRejectionReason,
} from "@/lib/resume-ingest/ingest-resume";

/**
 * Re-run the reading of a CV that already has an application row.
 *
 * The other half of {@link recordProcessingFailure}: that one files an
 * applicant whose CV we could not read, this one reads it once the outage is
 * over. Without it `processing_failed` would be a graveyard — the only
 * transition out of it is `archived`, so an applicant lost to a five-minute
 * Marker blip would stay lost, which is where this whole problem started.
 *
 * It is a pipeline rather than an action body because it composes services →
 * data → rules → `transition()` and runs on an injected `db`; a cron sweep
 * that retried failures unattended would drive it exactly as the recruiter's
 * button does. Auth, validation and rate-limiting stay with the caller.
 *
 * The difference from `ingestResumeDocument` is that it must never create
 * anything. The candidate and the application already exist, and re-running
 * the ingest would insert a SECOND candidate row for the same person —
 * `upsertCandidate` deliberately always inserts and flags a duplicate rather
 * than merging, so a retry built on it would fill the duplicate queue with the
 * consequences of our own outage.
 */

export type ReprocessResult =
  | { outcome: "ingested" }
  | { outcome: "rejected"; reason: IngestRejectionReason };

export interface ReprocessArgs {
  db: SupabaseDb;
  applicationId: string;
  campaignId: string;
  candidateId: string;
  /** Campaign owner — needed to load the (owner-scoped) scoring config. */
  ownerUserId: string;
  /** Storage path written when the application was filed. */
  resumeUrl: string;
  /**
   * The identity the candidate typed into the apply form, read back off their
   * row. Still authoritative over anything the CV says, exactly as it was on
   * the first attempt — a retry must not rename somebody because the model
   * read a different name off their letterhead.
   */
  applicant: ApplicantIdentity;
  /**
   * The candidate's contact fields as they stand. A re-read fills the blanks a
   * failed ingest left behind; it never blanks a value that is already there,
   * because by the time somebody retries this a recruiter may have corrected
   * it by hand.
   */
  candidateContact: {
    phone: string | null;
    location: string | null;
    linkedin_url: string | null;
    github_url: string | null;
    portfolio_url: string | null;
  };
}

function firstNonBlank(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

/**
 * Read the stored CV again and, if it works this time, put the application
 * back where a successful ingest would have left it.
 *
 * Throws on a failure that is still ours — a second Marker timeout, OpenAI
 * still down, the file gone from storage. The application stays in
 * `processing_failed`, which is the honest outcome: nothing has changed, and
 * the caller can say so and offer the button again. Only a verdict about the
 * DOCUMENT comes back as a `rejected` result.
 */
export async function reprocessFailedApplication(args: ReprocessArgs): Promise<ReprocessResult> {
  const { db, applicationId, campaignId, candidateId, ownerUserId, resumeUrl, applicant } = args;

  const buffer = await downloadResumeFromStorage(resumeUrl, db);
  if (!buffer) {
    throw new Error(
      "This candidate's CV is no longer in storage, so it can't be processed again.",
    );
  }

  const mimeType = resumeMimeTypeForPath(resumeUrl);

  const read = await readResumeDocument(buffer, mimeType);

  // Only a verdict about the DOCUMENT comes back as a result. A retry that
  // fails the way the first attempt did changes nothing: the application stays
  // `processing_failed`, and the recruiter is told and offered the button
  // again.
  if (read.outcome === "unreadable") return { outcome: "rejected", reason: "unreadable" };
  if (read.outcome === "failed") throw read.cause;
  if (read.outcome === "not_a_cv") return { outcome: "rejected", reason: "not_a_cv" };

  const { markdown, extracted } = read;

  // Same merge as the first attempt — literally, so a CV cannot be READ two
  // different ways depending on which attempt read it. `applicant` always
  // carries an email here, so this cannot be null.
  const structured = mergeApplicantIdentity(extracted, markdown, applicant);
  if (!structured) return { outcome: "rejected", reason: "unreadable" };

  await saveReprocessedResume(
    {
      applicationId,
      candidateId,
      parsedData: structured,
      candidate: {
        phone: firstNonBlank(args.candidateContact.phone, structured.phone),
        location: firstNonBlank(args.candidateContact.location, structured.location),
        linkedin_url: firstNonBlank(args.candidateContact.linkedin_url, structured.linkedin_url),
        github_url: firstNonBlank(args.candidateContact.github_url, structured.github_url),
        portfolio_url: firstNonBlank(args.candidateContact.portfolio_url, structured.portfolio_url),
      },
    },
    db,
  );

  // The raw extraction, unfilled, so the evidence still says what the model
  // actually returned — the same rule the first-attempt audit row follows.
  await logAiAudit(
    {
      campaignId,
      candidateId,
      textContent: markdown,
      // The storage path, not the name the candidate uploaded — that was never
      // stored, and the path is what identifies the exact bytes re-read here.
      filename: resumeUrl,
      structuredData: extracted,
    },
    db,
  );

  // Back to where a working ingest would have left it. `new` rather than
  // straight to a scored state because the scoring rule owns that decision and
  // must reach it the same way it always does — a repair is not a verdict.
  await transitionApplicationAsSystem(
    applicationId,
    "new",
    "CV processed successfully on a retry",
  );

  // Best-effort, exactly as on the first attempt: a scoring failure must not
  // undo a recovery. The application rests in `new` and can be re-scored.
  try {
    await scoreAndAdvance({
      db,
      applicationId,
      campaignId,
      candidateId,
      ownerUserId,
      parsed: structured,
      rawResumeText: markdown,
      source: "reprocess",
    });
  } catch (err) {
    console.error(
      `reprocessFailedApplication: scoring failed for ${applicationId} (non-blocking):`,
      err,
    );
  }

  return { outcome: "ingested" };
}
