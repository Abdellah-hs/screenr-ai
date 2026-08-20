import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getCandidatesByCampaignId } from "@/lib/actions/candidates";
import { getScreeningQuestions } from "@/lib/actions/screening-questions";
import { getLinkedInConnectionStatus } from "@/lib/actions/integrations";
import { fetchCampaignHistory } from "@/lib/data/transitions";
import RubricDisplay from "@/components/campaigns/rubric-display";
import ScreeningQuestionsEditor from "@/components/campaigns/screening-questions-editor";
import CloneCampaignButton from "@/components/campaigns/clone-campaign-button";
import { PipelineFunnel, FUNNEL_STAGES } from "@/components/campaigns/pipeline-funnel";
import { CampaignStatusChanger } from "@/components/campaigns/campaign-status-changer";
import { CampaignApplyLink } from "@/components/campaigns/campaign-apply-link";
import { SocialPostGenerator } from "@/components/campaigns/social-post-generator";
import { CampaignStagePreview } from "@/components/campaigns/campaign-stage-preview";
import {
  CampaignHistoryCard,
  CampaignReviewersCard,
  CampaignRunCard,
  CampaignSlaCard,
} from "@/components/campaigns/campaign-run-card";
import { defaultPreviewStage } from "@/lib/campaigns/detail-view";
import { SLA_STAGES } from "@/lib/constants";
import { isTeamReviewersEnabled } from "@/lib/flags";
import { uuidSchema } from "@/lib/validations";

const SEVEN_DAYS_MS = 7 * 86_400_000;

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string }>;
}) {
  const { id } = await params;
  // A malformed id (e.g. /campaigns/undefined) is a 404 — bail before any of
  // the parallel fetches below run a query against a garbage uuid.
  if (!uuidSchema.safeParse(id).success) notFound();

  const { stage: requestedStage } = await searchParams;

  // Every fetch below is owner-scoped in its own action; `getCampaignById`
  // returning null is what 404s a campaign the viewer does not own.
  const [campaign, candidates, screeningQuestions, linkedInStatus, history] =
    await Promise.all([
      getCampaignById(id),
      getCandidatesByCampaignId(id),
      getScreeningQuestions(id),
      getLinkedInConnectionStatus(),
      fetchCampaignHistory(id).catch(() => []),
    ]);

  if (!campaign) {
    notFound();
  }

  const supabase = await createClient();
  const { data: authUser } = await supabase.auth.getUser();
  const ownerEmail = authUser.user?.email ?? "You";

  // One clock reading for the whole page, so two rows that entered a stage at
  // the same moment can never disagree about how long they have been there.
  const now = new Date();

  const stageCounts: Record<string, number> = {};
  for (const c of candidates) {
    const stageStr = String(c.stage);
    stageCounts[stageStr] = (stageCounts[stageStr] || 0) + 1;
  }

  // Breaches per stage, from the same `sla` the candidate table badges — one
  // definition of overdue, so this page and that list can never disagree.
  const breachesByStage: Record<string, number> = {};
  for (const c of candidates) {
    if (c.sla) breachesByStage[c.stage] = (breachesByStage[c.stage] ?? 0) + 1;
  }
  const overdueTotal = Object.values(breachesByStage).reduce((a, b) => a + b, 0);
  const worstStage = SLA_STAGES.find((s) => (breachesByStage[s.key] ?? 0) > 0);

  const previewStage =
    requestedStage && FUNNEL_STAGES.some((s) => s.key === requestedStage)
      ? requestedStage
      : defaultPreviewStage(stageCounts);
  const previewStageName =
    FUNNEL_STAGES.find((s) => s.key === previewStage)?.name ?? "this stage";
  const previewCandidates = candidates
    .filter((c) => c.stage === previewStage && !c.is_archived)
    .sort(
      (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
    );

  // Candidates whose visible score predates the campaign's current rubric —
  // the number the rubric panel reports so an old score is never silently
  // compared to a new one.
  const staleScoreCount = candidates.filter((c) =>
    c.scores.some(
      (score) =>
        score.rubric_version != null &&
        score.current_rubric_version != null &&
        score.rubric_version !== score.current_rubric_version,
    ),
  ).length;

  const recentApplications = candidates.filter(
    (c) => now.getTime() - new Date(c.applied_at).getTime() <= SEVEN_DAYS_MS,
  ).length;

  // The pipeline is frozen unless the campaign is Active — the public apply link
  // stops accepting submissions and screening sends pause. Explain why below.
  const isActive = campaign.status === "active";

  const meta = [
    campaign.department,
    campaign.location,
    `${campaign.positions} ${campaign.positions === 1 ? "position" : "positions"}`,
    `${candidates.length} ${candidates.length === 1 ? "candidate" : "candidates"}`,
    campaign.created_at
      ? `created ${new Date(campaign.created_at).toLocaleDateString("en-US", {
          day: "numeric",
          month: "short",
        })}`
      : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-[1280px]">
      {/* Breadcrumb row carries the page's own actions: the navbar is a bell
          and nothing else, so Clone and Edit live in the body. */}
      <div className="mb-[18px] flex flex-wrap items-center gap-2.5">
        <Link
          href="/campaigns"
          className="text-[13px] text-[#6B7280] transition-colors duration-150 hover:text-ink"
        >
          Campaigns
        </Link>
        <span className="text-[13px] text-[#D1D5DB]">/</span>
        <span className="text-[13px] text-ink">{campaign.title}</span>

        <span className="ml-auto flex items-center gap-2.5">
          <CloneCampaignButton campaignId={campaign.id} />
          <Link
            href={`/campaigns/${campaign.id}/edit`}
            className="inline-flex min-h-10 items-center rounded-lg border border-[#D1D5DB] bg-white px-3.5 text-[13px] font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink"
          >
            Edit
          </Link>
        </span>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-[32px] font-semibold tracking-[-0.025em] text-ink">
              {campaign.title}
            </h1>
            <CampaignStatusChanger
              campaignId={campaign.id}
              currentStatus={campaign.status ?? "draft"}
              acceptingApplications={campaign.accepting_applications}
            />
          </div>
          <p className="text-sm text-[#6B7280]">{meta.join(" · ")}</p>
        </div>

        {/* The one ink button on the page: it is where a person goes to act on
            somebody. Clone and Edit are campaign admin, so they stay outlined. */}
        <Link
          href={`/campaigns/${campaign.id}/candidates`}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-ink bg-ink px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-ink-hover focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
        >
          View all candidates
          <span className="rounded-full bg-white/[0.16] px-[7px] py-px text-xs font-semibold tabular-nums">
            {candidates.length}
          </span>
        </Link>
      </div>

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
            <a
              href="#screening-questions"
              className="font-semibold underline hover:text-[#78350F]"
            >
              Set up screening questions
            </a>
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

      <div className="grid items-start gap-6 lg:[grid-template-columns:minmax(0,1.62fr)_minmax(0,1fr)]">
        {/* ── Main column ── */}
        <div className="flex flex-col gap-6">
          <section className="rounded-xl border border-[#E5E7EB] bg-white p-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <div className="mb-4 flex items-center justify-between gap-3.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
                Pipeline
              </h2>
              <span className="text-xs text-[#6B7280]">
                Click a stage to see who is in it
              </span>
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
              total={candidates.length}
              activeStage={previewStage}
              hrefFor={(key) => `/campaigns/${id}?stage=${key}#candidates`}
            />
          </section>

          <CampaignStagePreview
            campaignId={id}
            stageKey={previewStage}
            stageName={previewStageName}
            candidates={previewCandidates}
            total={previewCandidates.length}
            now={now}
          />

          {/* Evaluation Rubrics (resume rubric drives CV scoring — issue #65) */}
          {campaign.rubrics.length > 0 && (
            <RubricDisplay
              rubrics={campaign.rubrics}
              campaignId={campaign.id}
              staleScoreCount={staleScoreCount}
            />
          )}

          {/* Screening Questions — the anchor is the target of the empty-set
              banner above and of the pointer on the edit page. */}
          <div id="screening-questions" className="scroll-mt-6">
            <ScreeningQuestionsEditor
              campaignId={id}
              initialQuestions={screeningQuestions.map((q) => ({
                id: q.id,
                prompt: q.prompt,
                is_required: q.is_required,
              }))}
              canGenerate={(campaign.description?.trim().length ?? 0) >= 10}
            />
          </div>

          {/* AI social-post generator — drafts shareable "we're hiring" copy per
              channel (review-then-post; nothing publishes on its own). */}
          <SocialPostGenerator
            title={campaign.title}
            description={campaign.description}
            department={campaign.department}
            location={campaign.location}
            slug={campaign.public_slug}
            linkedInConnected={linkedInStatus.connected}
          />
        </div>

        {/* ── Right rail ── */}
        <div className="flex flex-col gap-6">
          {campaign.public_slug && (
            <CampaignApplyLink
              slug={campaign.public_slug}
              isActive={isActive}
              recentApplications={recentApplications}
            />
          )}

          <CampaignRunCard
            campaignId={campaign.id}
            automationMode={campaign.automation_mode}
            screeningThreshold={campaign.screening_threshold}
            interviewPersona={campaign.interview_persona}
          />

          <CampaignSlaCard
            campaignId={campaign.id}
            timers={campaign.sla_timers}
            breachesByStage={breachesByStage}
          />

          {/* Reviewers are behind the same flag as the editor that creates
              them: `campaign_reviewers` grants nothing under RLS yet (#132), so
              listing people here would advertise access they do not have. */}
          {isTeamReviewersEnabled() && (
            <CampaignReviewersCard
              ownerEmail={ownerEmail}
              reviewers={campaign.reviewers.map((r) => ({
                id: r.id,
                name: r.name,
                email: r.email,
                role: r.role,
              }))}
            />
          )}

          <CampaignHistoryCard campaignId={campaign.id} entries={history} now={now} />
        </div>
      </div>
    </div>
  );
}
