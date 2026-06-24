import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getCandidatesByCampaignId } from "@/lib/actions/candidates";
import { getScreeningQuestions } from "@/lib/actions/screening-questions";
import RubricDisplay from "@/components/campaigns/rubric-display";
import ScreeningQuestionsEditor from "@/components/campaigns/screening-questions-editor";
import CloneCampaignButton from "@/components/campaigns/clone-campaign-button";
import { GmailSyncButton } from "@/components/candidates/gmail-sync-button";
import { PipelineFunnel } from "@/components/campaigns/pipeline-funnel";
import { CampaignStatusChanger } from "@/components/campaigns/campaign-status-changer";
import { AUTOMATION_MODES, INTERVIEW_PERSONAS } from "@/lib/constants";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  // The pipeline is frozen unless the campaign is Active — gate the processing
  // actions (resume sync, screening sends) and explain why.
  const isActive = campaign.status === "active";
  const frozenReason = `This campaign is ${campaign.status ?? "draft"} — set it to Active to process candidates.`;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-[#6B7280] mb-4">
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

      {/* Evaluation Rubrics (resume rubric drives CV scoring — issue #65) */}
      {campaign.rubrics.length > 0 && (
        <div className="mb-6">
          <RubricDisplay rubrics={campaign.rubrics} />
        </div>
      )}

      {/* Screening Questions */}
      <div className="mb-6">
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
            <GmailSyncButton
              campaignId={id}
              disabled={!isActive}
              disabledReason={frozenReason}
            />
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
              This campaign is <span className="font-medium capitalize">{campaign.status}</span>. Resume
              sync and screening are paused — set it to <span className="font-medium">Active</span> to
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
