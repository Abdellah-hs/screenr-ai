import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getCandidatesByCampaignId } from "@/lib/actions/candidates";
import { getScreeningQuestions } from "@/lib/actions/screening-questions";
import RubricDisplay from "@/components/campaigns/rubric-display";
import ScreeningQuestionsEditor from "@/components/campaigns/screening-questions-editor";
import CloneCampaignButton from "@/components/campaigns/clone-campaign-button";
import { PipelineFunnel } from "@/components/campaigns/pipeline-funnel";
import { CampaignStatusChanger } from "@/components/campaigns/campaign-status-changer";
import { CampaignApplyLink } from "@/components/campaigns/campaign-apply-link";
import { AUTOMATION_MODES, INTERVIEW_PERSONAS } from "@/lib/constants";
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

  const [campaign, candidates, screeningQuestions] = await Promise.all([
    getCampaignById(id),
    getCandidatesByCampaignId(id),
    getScreeningQuestions(id),
  ]);

  if (!campaign) {
    notFound();
  }

  const stageCounts: Record<string, number> = {};
  for (const c of candidates) {
    const stageStr = String(c.stage);
    stageCounts[stageStr] = (stageCounts[stageStr] || 0) + 1;
  }

  // The pipeline is frozen unless the campaign is Active — the public apply link
  // stops accepting submissions and screening sends pause. Explain why below.
  const isActive = campaign.status === "active";

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-baseline gap-2 text-sm text-[#6B7280] mb-4">
        <Link href="/campaigns" className="hover:text-[#111827] transition-colors">
          Campaigns
        </Link>
        <span>/</span>
        <span className="text-[#111827]">{campaign.title}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-[#111827]">{campaign.title}</h1>
            <CampaignStatusChanger
              campaignId={campaign.id}
              currentStatus={campaign.status ?? "draft"}
            />
          </div>
          {campaign.department && (
            <p className="text-sm text-[#6B7280] mt-1">{campaign.department}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <CloneCampaignButton campaignId={campaign.id} />
          <Link
            href={`/campaigns/${campaign.id}/edit`}
            className="px-4 py-2 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] hover:text-[#111827] transition-all duration-200"
          >
            Edit
          </Link>
        </div>
      </div>

      {/* Screening questions are a hard prerequisite: approving a candidate
          into screening is blocked until the campaign has them. Surface that
          up top instead of letting recruiters discover it on a candidate. */}
      {screeningQuestions.length === 0 && (
        <div className="mb-6 flex items-start gap-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-4">
          <svg
            className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5"
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
            This campaign has no screening questions yet — candidates can&apos;t
            be approved into screening until it does.{" "}
            <a
              href="#screening-questions"
              className="font-medium underline hover:text-[#78350F]"
            >
              Set up screening questions
            </a>
          </p>
        </div>
      )}

      {/* Campaign Details */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 mb-6">
        <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider mb-4">
          Details
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div>
            <p className="text-xs text-[#6B7280] mb-1">Positions</p>
            <p className="text-sm font-medium text-[#111827]">{campaign.positions}</p>
          </div>
          <div>
            <p className="text-xs text-[#6B7280] mb-1">Location</p>
            <p className="text-sm font-medium text-[#111827]">{campaign.location || "Not specified"}</p>
          </div>
          <div>
            <p className="text-xs text-[#6B7280] mb-1">Deadline</p>
            <p className="text-sm font-medium text-[#111827]">
              {campaign.deadline
                ? new Date(campaign.deadline).toLocaleDateString()
                : "No deadline"}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#6B7280] mb-1">Created</p>
            <p className="text-sm font-medium text-[#111827]">
              {campaign.created_at
                ? new Date(campaign.created_at).toLocaleDateString()
                : "—"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div>
            <p className="text-xs text-[#6B7280] mb-1">Automation Mode</p>
            <p className="text-sm font-medium text-[#111827]">
              {AUTOMATION_MODES.find((m) => m.value === campaign.automation_mode)?.label ?? campaign.automation_mode}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#6B7280] mb-1">Screening Threshold</p>
            <p className="text-sm font-medium text-[#111827]">{campaign.screening_threshold}%</p>
          </div>
          <div>
            <p className="text-xs text-[#6B7280] mb-1">Interview Persona</p>
            <p className="text-sm font-medium text-[#111827]">
              {INTERVIEW_PERSONAS.find((p) => p.value === campaign.interview_persona)?.label ?? campaign.interview_persona}
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs text-[#6B7280] mb-2">Description</p>
          <p className="text-sm text-[#111827] whitespace-pre-wrap leading-relaxed">
            {campaign.description}
          </p>
        </div>
      </div>

      {/* Public apply link — recruiters share this to source candidates directly */}
      {campaign.public_slug && (
        <div className="mb-6">
          <CampaignApplyLink slug={campaign.public_slug} isActive={isActive} />
        </div>
      )}

      {/* Evaluation Rubrics (resume rubric drives CV scoring — issue #65) */}
      {campaign.rubrics.length > 0 && (
        <div className="mb-6">
          <RubricDisplay rubrics={campaign.rubrics} />
        </div>
      )}

      {/* Screening Questions — the anchor is the target of the empty-set
          banner above and of the pointer on the edit page. */}
      <div id="screening-questions" className="mb-6 scroll-mt-6">
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

      {/* Pipeline Stages */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-4">
            <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider">
              Pipeline
            </h2>
          </div>
          <Link
            href={`/campaigns/${id}/candidates`}
            className="text-sm font-medium text-[#2563EB] hover:underline"
          >
            View all candidates ({candidates.length})
          </Link>
        </div>
        {!isActive && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-sm text-[#92400E]">
            <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span>
              This campaign is <span className="font-medium capitalize">{campaign.status}</span>. New
              applications and screening are paused — set it to <span className="font-medium">Active</span> to
              process candidates.
            </span>
          </div>
        )}
        <PipelineFunnel
          campaignId={id}
          stageCounts={stageCounts}
          total={candidates.length}
        />
      </div>
    </div>
  );
}
