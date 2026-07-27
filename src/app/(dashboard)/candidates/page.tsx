import { getTalentPool } from "@/lib/actions/candidates";
import { TalentPoolTable } from "@/components/candidates/talent-pool-table";

export default async function TalentPoolPage() {
  const people = await getTalentPool();

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#111827]">
          Talent Pool{" "}
          <span className="ml-2 font-normal text-[#6B7280]">({people.length})</span>
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[#6B7280]">
          Everyone who has applied to your campaigns, in one place. Each person
          shows where they came from — remove a campaign and its candidates still
          live here, with the removed campaign flagged so you can restore it.
        </p>
      </div>

      <TalentPoolTable people={people} />
    </div>
  );
}
