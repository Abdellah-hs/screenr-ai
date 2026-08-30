import { eventLabel } from "@/lib/campaigns/detail-view";
import { AI_AUDIT_STAGES, type ApplicationState } from "@/lib/constants";
import type { AuditLogEntry, AuditLogQuery } from "@/lib/data/audit-log";

/**
 * How the audit log READS — pure, so the table is left with rendering only.
 *
 * Most of what is here exists to stop a blank cell lying. An audit row is
 * evidence, and "—" in a score column is ambiguous between three different
 * facts: this stage produces no score at all, this candidate failed a must-have
 * and is therefore never ranked, or nothing was recorded. Each of those sends a
 * reader somewhere different, so each gets its own words.
 */

// ─── Stage ───────────────────────────────────────────────────────────────────

/**
 * Which pipeline family a stage belongs to, so the badge can borrow the stage
 * palette the candidate table already uses. A recruiter should not have to
 * learn a second colour language for this page.
 */
export type AuditStageTone = "resume" | "screening" | "interview" | "other";

export function auditStageTone(stage: string): AuditStageTone {
  if (stage.startsWith("resume")) return "resume";
  if (stage.startsWith("screening")) return "screening";
  if (stage.startsWith("interview")) return "interview";
  return "other";
}

const STAGE_LABEL = new Map<string, string>(
  AI_AUDIT_STAGES.map((s) => [s.value as string, s.label]),
);

/**
 * `stage` is a text column, so a row written by a future AI call must still
 * render. An unknown value is title-cased rather than blanked — a cell that
 * disappears is worse than one that reads a little raw.
 */
export function auditStageLabel(stage: string): string {
  const known = STAGE_LABEL.get(stage);
  if (known) return known;
  return stage
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ─── Score ───────────────────────────────────────────────────────────────────

export type AuditScoreCell =
  | { kind: "score"; value: number; unit: "rank" | "/100" }
  | { kind: "absent"; label: string; hint: string };

/**
 * The number, or the reason there isn't one.
 *
 * The unit is not decoration either: a résumé score is a RANKING over the
 * criteria, not a grade out of a hundred, and printing "/100" beside it would
 * claim an accuracy it does not have. Same rule as `ScoreInline`.
 */
export function auditScoreCell(
  entry: Pick<AuditLogEntry, "stage" | "parsed_score">,
): AuditScoreCell {
  if (entry.parsed_score != null) {
    return {
      kind: "score",
      value: entry.parsed_score,
      unit: entry.stage === "resume_scoring" ? "rank" : "/100",
    };
  }

  if (entry.stage.startsWith("resume") && entry.stage !== "resume_scoring") {
    return {
      kind: "absent",
      label: "No score",
      hint: "Résumé parsing extracts fields from the document. It produces no score.",
    };
  }

  if (entry.stage === "resume_scoring") {
    return {
      kind: "absent",
      label: "Not ranked",
      hint: "A résumé ranking is null when a must-have criterion failed — an ineligible candidate is never ranked.",
    };
  }

  return {
    kind: "absent",
    label: "Not recorded",
    hint: "This decision recorded no score.",
  };
}

// ─── Candidate ───────────────────────────────────────────────────────────────

export type AuditCandidateCell =
  | { kind: "named"; text: string; hint: null }
  | { kind: "absent"; text: string; hint: string };

/**
 * Who the decision was about — and, when nobody is named, WHY.
 *
 * The two blanks are different facts. `candidate_id` is null on the earliest
 * evidence in a person's history, because résumé parsing runs before a
 * candidate row exists; a candidate that exists with no name on it is a parse
 * that came back without one. Rendering both as "—" hid the difference.
 */
export function auditCandidateCell(
  entry: Pick<AuditLogEntry, "candidate_id" | "candidate_name">,
): AuditCandidateCell {
  if (entry.candidate_name) return { kind: "named", text: entry.candidate_name, hint: null };

  if (entry.candidate_id === null) {
    return {
      kind: "absent",
      text: "Not linked yet",
      hint: "Logged before a candidate record existed — résumé parsing runs first.",
    };
  }

  return {
    kind: "absent",
    text: "Unnamed candidate",
    hint: "A candidate record exists, but the parse returned no name.",
  };
}

// ─── Recruiter action ────────────────────────────────────────────────────────

/**
 * `interview_invited` → "Interview invite sent". One map with the candidate
 * timeline, so the same event cannot be named two ways in two places.
 *
 * The column is `text`, not the enum, so an unrecognised value falls through
 * `eventLabel`'s own title-casing rather than throwing.
 */
export function recruiterActionLabel(toState: string): string {
  return eventLabel(toState as ApplicationState);
}

// ─── Filters + pager ─────────────────────────────────────────────────────────

/** `page` is pagination, not a narrowing, so it is deliberately not counted. */
const FILTER_KEYS = [
  "campaignId",
  "candidateId",
  "stage",
  "from",
  "to",
  "overriddenOnly",
] as const;

export function activeAuditFilterCount(filters: AuditLogQuery): number {
  return FILTER_KEYS.filter((key) => {
    const value = filters[key];
    return value !== undefined && value !== "" && value !== false;
  }).length;
}

/**
 * "1–50 of 171", or the plain count when everything fits on one page — a range
 * that spans the whole set is noise dressed as precision.
 */
export function auditRangeLabel(page: number, pageSize: number, total: number): string {
  if (total === 0) return "No decisions";
  if (total <= pageSize) return `${total} decision${total === 1 ? "" : "s"}`;

  const first = page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, total);
  return `${first}–${last} of ${total}`;
}

export function auditPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

// ─── Time ────────────────────────────────────────────────────────────────────

export interface AuditTimeParts {
  /** "25 Aug 2026" — the year is never dropped; an audit trail outlives a year. */
  date: string;
  /** "23:27" */
  time: string;
  /** The long form, for a title attribute. */
  full: string;
}

export function auditTimeParts(iso: string, timeZone?: string): AuditTimeParts {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "Unknown date", time: "", full: iso };

  return {
    date: d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone,
    }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }),
    full: d.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "medium", timeZone }),
  };
}
