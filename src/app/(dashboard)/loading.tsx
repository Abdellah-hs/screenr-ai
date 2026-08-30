import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/**
 * Shown while a dashboard route's server render is in flight.
 *
 * Every page in this group resolves the session and then runs several queries
 * against Supabase before React renders a single element. Without a loading
 * state Next has nothing to show for that time, so it holds the *previous*
 * page on screen and the app reads as frozen — the click appeared to do
 * nothing, which is why a second click on the same link was so common.
 *
 * This is a Suspense boundary as much as a picture: declaring it is what lets
 * the shell (sidebar, and the URL) commit immediately and stream the page in
 * behind it.
 *
 * Deliberately generic. It stands in for the campaign board, the candidate
 * table and the settings page alike, so it draws the shape they share — a
 * title, then panels — rather than mimicking any one of them and being wrong
 * on the other two.
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>

      <div className="space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} className="flex items-center gap-4">
            <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
          </SkeletonCard>
        ))}
      </div>

      <span className="sr-only" role="status">
        Loading
      </span>
    </div>
  );
}
