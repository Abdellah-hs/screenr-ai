import { getDuplicateReviewQueue } from "@/lib/actions/duplicates";
import { DuplicateReviewList } from "@/components/admin/duplicate-review-list";

export default async function DuplicatesPage() {
  const items = await getDuplicateReviewQueue();

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#111827]">
          Duplicate Review{" "}
          <span className="text-[#6B7280] ml-2 font-normal">({items.length})</span>
        </h1>
        <p className="text-sm text-[#6B7280] mt-1 max-w-2xl">
          Candidates flagged as possible duplicates across intake channels.
          Review each pair and decide whether to merge the records or keep
          them separate.
        </p>
      </div>

      <DuplicateReviewList items={items} />
    </div>
  );
}
