import { cn } from "@/lib/utils";

/**
 * A placeholder block for content that is still being fetched.
 *
 * Deliberately neutral grey. The palette encodes consequence — ink for a human
 * decision, indigo for AI, emerald for a terminal outcome — and a placeholder
 * is not any of those yet. Colouring a skeleton in a family that means
 * something would make a page assert a verdict it has not loaded.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-[#E5E7EB]", className)}
    />
  );
}

/**
 * The card shell the dashboard uses everywhere, empty. Kept here so a loading
 * state and the real panel it stands in for cannot drift apart in border,
 * radius or shadow — the skeleton should look like the page arriving, not like
 * a different page.
 */
export function SkeletonCard({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[#E5E7EB] bg-white p-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.05)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
