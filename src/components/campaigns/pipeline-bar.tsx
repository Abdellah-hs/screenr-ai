import type { CandidateStage } from "@/lib/constants";

/**
 * The six pipeline buckets as one proportional bar, in pipeline order.
 *
 * Same hues as the funnel cards and the stage badges, so a colour learned on
 * one screen still means the same stage on another. Closed is the only pale
 * one: it is where people stop, and a saturated third of the bar would make
 * every mature campaign look alarming.
 */
const SEGMENTS: { key: CandidateStage; label: string; color: string }[] = [
  { key: "applied", label: "New", color: "#475569" },
  { key: "screening", label: "Screening", color: "#2563EB" },
  { key: "interview", label: "Interview", color: "#7C3AED" },
  { key: "final_interview", label: "Final", color: "#D97706" },
  { key: "hired", label: "Hired", color: "#059669" },
  { key: "rejected", label: "Closed", color: "#FECACA" },
];

export function PipelineBar({
  buckets,
  total,
  /** Closed campaigns are history — the bar reads as a record, not a signal. */
  muted = false,
}: {
  buckets: Record<CandidateStage, number>;
  total: number;
  muted?: boolean;
}) {
  if (total === 0) return null;

  return (
    <span
      className={`flex h-[7px] w-[196px] max-w-full overflow-hidden rounded bg-[#F3F4F6] ${
        muted ? "opacity-60" : ""
      }`}
      aria-hidden="true"
    >
      {SEGMENTS.map(({ key, color }) => {
        const count = buckets[key] ?? 0;
        if (count === 0) return null;
        return (
          <span
            key={key}
            style={{ width: `${(count / total) * 100}%`, background: color }}
          />
        );
      })}
    </span>
  );
}

/**
 * The legend, once per table rather than per row. The disclaimer is the point
 * of it: a proportional bar invites reading length as size, and campaigns are
 * not comparable to each other on this page.
 */
export function PipelineKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[#E5E7EB] px-5 py-3 text-xs text-[#6B7280]">
      <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
        Pipeline key
        {SEGMENTS.map(({ key, label, color }) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-sm"
              style={{ background: color }}
              aria-hidden="true"
            />
            {label}
          </span>
        ))}
      </span>
      <span className="ml-auto">
        The bar is proportion, not ranking. Nobody is compared across campaigns.
      </span>
    </div>
  );
}
