import type { Metadata } from "next";
import CampaignWizard from "@/components/campaigns/campaign-wizard";

export const metadata: Metadata = {
  title: "New campaign · Screenr AI",
};

/**
 * Creating a campaign is the one recruiter screen with no sidebar and no
 * navbar. It sits outside the `(dashboard)` group on purpose: this is a single
 * task with five steps and one way out, and the surrounding navigation is only
 * an invitation to abandon it halfway. The brand mark holds the sidebar's own
 * position at the left edge, so the missing chrome reads as this page's layout
 * rather than as a page that failed to render its own.
 *
 * Route protection is unaffected — `src/middleware.ts` matches on the path,
 * not the route group, and `createCampaign` re-checks the session anyway.
 */
export default function NewCampaignPage() {
  return <CampaignWizard />;
}
