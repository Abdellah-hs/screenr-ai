import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getCandidatesByCampaignId } from "@/lib/actions/candidates";
import { getScreeningQuestions } from "@/lib/actions/screening-questions";
import { getLinkedInConnectionStatus } from "@/lib/actions/integrations";
import RubricDisplay from "@/components/campaigns/rubric-display";
import ScreeningQuestionsEditor from "@/components/campaigns/screening-questions-editor";
import CloneCampaignButton from "@/components/campaigns/clone-campaign-button";
import { PipelineFunnel } from "@/components/campaigns/pipeline-funnel";
import { CampaignStatusChanger } from "@/components/campaigns/campaign-status-changer";
import { CampaignApplyLink } from "@/components/campaigns/campaign-apply-link";
import { SocialPostGenerator } from "@/components/campaigns/social-post-generator";
import {
  CampaignRunCard,
  CampaignSlaCard,
} from "@/components/campaigns/campaign-run-card";
import { SLA_STAGES } from "@/lib/constants";
import { uuidSchema } from "@/lib/validations";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // A malformed id (e.g. /campaigns/undefined) is a 404 — bail before any of
  // the parallel fetches below run a query against a garbage uuid.
  if (!uuidSchema.safeParse(id).success) notFound();

  const [campaign, candidates, screeningQuestions, linkedInStatus] = await Promise.all([
    getCampaignById(id),
    getCandidatesByCampaignId(id),
    getScreeningQuestions(id),
    getLinkedInConnectionStatus(),
  ]);

  if (!campaign) {
    notFound();
  }

  const stageCounts: Record<string, number> = {};
  for (const c of candidates) {
    const stageStr = String(c.stage);
    stageCounts[stageStr] = (stageCounts[stageStr] || 0) + 1;
  }

  // Breaches per stage, from the same `sla` the candidate table badges — one
  // definition of overdue, so this card and that list can never disagree.
  const breachesByStage: Record<string, number> = {};
  for (const c of candidates) {
    if (c.sla) breachesByStage[c.stage] = (breachesByStage[c.stage] ?? 0) + 1;
  }
  const overdueTotal = Object.values(breachesByStage).reduce((a, b) => a + b, 0);
  const worstStage = SLA_STAGES.find((s) => (breachesByStage[s.key] ?? 0) > 0);

  // The pipeline is frozen unless the campaign is Active — the public apply link
  // stops accepting submissions and screening sends pause. Explain why below.
  const isActive = campaign.status === "active";

  const meta = [
    campaign.department,
    campaign.location,
    `${campaign.positions} ${campaign.positions === 1 ? "position" : "positions"}`,
    `${candidates.length} ${candidates.length === 1 ? "candidate" : "candidates"}`,
    campaign.deadline
      ? `closes ${new Date(campaign.deadline).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}`
      : "no deadline",
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex items-baseline gap-2 text-sm text-[#6B7280]">
        <Link href="/campaigns" className="transition-colors duration-150 hover:text-ink">
          Campaigns
        </Link>
        <span>/</span>
        <span className="text-ink">{campaign.title}</span>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink">{campaign.title}</h1>
            <CampaignStatusChanger
              campaignId={campaign.id}
              currentStatus={campaign.status ?? "draft"}
              acceptingApplications={campaign.accepting_applications}
            />
          </div>
          {/* One line instead of a four-tile Details grid — none of these facts
              is worth a card of its own, and together they are a subtitle. */}
          <p className="mt-1.5 text-sm text-[#6B7280]">{meta.join(" · ")}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/campaigns/${campaign.id}/candidates`}
            className="btn-secondary text-sm"
          >
            View all candidates
          </Link>
          <CloneCampaignButton campaignId={campaign.id} />
          <Link href={`/campaigns/${campaign.id}/edit`} className="btn-secondary text-sm">
            Edit
          </Link>
        </div>
      </div>

      {/* Screening questions are a hard prerequisite: approving a candidate
          into screening is blocked until the campaign has them. Surface that
          up top instead of letting recruiters discover it on a candidate. */}
      {screeningQuestions.length === 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4">
          <svg
            className="mt-0.5 h-4 w-4 shrink-0 text-[#B45309]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
            />
          </svg>
          <p className="text-sm text-[#92400E]">
            This campaign has no screening questions yet — candidates can&apos;t be
            approved into screening until it does.{" "}
            <a
              href="#screening-questions"
              className="font-medium underline hover:text-[#78350F]"
            >
              Set up screening questions
            </a>
          </p>
        </div>
      )}

      {/* Lateness at the top, with what the timer does and does not do. A timer
          that reads as automation is one a recruiter assumes is handling it. */}
      {overdueTotal > 0 && worstStage && (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#991B1B]">
              {overdueTotal} {overdueTotal === 1 ? "candidate is" : "candidates are"} past
              a stage SLA
            </p>
            <p className="mt-0.5 text-sm text-[#B91C1C]">
              The timer only alerts — it never rejects, and it never advances. They are
              still sitting where they were, waiting for a person.
            </p>
          </div>
          <Link
            href={`/campaigns/${id}/candidates?overdue=1`}
            className="shrink-0 rounded-lg border border-[#FCA5A5] bg-white px-3 py-2 text-sm font-semibold text-[#B91C1C] transition-colors duration-150 hover:bg-[#FEE2E2]"
          >
            Show {overdueTotal === 1 ? "the one" : "them"}
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border border-[#E5E7EB] bg-white p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">
                Pipeline
              </h2>
              <Link
                href={`/campaigns/${id}/candidates`}
                className="text-sm font-medium text-primary hover:underline"
              >
                View all candidates ({candidates.length})
              </Link>
            </div>
            {!isActive && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-sm text-[#92400E]">
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
            />
          </section>

          {/* Evaluation Rubrics (resume rubric drives CV scoring — issue #65) */}
          {campaign.rubrics.length > 0 && <RubricDisplay rubrics={campaign.rubrics} />}

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

          <section className="rounded-xl border border-[#E5E7EB] bg-white p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink">
              Role description
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#374151]">
              {campaign.description}
            </p>
          </section>

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

        <div className="space-y-6">
          {/* Public apply link — recruiters share this to source candidates. */}
          {campaign.public_slug && (
            <CampaignApplyLink slug={campaign.public_slug} isActive={isActive} />
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
        </div>
      </div>
    </div>
  );
}
