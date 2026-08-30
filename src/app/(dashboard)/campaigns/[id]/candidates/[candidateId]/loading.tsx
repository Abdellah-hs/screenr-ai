import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/**
 * The heaviest read in the app: this page awaits seven owner-scoped actions —
 * campaign, candidate, screening state, booking, interview session, pool state
 * and timeline — before it can render anything at all. It is also the page
 * recruiters step through fastest, one candidate after another, so it is the
 * one where a frozen previous screen was most obviously wrong.
 *
 * Its own skeleton rather than the group's, because the shape is distinctive:
 * an identity band, a tab row, then a column of evidence sections.
 */
export default function CandidateDetailLoading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col">
      <Skeleton className="mb-[18px] h-4 w-72" />

      {/* Identity band — avatar, name, the stage badge, and the action bar. */}
      <div className="mb-6 flex items-start gap-4">
        <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2.5 pt-1">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3.5 w-80" />
        </div>
        <div className="flex shrink-0 gap-2">
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      </div>

      {/* Tab row. */}
      <div className="mb-6 flex items-center gap-6 border-b border-[#E5E7EB] pb-2.5">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3.5 w-28" />
      </div>

      {/* Evidence sections. Each real one carries a score and its rationale,
          so the placeholder is a heading, a number, and a paragraph. */}
      <div className="space-y-6">
        {[0, 1].map((i) => (
          <SkeletonCard key={i}>
            <Skeleton className="mb-3 h-3 w-32" />
            <div className="mb-4 flex items-baseline gap-3">
              <Skeleton className="h-9 w-16" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </SkeletonCard>
        ))}
      </div>

      <span className="sr-only" role="status">
        Loading candidate
      </span>
    </div>
  );
}
