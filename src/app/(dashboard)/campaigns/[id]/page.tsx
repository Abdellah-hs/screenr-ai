import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";

const statusColors: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  paused: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  closed: "bg-red-500/10 text-red-400 border-red-500/20",
};

const pipelineStages = [
  { name: "Applied", count: 0 },
  { name: "Screening", count: 0 },
  { name: "Interview", count: 0 },
  { name: "Offer", count: 0 },
  { name: "Hired", count: 0 },
];

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = await getCampaignById(id);

  if (!campaign) {
    notFound();
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-muted mb-4">
        <Link href="/campaigns" className="hover:text-foreground transition-colors">
          Campaigns
        </Link>
        <span>/</span>
        <span className="text-foreground">{campaign.title}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{campaign.title}</h1>
            <span
              className={`inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full border ${
                statusColors[campaign.status ?? "draft"]
              }`}
            >
              {campaign.status}
            </span>
          </div>
          {campaign.department && (
            <p className="text-sm text-muted mt-1">{campaign.department}</p>
          )}
        </div>
        <button className="px-4 py-2 text-sm font-medium text-muted border border-border rounded-lg hover:text-foreground hover:border-foreground/20 transition-colors">
          Edit
        </button>
      </div>

      {/* Campaign Details */}
      <div className="bg-card rounded-xl border border-border p-6 mb-6">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">
          Details
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div>
            <p className="text-xs text-muted mb-1">Positions</p>
            <p className="text-sm font-medium text-foreground">{campaign.positions}</p>
          </div>
          <div>
            <p className="text-xs text-muted mb-1">Location</p>
            <p className="text-sm font-medium text-foreground">{campaign.location || "Not specified"}</p>
          </div>
          <div>
            <p className="text-xs text-muted mb-1">Deadline</p>
            <p className="text-sm font-medium text-foreground">
              {campaign.deadline
                ? new Date(campaign.deadline).toLocaleDateString()
                : "No deadline"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted mb-1">Created</p>
            <p className="text-sm font-medium text-foreground">
              {campaign.created_at
                ? new Date(campaign.created_at).toLocaleDateString()
                : "—"}
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs text-muted mb-2">Description</p>
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {campaign.description}
          </p>
        </div>
      </div>

      {/* Pipeline Stages */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">
          Pipeline
        </h2>
        <div className="grid grid-cols-5 gap-3">
          {pipelineStages.map((stage) => (
            <div
              key={stage.name}
              className="text-center p-4 bg-surface rounded-lg border border-border"
            >
              <p className="text-2xl font-bold text-foreground">{stage.count}</p>
              <p className="text-xs text-muted mt-1">{stage.name}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
