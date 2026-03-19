import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getCandidatesByCampaignId } from "@/lib/actions/candidates";
import ScreeningCriteriaDisplay from "@/components/campaigns/screening-criteria-display";
import RubricDisplay from "@/components/campaigns/rubric-display";
import CloneCampaignButton from "@/components/campaigns/clone-campaign-button";
import { AUTOMATION_MODES, INTERVIEW_PERSONAS } from "@/lib/constants";
import type { CandidateStage } from "@/lib/constants";

const statusColors: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  paused: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  closed: "bg-red-500/10 text-red-400 border-red-500/20",
};

const pipelineStageKeys: { name: string; key: CandidateStage }[] = [
  { name: "Applied", key: "applied" },
  { name: "Screening", key: "screening" },
  { name: "Interview", key: "interview" },
  { name: "Offer", key: "offer" },
  { name: "Hired", key: "hired" },
];

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [campaign, candidates] = await Promise.all([
    getCampaignById(id),
    getCandidatesByCampaignId(id),
  ]);

  if (!campaign) {
    notFound();
  }

  const stageCounts: Record<string, number> = {};
  for (const c of candidates) {
    stageCounts[c.stage] = (stageCounts[c.stage] || 0) + 1;
  }

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
            <span
              className={`inline-flex px-2.5 py-0.5 text-xs font-medium rounded border ${
                statusColors[campaign.status ?? "draft"]
              }`}
            >
              {campaign.status}
            </span>
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

      {/* Screening Criteria */}
      {campaign.screening_criteria.length > 0 && (
        <div className="mb-6">
          <ScreeningCriteriaDisplay criteria={campaign.screening_criteria} />
        </div>
      )}

      {/* Evaluation Rubrics */}
      {campaign.rubrics.length > 0 && (
        <div className="mb-6">
          <RubricDisplay rubrics={campaign.rubrics} />
        </div>
      )}

      {/* Pipeline Stages */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider">
            Pipeline
          </h2>
          <Link
            href={`/campaigns/${id}/candidates`}
            className="text-sm font-medium text-[#2563EB] hover:underline"
          >
            View all candidates ({candidates.length})
          </Link>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {pipelineStageKeys.map((stage) => (
            <Link
              key={stage.key}
              href={`/campaigns/${id}/candidates`}
              className="text-center p-4 bg-[#F9FAFB] rounded-lg border border-[#E5E7EB] hover:border-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
            >
              <p className="text-2xl font-semibold text-[#111827]">
                {stageCounts[stage.key] || 0}
              </p>
              <p className="text-xs text-[#6B7280] mt-1">{stage.name}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
