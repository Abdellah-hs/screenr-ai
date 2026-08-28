import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CampaignWizard from "@/components/campaigns/campaign-wizard";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getScreeningQuestions } from "@/lib/actions/screening-questions";

export const metadata: Metadata = {
  title: "Edit campaign · Screenr AI",
};

/**
 * Editing a campaign runs the same five-step wizard as creating one, seeded
 * from the row. It therefore sits outside `(dashboard)` alongside
 * `/campaigns/new`, for the same reason: one task, one way out, and the
 * surrounding navigation is only an invitation to abandon it halfway.
 *
 * Route protection is unaffected — `src/middleware.ts` matches on the path, not
 * the route group, and `updateCampaign` re-checks the session anyway.
 *
 * A Server Component, unlike the client-side form it replaced: the campaign and
 * its questions are fetched before anything renders, so the page arrives filled
 * in rather than as a skeleton that fills itself in a second later.
 */
export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Questions live on their own table rather than on the campaign row, so they
  // are fetched alongside it — concurrently, since neither read depends on the
  // other and both are owner-scoped in their own actions.
  const [campaign, questions] = await Promise.all([
    getCampaignById(id),
    getScreeningQuestions(id),
  ]);
  if (!campaign) notFound();

  return (
    <CampaignWizard
      campaign={campaign}
      initialQuestions={questions.map((q) => ({ id: q.id, prompt: q.prompt }))}
    />
  );
}
