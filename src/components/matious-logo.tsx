import { cn } from "@/lib/utils";

/**
 * Matious wordmark for candidate-facing pages, recreated as styled text so no
 * binary asset is required. To switch to the official artwork, drop the file
 * in /public (e.g. /public/matious-logo.svg) and replace the span below with
 * an <img> — every page renders the brand through this one component.
 */
export default function MatiousLogo({ className }: { className?: string }) {
  return (
    <span
      aria-label="Matious"
      className={cn(
        "inline-block select-none font-black uppercase tracking-tight text-[#232D5C]",
        className,
      )}
    >
      Matious
    </span>
  );
}
