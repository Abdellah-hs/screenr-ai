import { getDuplicateReviewQueue } from "@/lib/actions/duplicates";
import { DuplicateReviewList } from "@/components/admin/duplicate-review-list";

export default async function DuplicatesPage() {
  const items = await getDuplicateReviewQueue();

  return (
    // `h-full` so the page is exactly the viewport and the QUEUE scrolls rather
    // than the page: the shell's <main> is the only other scroller, and letting
    // it take this list carried the heading — and the count, which is the one
    // thing saying how much work is left — off the top of the screen after two
    // cards. Each card is a self-contained decision about 250px tall, so a
    // full queue is several screens of them.
    <div className="mx-auto flex h-full max-w-5xl flex-col">
      <div className="mb-8 shrink-0">
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
