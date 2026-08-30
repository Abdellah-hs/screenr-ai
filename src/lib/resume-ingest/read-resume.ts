import { extractMarkdownWithMarker, isUnreadableDocument } from "@/lib/services/marker";
import { extractResumeData, type ParsedResumeData } from "@/lib/services/openai";
import { organisationsNamedOn, withHarvestedLinks } from "./contact-links";

/**
 * Reading a CV, shared by every path that does it.
 *
 * `ingestResumeDocument` and `reprocessFailedApplication` had this twice,
 * line for line: the same Marker+extract pair in one try, the same
 * unreadable/ours verdict split, the same `document_type` check, the same
 * harvest with the same organisation list, the same identity merge. Every one
 * of those is a decision with a failure behind it, and a fork meant a change to
 * any of them silently applied to first attempts and not to retries.
 *
 * This is the reading half only. What each caller does with a rejection differs
 * and stays with the caller — ingest records a `processing_failed` application
 * so the applicant is still filed; a retry simply rethrows.
 */

/**
 * Who the applicant said they are, from a channel that cannot time out.
 *
 * This is what makes a failed extraction survivable: the apply form asks for a
 * name and an email and validates both, so an application whose CV could not be
 * read is still a person somebody can contact.
 */
export interface ApplicantIdentity {
  first_name: string;
  last_name: string;
  email: string;
  /** Normalized profile links; null/absent means the candidate left them blank. */
  linkedin_url?: string | null;
  portfolio_url?: string | null;
}

export type ResumeRead =
  | { outcome: "read"; markdown: string; extracted: ParsedResumeData }
  /**
   * Marker read the file and said it could not convert it. A verdict on the
   * DOCUMENT, and the only one the candidate is ever told: "we couldn't read
   * that file, upload a clear PDF."
   */
  | { outcome: "unreadable"; cause: unknown }
  /**
   * Our extractor timing out, our key being unset, Datalab returning a 502.
   * Says nothing about their CV, and must never be reported as though it did.
   */
  | { outcome: "failed"; cause: unknown }
  /** A motivation letter or something else. Read fine; not a CV. */
  | { outcome: "not_a_cv" };

/**
 * Extract one document to markdown and read it into structured fields.
 *
 * The two steps that depend on somebody else's uptime are taken together,
 * because they fail the same way and are recovered the same way.
 */
export async function readResumeDocument(
  buffer: Buffer,
  mimeType: string,
): Promise<ResumeRead> {
  let markdown: string;
  let extracted: ParsedResumeData;
  try {
    markdown = (await extractMarkdownWithMarker(buffer, mimeType)).markdown;
    extracted = await extractResumeData(markdown);
  } catch (err) {
    return isUnreadableDocument(err)
      ? { outcome: "unreadable", cause: err }
      : { outcome: "failed", cause: err };
  }

  if (extracted.document_type !== "cv") return { outcome: "not_a_cv" };
  return { outcome: "read", markdown, extracted };
}

/**
 * The parsed CV merged with what the candidate typed, ready to persist.
 *
 * Two rules, and both are load-bearing:
 *
 * - **The harvest fills only blanks.** A contact link is a URL, not prose, and
 *   Marker hands most of them over as a markdown target behind the word
 *   "LinkedIn" — which the extractor, told to read the document and invent
 *   nothing, routinely returns null for. It can add a link, never change one,
 *   and only from URLs literally present in the markdown. The employers and
 *   schools it read are passed in so a company's own website cannot be
 *   harvested as the candidate's personal site.
 * - **Self-declared beats extracted.** What they typed wins; a blank optional
 *   link falls back to whatever the CV carries.
 *
 * Returns null when there is no email from either source — a row nobody could
 * contact. The raw `extracted` is untouched, so the audit row can still record
 * exactly what the model returned.
 */
export function mergeApplicantIdentity(
  extracted: ParsedResumeData,
  markdown: string,
  applicant?: ApplicantIdentity,
): (ParsedResumeData & { email: string }) | null {
  const email = applicant?.email ?? extracted.email;
  if (email == null) return null;

  const linked = withHarvestedLinks(extracted, markdown, organisationsNamedOn(extracted));

  return {
    ...linked,
    ...(applicant
      ? {
          first_name: applicant.first_name,
          last_name: applicant.last_name,
          linkedin_url: applicant.linkedin_url ?? linked.linkedin_url,
          portfolio_url: applicant.portfolio_url ?? linked.portfolio_url,
        }
      : {}),
    email,
  };
}
