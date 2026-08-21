import Link from "next/link";
import {
  DISPOSITION_LABELS,
  TRANSITION_ACTOR_LABELS,
  formatApplicationState,
} from "@/lib/constants";
import type { ActivityTimeline, TimelineEntry } from "@/lib/rules/transition-timeline";
import { eventLabel } from "@/lib/campaigns/detail-view";
import { ActorMark, actorFromTransition } from "@/components/ui";

/**
 * The candidate's full history, read straight off the append-only transitions
 * log (PRD 3.6.3), with overrides shown beside the automated decision they
 * reversed (PRD 3.7.2).
 *
 * A server component: the data never changes without a page action, so there
 * is nothing here to hydrate. It also keeps `hoursInCurrentState` — computed
 * from the server's clock — from disagreeing with itself after hydration.
 */

/** Rounded, human duration: "3 days", "6 hours", "under an hour". */
function formatDuration(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 48) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ActivityTimelinePanel({
  timeline,
  auditHref,
}: {
  timeline: ActivityTimeline;
  auditHref?: string;
}) {
  const { entries, hoursInCurrentState } = timeline;

  return (
    <section className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between gap-3 border-b border-[#F3F4F6] px-[18px] py-3.5">
        <h2
          className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]"
          title="Every state change on this application, append-only — nothing here can be edited or removed."
        >
          History · {entries.length}
        </h2>
        {hoursInCurrentState !== null && (
          <span className="text-[11px] text-[#9CA3AF]">
            {formatDuration(hoursInCurrentState)} here
          </span>
        )}
        {auditHref && (
          <Link
            href={auditHref}
            className="text-xs font-semibold text-primary hover:underline"
          >
            Audit log
          </Link>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="px-[18px] py-8 text-center text-[13px] text-[#6B7280]">
          Nothing has moved yet. The first entry appears when this application
          changes state.
        </p>
      ) : (
        <ol className="max-h-[340px] overflow-y-auto px-[18px] py-4">
          {entries.map((entry, index) => (
            <TimelineRow
              key={entry.id}
              entry={entry}
              isLast={index === entries.length - 1}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineRow({ entry, isLast }: { entry: TimelineEntry; isLast: boolean }) {
  const isOverride = entry.overrides !== null;

  return (
    <li className="flex gap-3">
      <div className="flex flex-none flex-col items-center">
        {/* The actor mark, not a dot. A rule firing and a person deciding must
            never look the same in a history — that distinction is the whole
            claim this product makes about how it treats candidates. */}
        <ActorMark
          actor={actorFromTransition(entry.actor)}
          size="sm"
          className={isOverride ? "ring-2 ring-[#FDE68A]" : undefined}
        />
        {!isLast && (
          <span className="my-[5px] w-px flex-1 bg-[#E5E7EB]" aria-hidden="true" />
        )}
      </div>

      <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-3.5"}`}>
        <p className="mb-0.5 text-xs leading-[1.5] text-ink">
          <strong className="font-semibold">
            {TRANSITION_ACTOR_LABELS[entry.actor]}
          </strong>{" "}
          {eventLabel(entry.toState).toLowerCase()}
          {isOverride && (
            <span className="ml-1.5 rounded bg-[#FFFBEB] px-1.5 py-px text-[10px] font-semibold text-[#B45309]">
              Override
            </span>
          )}
        </p>

        <p className="text-[11px] text-[#6B7280]">
          {formatWhen(entry.at)}
          {entry.actor === "ai" && " · advisory"}
          {entry.hoursInPreviousState !== null && entry.fromState && (
            <> · after {formatDuration(entry.hoursInPreviousState)} in {formatApplicationState(entry.fromState).toLowerCase()}</>
          )}
        </p>

        {entry.rationale && (
          <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2.5 py-2 text-[11px] leading-[1.5] text-[#374151]">
            {entry.rationale}
          </p>
        )}

        {entry.disposition && (
          <p className="mt-1.5 text-[11px] text-[#6B7280]">
            <span className="font-semibold text-[#374151]">
              {DISPOSITION_LABELS[entry.disposition.code]}
            </span>
            {entry.disposition.description &&
              entry.disposition.description !== entry.rationale && (
                <> — {entry.disposition.description}</>
              )}
          </p>
        )}

        {/* Both sides of an override, together. Reading the manager's reasoning
            without the decision it reversed is how a reasonable call starts to
            look arbitrary six months later. */}
        {entry.overrides && (
          <div className="mt-1.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-2">
            <p className="text-[11px] font-semibold text-[#92400E]">
              Reversed an automated decision:{" "}
              {formatApplicationState(entry.overrides.toState)}
            </p>
            {entry.overrides.rationale && (
              <p className="mt-0.5 text-[11px] leading-[1.5] text-[#B45309]">
                {entry.overrides.rationale}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
