import Link from "next/link";
import { getCampaigns } from "@/lib/actions/campaigns";
import CampaignFilters from "./campaign-filters";

export default async function CampaignsPage() {
  const campaigns = await getCampaigns();

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Campaigns</h1>
          <p className="text-sm text-muted mt-1">
            Manage your hiring campaigns
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Campaign
        </Link>
      </div>

      <CampaignFilters campaigns={campaigns} />
    </div>
  );
}
