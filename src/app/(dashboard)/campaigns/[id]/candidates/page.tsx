import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getCandidatesByCampaignId } from "@/lib/actions/candidates";
import CandidateTable from "@/components/campaigns/candidate-table";

const VALID_FILTERS = new Set([
  "all",
  "applied",
  "pending_review",
  "screening",
  "interview",
  "final_interview",
  "hired",
  "rejected",
  "archived",
]);

export default async function CandidatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string }>;
}) {
  const [{ id }, { stage }] = await Promise.all([params, searchParams]);
  const campaign = await getCampaignById(id);

  if (!campaign) {
    notFound();
  }

  const candidates = await getCandidatesByCampaignId(id);

  const initialFilter = stage && VALID_FILTERS.has(stage) ? stage : "all";

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
        <h1 className="text-2xl font-semibold text-[#111827]">Candidates</h1>
        <Link
          href={`/campaigns/${id}`}
          className="px-4 py-2 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] hover:text-[#111827] transition-all duration-200"
        >
          Back to Campaign
        </Link>
      </div>

      <CandidateTable
        key={initialFilter}
        candidates={candidates}
        campaignId={id}
        initialFilter={initialFilter}
      />
    </div>
  );
}
