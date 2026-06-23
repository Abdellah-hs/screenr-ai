import { fetchCampaignStatus } from "@/lib/data/campaigns";
import { assertCampaignActive } from "@/lib/rules/campaign-status";

/**
 * Fetch a campaign's status (owner-scoped) and throw unless it's Active. The
 * shared chokepoint for "freeze everything when not Active": every recruiter
 * action that ingests, scores, or contacts candidates calls this before doing
 * work, so a draft / paused / closed campaign never processes
 * candidates. The status lookup is scoped to `userId`, so it doubles as an
 * ownership check.
 */
export async function assertCampaignActiveById(
  campaignId: string,
  userId: string,
): Promise<void> {
  const status = await fetchCampaignStatus(campaignId, userId);
  if (!status) throw new Error("Campaign not found or access denied");
  assertCampaignActive(status);
}
