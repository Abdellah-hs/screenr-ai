import Link from "next/link";
import { getCampaigns } from "@/lib/actions/campaigns";
import CampaignFilters from "./campaign-filters";

export default async function CampaignsPage() {
  const campaigns = await getCampaigns();

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold text-[#111827]">
          Current Openings <span className="text-[#6B7280] ml-2 font-normal">({campaigns.length})</span>
        </h1>
        <Link
          href="/campaigns/new"
          className="inline-flex items-center gap-2 btn-primary"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Campaign
        </Link>
      </div>

      <CampaignFilters campaigns={campaigns} />
    </div>
  );
}
