import Link from "next/link";
import { Breadcrumb } from "@/components/ui";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";
import { getCandidatesByCampaignId } from "@/lib/actions/candidates";
import CandidateTable from "@/components/campaigns/candidate-table";
import { uuidSchema } from "@/lib/validations";

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
  searchParams: Promise<{ stage?: string; overdue?: string }>;
}) {
  const [{ id }, { stage, overdue }] = await Promise.all([params, searchParams]);
  // Malformed campaign id in the URL → 404 before touching the database.
  if (!uuidSchema.safeParse(id).success) notFound();

  // Both together, not one behind the other. Each of these actions resolves the
  // session and then runs its own chain of queries, so awaiting them in series
  // spent two full round trips to Supabase before the second one could start.
  //
  // The settle dance keeps the two failure modes the serial version had:
  // `getCandidatesByCampaignId` throws on a campaign the viewer does not own —
  // which is the same condition that leaves `campaign` null — so the 404 is
  // checked first and that rejection goes with it. Anything else still throws,
  // because an empty list is a real answer ("nobody has applied") and a dropped
  // connection is not that answer.
  const [campaign, candidatesResult] = await Promise.all([
    getCampaignById(id),
    getCandidatesByCampaignId(id).then(
      (rows) => ({ ok: true as const, rows }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);

  if (!campaign) {
    notFound();
  }

  if (!candidatesResult.ok) throw candidatesResult.error;
  const candidates = candidatesResult.rows;

  const initialFilter = stage && VALID_FILTERS.has(stage) ? stage : "all";
  const initialOverdue = overdue === "1";

  return (
    <div className="max-w-5xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Campaigns", href: "/campaigns" },
          { label: campaign.title, href: `/campaigns/${id}` },
          { label: "Candidates" },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-[#111827]">Candidates</h1>
        <Link
          href={`/campaigns/${id}`}
          className="px-4 py-2 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] hover:text-[#111827] transition-colors duration-150"
        >
          Back to Campaign
        </Link>
      </div>

      <CandidateTable
        key={`${initialFilter}:${initialOverdue}`}
        candidates={candidates}
        campaignId={id}
        initialFilter={initialFilter}
        initialOverdue={initialOverdue}
      />
    </div>
  );
}
