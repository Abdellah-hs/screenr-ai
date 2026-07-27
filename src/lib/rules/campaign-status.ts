import {
  CAMPAIGN_STATUSES,
  type CampaignStatus,
  type CampaignStatusSelection,
} from "@/lib/constants";

/**
 * Campaign-status options. Campaign status is a lightweight lifecycle label
 * (draft / active / paused / closed), NOT the candidate pipeline
 * state machine — so a recruiter sets it freely, exactly like the Edit campaign
 * form already allows. There is no transition graph to enforce; these helpers
 * only decide which options to *offer* (everything except the status a campaign
 * already has, which would be a no-op).
 *
 * This is distinct from the Application state machine, where transitions ARE
 * constrained and go through transitionApplication().
 */

const ALL_STATUSES: CampaignStatus[] = CAMPAIGN_STATUSES.map((s) => s.value);

/**
 * Whether a campaign in this status processes candidates. Only `active` does —
 * draft / paused / closed all freeze the pipeline: no resume sync,
 * no scoring, no outbound screening/interview email. (Recruiters can still view
 * and configure a frozen campaign, and still *reject* a candidate — a stop, not
 * processing.)
 */
export function isCampaignProcessingActive(status: CampaignStatus): boolean {
  return status === "active";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a campaign's application deadline has passed, treating the deadline
 * DAY as inclusive: applications close at the end of the deadline day (UTC), so
 * a deadline of 2026-07-25 accepts through 2026-07-25T23:59:59.999Z and is
 * "passed" from 2026-07-26T00:00:00Z onward. A null/blank/unparseable deadline
 * is never passed.
 */
export function isDeadlinePassed(deadline: string | null, now: Date): boolean {
  if (!deadline) return false;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return false;
  const endOfDeadlineDay =
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + DAY_MS;
  return now.getTime() >= endOfDeadlineDay;
}

/** The campaign fields that decide whether the public apply page accepts CVs. */
export interface CampaignApplyGate {
  status: CampaignStatus;
  accepting_applications: boolean;
  deadline: string | null;
  deadline_enforced: boolean;
}

/**
 * Whether the public apply page should accept a new application right now. Three
 * gates, all required: the campaign must be processing (active); the recruiter's
 * manual intake switch (`accepting_applications`) must be on; AND — only when
 * they opted into deadline enforcement — the deadline must not have passed. An
 * unenforced deadline never blocks applications (it's informational). This is
 * the single decision the apply action reads.
 */
export function isCampaignAcceptingApplications(
  campaign: CampaignApplyGate,
  now: Date,
): boolean {
  if (!isCampaignProcessingActive(campaign.status)) return false;
  if (!campaign.accepting_applications) return false;
  if (campaign.deadline_enforced && isDeadlinePassed(campaign.deadline, now)) {
    return false;
  }
  return true;
}

/**
 * Decode the form's status dropdown value into the two persisted fields. The
 * `active_no_intake` UI token means "active but closed to new applications";
 * every other value is a real lifecycle status that leaves intake open. Unknown
 * values fall back to `draft` (fail-safe: not accepting).
 */
export function decodeStatusSelection(selection: string): {
  status: CampaignStatus;
  accepting_applications: boolean;
} {
  if (selection === "active_no_intake") {
    return { status: "active", accepting_applications: false };
  }
  const known = ALL_STATUSES.find((s) => s === selection);
  return { status: known ?? "draft", accepting_applications: true };
}

/** Inverse of decodeStatusSelection — pick the dropdown value for a campaign. */
export function encodeStatusSelection(
  status: CampaignStatus,
  acceptingApplications: boolean,
): CampaignStatusSelection {
  if (status === "active" && !acceptingApplications) return "active_no_intake";
  return status;
}

const ALL_STATUS_SELECTIONS: CampaignStatusSelection[] = [
  "draft",
  "active",
  "active_no_intake",
  "paused",
  "closed",
];

/**
 * Selections the inline changer offers — every option except the campaign's
 * current one (setting it to what it already is would be a no-op). Mirrors
 * `settableCampaignStatuses` but over the 5-option status+intake dropdown.
 */
export function settableStatusSelections(
  current: CampaignStatusSelection,
): CampaignStatusSelection[] {
  return ALL_STATUS_SELECTIONS.filter((s) => s !== current);
}

/** Guard: throws unless the campaign is active, freezing all candidate processing. */
export function assertCampaignActive(status: CampaignStatus): void {
  if (!isCampaignProcessingActive(status)) {
    throw new Error(
      `This campaign is ${status}. Set it to Active to sync resumes, score candidates, or send screening.`,
    );
  }
}

/** Statuses a single campaign can be set to — every status except its current one. */
export function settableCampaignStatuses(
  current: CampaignStatus,
): CampaignStatus[] {
  return ALL_STATUSES.filter((s) => s !== current);
}

/**
 * Statuses offered for a multi-selection: every status, minus any that ALL
 * selected campaigns already share (setting them to it would be a no-op for the
 * whole selection). For a mixed selection this is the full set, so
 * "select all → set status" always has options.
 */
export function commonSettableCampaignStatuses(
  currents: CampaignStatus[],
): CampaignStatus[] {
  if (currents.length === 0) return [];
  return ALL_STATUSES.filter((s) => !currents.every((c) => c === s));
}
