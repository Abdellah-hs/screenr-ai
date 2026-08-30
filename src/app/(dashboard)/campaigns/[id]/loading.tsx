import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/**
 * Campaign detail awaits five actions, and `getCampaignById` alone is three
 * serial round trips (the row, then its rubrics/reviewers/timers/availability,
 * then the dimensions of those rubrics). Its own skeleton because the page is
 * a wide two-column board, not the single stack the group default draws.
 */
export default function CampaignDetailLoading() {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col">
      <Skeleton className="mb-[18px] h-4 w-64" />

      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-3.5 w-96" />
      </div>

      <div className="mb-6 flex items-center gap-6 border-b border-[#E5E7EB] pb-2.5">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3.5 w-16" />
      </div>

      <div className="grid gap-6 lg:[grid-template-columns:minmax(0,1.62fr)_minmax(0,1fr)]">
        <SkeletonCard>
          <Skeleton className="mb-5 h-3 w-24" />
          <div className="space-y-3.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-6 w-6 shrink-0 rounded-md" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-3.5 w-8 shrink-0" />
              </div>
            ))}
          </div>
        </SkeletonCard>

        <div className="space-y-6">
          {[0, 1].map((i) => (
            <SkeletonCard key={i}>
              <Skeleton className="mb-4 h-3 w-28" />
              <div className="space-y-2.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </SkeletonCard>
          ))}
        </div>
      </div>

      <span className="sr-only" role="status">
        Loading campaign
      </span>
    </div>
  );
}
