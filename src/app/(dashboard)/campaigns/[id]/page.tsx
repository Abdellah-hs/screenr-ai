import Link from "next/link";
import { Breadcrumb } from "@/components/ui";
import { notFound } from "next/navigation";
import { getAuthUser } from "@/lib/auth/guards";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getCampaignPipelineSummary } from "@/lib/actions/candidates";
import { getScreeningQuestions } from "@/lib/actions/screening-questions";
import { getLinkedInConnectionStatus } from "@/lib/actions/integrations";
import { fetchCampaignHistory } from "@/lib/data/transitions";
import RubricDisplay from "@/components/campaigns/rubric-display";
import ScreeningQuestionsEditor from "@/components/campaigns/screening-questions-editor";
import CloneCampaignButton from "@/components/campaigns/clone-campaign-button";
import { PipelineFunnel } from "@/components/campaigns/pipeline-funnel";
import { CampaignStatusChanger } from "@/components/campaigns/campaign-status-changer";
import { CampaignApplyLink } from "@/components/campaigns/campaign-apply-link";
import { SocialPostGenerator } from "@/components/campaigns/social-post-generator";
import {
  CampaignHistoryCard,
  CampaignReviewersCard,
  CampaignSlaCard,
} from "@/components/campaigns/campaign-run-card";
import { CAMPAIGN_DETAIL_TABS, resolveDetailTab } from "@/lib/campaigns/detail-view";
import { SLA_STAGES } from "@/lib/constants";
import { applyGateBlocker } from "@/lib/rules/campaign-status";
import { isTeamReviewersEnabled } from "@/lib/flags";
import { uuidSchema } from "@/lib/validations";

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  // A malformed id (e.g. /campaigns/undefined) is a 404 — bail before any of
  // the parallel fetches below run a query against a garbage uuid.
  if (!uuidSchema.safeParse(id).success) notFound();

  const { tab: requestedTab } = await searchParams;
  const tab = resolveDetailTab(requestedTab);

  // Every fetch below is owner-scoped in its own action; `getCampaignById`
  // returning null is what 404s a campaign the viewer does not own.
  const [campaign, pipeline, screeningQuestions, linkedInStatus, history] =
    await Promise.all([
      getCampaignById(id),
      // Counts, not candidates. This page renders nobody's name, so it asks for
      // the six numbers it draws rather than every applicant's parsed CV and
      // resume evaluation.
      getCampaignPipelineSummary(id),
      getScreeningQuestions(id),
      getLinkedInConnectionStatus(),
      fetchCampaignHistory(id).catch(() => []),
    ]);

  if (!campaign) {
    notFound();
  }

  // Reads the request-scoped memo the fetches above already filled, rather than
  // opening a Supabase client here: a page is not a data layer, and this was a
  // second serial round trip to the auth server for an email that only renders
  // when the team-reviewers flag is on.
  const ownerEmail = (await getAuthUser())?.email ?? "You";

  // The history card's clock. The pipeline counts carry their own reading,
  // taken inside `getCampaignPipelineSummary` alongside the rows it measured.
  const now = new Date();

  // Every count on this page comes from one pass in `summarisePipeline`, which
  // reads the same SLA rule the candidate table badges with — so the funnel,
  // the overdue banner and that list can never disagree about who is overdue.
  const {
    stageCounts,
    breachesByStage,
    overdueTotal,
    staleScoreCount,
    recentApplications,
    total: candidateCount,
  } = pipeline;

  const worstStage = SLA_STAGES.find((s) => (breachesByStage[s.key] ?? 0) > 0);

  // Two different questions, and conflating them is what let this page tell a
  // recruiter their link was taking CVs while the apply page turned candidates
  // away. `isActive` is about PROCESSING: draft/paused/closed freeze scoring
  // and screening sends. The apply link has two further gates on top of it —
  // the intake switch and an enforced deadline — so it reads the same rule the
  // public page reads rather than re-deriving one from the status.
  const isActive = campaign.status === "active";
  const applyBlocker = applyGateBlocker(campaign, now);

  const meta = [
    campaign.department,
    campaign.location,
    `${campaign.positions} ${campaign.positions === 1 ? "position" : "positions"}`,
    `${candidateCount} ${candidateCount === 1 ? "candidate" : "candidates"}`,
    campaign.created_at
      ? `created ${new Date(campaign.created_at).toLocaleDateString("en-US", {
          day: "numeric",
          month: "short",
        })}`
      : null,
  ].filter(Boolean);

  return (
    // Two tabs, two layouts, because they hold two different kinds of content.
    //
    // Pipeline is a dashboard — a funnel and two short cards — so from `lg` up
    // it claims the viewport and nothing scrolls but its rail.
    //
    // Setup is a document. Its panels are a rubric of three tables and a list
    // of questions, both of which run past any height you could give them, so
    // locking them to the viewport meant a fixed-height scroller slicing a
    // criterion (and a question) in half against a straight edge. Setup is
    // therefore ordinary flow: <main> scrolls, and every panel is whole.
    <div
      className={`mx-auto flex max-w-[1280px] flex-col ${
        tab === "pipeline" ? "lg:h-full" : ""
      }`}
    >
      {/* The trail carries the page's own actions: the navbar is a bell and
          nothing else, so Clone and Edit live in the body. */}
      <Breadcrumb
        className="mb-[18px] shrink-0"
        items={[
          { label: "Campaigns", href: "/campaigns" },
          { label: campaign.title },
        ]}
        actions={
          <>
            <CloneCampaignButton campaignId={campaign.id} />
            <Link
              href={`/campaigns/${campaign.id}/edit`}
              className="inline-flex min-h-10 items-center rounded-lg border border-[#D1D5DB] bg-white px-3.5 text-[13px] font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink"
            >
              Edit
            </Link>
          </>
        }
      />

      <div className="mb-6 min-w-0 shrink-0">
        <div className="mb-1.5 flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-[32px] font-semibold tracking-[-0.025em] text-ink">
            {campaign.title}
          </h1>
          <CampaignStatusChanger
            campaignId={campaign.id}
            currentStatus={campaign.status ?? "draft"}
            acceptingApplications={campaign.accepting_applications}
            applyBlocker={applyBlocker}
          />
        </div>
        <p className="text-sm text-[#6B7280]">{meta.join(" · ")}</p>
      </div>

      {/* Two jobs, two tabs. The daily half used to sit above a fold of
          configuration nobody reads that day. Links, not buttons: the tab is a
          URL, so this page stays a Server Component and Back works. */}
      <nav aria-label="Campaign sections" className="mb-6 flex shrink-0 items-center gap-1 border-b border-[#E5E7EB]">
        {CAMPAIGN_DETAIL_TABS.map((t) => {
          const current = t.key === tab;
          return (
            <Link
              key={t.key}
              href={`/campaigns/${id}?tab=${t.key}`}
              aria-current={current ? "page" : undefined}
              className={`-mb-px border-b-2 px-3.5 pb-2.5 pt-1 text-[13px] font-semibold transition-colors duration-150 ${
                current
                  ? "border-ink text-ink"
                  : "border-transparent text-[#6B7280] hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {/* Screening questions are a hard prerequisite: approving a candidate
          into screening is blocked until the campaign has them. Surface that
          up top instead of letting recruiters discover it on a candidate. */}
      {screeningQuestions.length === 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3.5">
          <svg
            className="mt-px h-4 w-4 shrink-0 text-[#B45309]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
            />
          </svg>
          <p className="text-[13px] leading-[1.55] text-[#92400E]">
            This campaign has no screening questions yet — candidates can&apos;t be
            approved into screening until it does.{" "}
            <Link
              href={`/campaigns/${id}?tab=setup#screening-questions`}
              className="font-semibold underline hover:text-[#78350F]"
            >
              Set up screening questions
            </Link>
          </p>
        </div>
      )}

      {/* Amber, not red: nobody has been rejected and nothing has failed. The
          copy is the point — a timer that reads as automation is one a
          recruiter assumes is handling it. */}
      {overdueTotal > 0 && worstStage && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3.5">
          <span className="mt-px shrink-0 text-[#B45309]">
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 text-sm font-semibold text-[#92400E]">
              {overdueTotal} {overdueTotal === 1 ? "candidate is" : "candidates are"} past
              the {worstStage.name} SLA
            </p>
            <p className="text-[13px] leading-[1.55] text-[#92400E]">
              The timer only alerts — it never rejects, and it never advances.{" "}
              {overdueTotal === 1 ? "They are" : "They are all"} still sitting in{" "}
              {worstStage.name} waiting for a person.
            </p>
          </div>
          <Link
            href={`/campaigns/${id}/candidates?overdue=1`}
            className="inline-flex min-h-10 shrink-0 items-center rounded-lg border border-[#FDE68A] bg-white px-3.5 text-[13px] font-semibold text-[#92400E] transition-colors duration-150 hover:bg-[#FFFBEB]"
          >
            {overdueTotal === 1 ? "Show the one" : `Show the ${overdueTotal}`}
          </Link>
        </div>
      )}

      {tab === "pipeline" && (
        <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:[grid-template-columns:minmax(0,1.62fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6 lg:min-h-0">
          <section className="shrink-0 rounded-xl border border-[#E5E7EB] bg-white p-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <div className="mb-4 flex items-center justify-between gap-3.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
                Pipeline
              </h2>
              {/* The link, not an instruction. "Click a stage to see who is in
                  it" described the in-page preview that used to sit below; with
                  that gone a stage click opens the real table, and the header
                  says where it goes rather than what to do. */}
              <Link
                href={`/campaigns/${id}/candidates`}
                className="text-[13px] font-semibold text-primary hover:underline"
              >
                Open the full table →
              </Link>
            </div>

            {!isActive && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[13px] text-[#92400E]">
                <svg
                  className="mt-0.5 h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
                <span>
                  This campaign is{" "}
                  <span className="font-medium capitalize">{campaign.status}</span>. New
                  applications and screening are paused — set it to{" "}
                  <span className="font-medium">Active</span> to process candidates.
                </span>
              </div>
            )}

            <PipelineFunnel
              campaignId={id}
              stageCounts={stageCounts}
              total={candidateCount}
              hrefFor={(key) => `/campaigns/${id}/candidates?stage=${key}`}
            />
          </section>

          </div>

          {/* ── Right rail · Pipeline ── what the campaign is doing now. */}
          <div className="flex flex-col gap-6 lg:min-h-0 lg:overflow-y-auto">
            <CampaignSlaCard
              campaignId={campaign.id}
              timers={campaign.sla_timers}
              breachesByStage={breachesByStage}
            />

            <CampaignHistoryCard campaignId={campaign.id} entries={history} now={now} />
          </div>
        </div>
      )}

      {tab === "setup" && (
        // A 340px rail, not a 1fr one. The right column carries two small
        // utility cards; at `1fr` it took 37% of the page and spent most of it
        // on white space, while the rubric table it was taking the width from
        // was the thing being squeezed into a scroller. `items-start` so a
        // short rail simply ends instead of stretching to the tall column.
        <div className="grid items-start gap-6 lg:[grid-template-columns:minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-6">
            {/* Evaluation rubrics (the resume rubric drives CV scoring — #65).
                Natural height, both of them: whichever is longer is longer,
                and the page carries it.

                Rendered unconditionally now that the card can be edited in
                place — a campaign with no rubric is exactly the one that needs
                the button, and hiding the card hid the button with it. */}
            <RubricDisplay
              rubrics={campaign.rubrics}
              campaignId={campaign.id}
              staleScoreCount={staleScoreCount}
              description={campaign.description ?? undefined}
            />

            {/* Screening Questions — the anchor is the target of the empty-set
                banner above and of the pointer on the edit page. */}
            <div id="screening-questions" className="scroll-mt-6">
              <ScreeningQuestionsEditor
                campaignId={id}
                initialQuestions={screeningQuestions.map((q) => ({
                  id: q.id,
                  prompt: q.prompt,
                }))}
                canGenerate={(campaign.description?.trim().length ?? 0) >= 10}
                // The screening rubric these answers are scored against — used
                // to warn when a dimension has no question, and to draft
                // questions that probe the rubric, not the description alone.
                rubricDimensions={
                  campaign.rubrics
                    .find((r) => r.stage === "screening_q")
                    ?.dimensions.map((d) => ({ id: d.id, name: d.name })) ?? []
                }
              />
            </div>
          </div>

          {/* ── Right rail · Setup ── everything that brings candidates in.
              One heading over both cards, because "apply link" and "social
              post" are one job seen twice, and a rail of unrelated boxes is
              what made this column read as leftovers. */}
          <div className="flex flex-col gap-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
              Bringing candidates in
            </h2>

            {campaign.public_slug ? (
              <CampaignApplyLink
                slug={campaign.public_slug}
                blocker={applyBlocker}
                recentApplications={recentApplications}
              />
            ) : (
              // Said, not hidden. Rendering nothing left the rail looking
              // merely empty while the card below it drafted posts with no
              // link in them — the recruiter's next move depends on knowing
              // which of the two happened.
              <div className="rounded-xl border border-[#E5E7EB] bg-white p-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
                  Public apply link
                </h3>
                <p className="text-[13px] leading-[1.55] text-[#6B7280]">
                  This campaign has no public apply link, so there is no page to
                  share and a drafted post will not carry one.
                </p>
              </div>
            )}

            {/* AI social-post generator — drafts shareable "we're hiring" copy
                per channel (review-then-post; nothing publishes on its own). */}
            <SocialPostGenerator
              title={campaign.title}
              description={campaign.description}
              department={campaign.department}
              location={campaign.location}
              slug={campaign.public_slug}
              linkedInConnected={linkedInStatus.connected}
            />

            {/* Reviewers are behind the same flag as the editor that creates
                them: `campaign_reviewers` grants nothing under RLS yet (#132),
                so listing people here would advertise access they lack.

                Outside the heading above, and spaced away from it: who reviews
                this campaign is not part of bringing candidates in. */}
            {isTeamReviewersEnabled() && (
              <div className="mt-2">
                <CampaignReviewersCard
                  ownerEmail={ownerEmail}
                  reviewers={campaign.reviewers.map((r) => ({
                    id: r.id,
                    name: r.name,
                    email: r.email,
                    role: r.role,
                  }))}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
