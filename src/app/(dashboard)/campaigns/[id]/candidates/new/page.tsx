import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/actions/campaigns";
import AddCandidateForm from "@/components/campaigns/add-candidate-form";

export default async function NewCandidatePage({
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
    <div className="max-w-3xl mx-auto">
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
        <Link
          href={`/campaigns/${id}/candidates`}
          className="hover:text-[#111827] transition-colors"
        >
          Candidates
        </Link>
        <span>/</span>
        <span className="text-[#111827]">Add Candidate</span>
      </div>

      <h1 className="text-2xl font-semibold text-[#111827] mb-6">
        Add Candidate
      </h1>

      <AddCandidateForm campaignId={id} />
    </div>
  );
}
