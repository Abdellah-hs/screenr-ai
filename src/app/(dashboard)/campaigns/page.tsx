import Link from "next/link";
import { getCampaignBoard } from "@/lib/actions/campaigns";
import CampaignFilters from "./campaign-filters";

export default async function CampaignsPage() {
  const { campaigns, summaries } = await getCampaignBoard();

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Campaigns</h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            One role each — its rubric, its questions, its apply link, and everyone
            who applied to it.
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className="inline-flex items-center gap-2 btn-primary"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New campaign
        </Link>
      </div>

      <CampaignFilters campaigns={campaigns} summaries={summaries} />
    </div>
  );
}
