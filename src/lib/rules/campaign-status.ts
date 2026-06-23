import { CAMPAIGN_STATUSES, type CampaignStatus } from "@/lib/constants";

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
