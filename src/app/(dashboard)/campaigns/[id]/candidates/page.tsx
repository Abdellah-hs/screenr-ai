import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getCandidatesByCampaignId } from "@/lib/actions/candidates";
import CandidateTable from "@/components/campaigns/candidate-table";

export default async function CandidatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = await getCampaignById(id);

  if (!campaign) {
    notFound();
  }

  const candidates = await getCandidatesByCampaignId(id);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#6B7280] mb-4">
        <Link
          href="/campaigns"
          className="hover:text-[#111827] transition-colors"
        >
          Campaigns
        </Link>
        <span>/</span>
        <Link
          href={`/campaigns/${id}`}
          className="hover:text-[#111827] transition-colors"
        >
          {campaign.title}
        </Link>
        <span>/</span>
        <span className="text-[#111827]">Candidates</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#111827]">Candidates</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}{" "}
            for {campaign.title}
          </p>
        </div>
        <Link
          href={`/campaigns/${id}`}
          className="px-4 py-2 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] hover:text-[#111827] transition-all duration-200"
        >
          Back to Campaign
        </Link>
      </div>

      <CandidateTable
        candidates={candidates}
        campaignId={id}
        automationMode={campaign.automation_mode}
      />
    </div>
  );
}
