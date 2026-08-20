import {
  DISPOSITION_LABELS,
  TRANSITION_ACTOR_LABELS,
  formatApplicationState,
  type TransitionActor,
} from "@/lib/constants";
import type { ActivityTimeline, TimelineEntry } from "@/lib/rules/transition-timeline";

/**
 * The candidate's full history, read straight off the append-only transitions
 * log (PRD 3.6.3), with overrides shown beside the automated decision they
 * reversed (PRD 3.7.2).
 *
 * A server component: the data never changes without a page action, so there
 * is nothing here to hydrate. It also keeps `hoursInCurrentState` — which is
 * computed from the server's clock — from disagreeing with itself after
 * hydration.
 */

const actorTone: Record<TransitionActor, string> = {
  // Automated steps are the background hum of the pipeline; a person acting is
  // the thing worth finding when you scan this list, so only that one is inked.
  system: "text-[#6B7280] bg-[#F3F4F6] border-[#E5E7EB]",
  ai: "text-[#4338CA] bg-[#FAFAFF] border-[#C7D2FE]",
  recruiter: "text-[#111827] bg-[#F9FAFB] border-[#D1D5DB]",
};

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
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ActivityTimelinePanel({ timeline }: { timeline: ActivityTimeline }) {
  const { entries, hoursInCurrentState } = timeline;

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#111827]">Activity</h3>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Every state change on this application, in order, with who caused it
            and why. Append-only — nothing here can be edited or removed.
          </p>
        </div>
        {hoursInCurrentState !== null && (
          <span
            className="shrink-0 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-2 py-1 text-[11px] font-medium text-[#6B7280]"
            title="Time since the last transition — the number SLA breaches are measured against"
          >
            {formatDuration(hoursInCurrentState)} in this state
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-4 py-8 text-center">
          <p className="text-sm text-[#6B7280]">No recorded activity yet.</p>
          <p className="mt-1 text-xs text-[#9CA3AF]">
            The first entry appears when this application changes state.
          </p>
        </div>
      ) : (
        <ol className="relative space-y-0">
          {entries.map((entry, index) => (
            <TimelineRow
              key={entry.id}
              entry={entry}
              isLast={index === entries.length - 1}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function TimelineRow({ entry, isLast }: { entry: TimelineEntry; isLast: boolean }) {
  const isOverride = entry.overrides !== null;

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {/* Spine — drawn per row rather than as one absolute element so it stops
          cleanly at the final entry instead of trailing past it. */}
      {!isLast && (
        <span
          className="absolute left-[7px] top-4 bottom-0 w-px bg-[#E5E7EB]"
          aria-hidden="true"
        />
      )}

      <span
        className={`relative z-10 mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 bg-white ${
          isOverride
            ? "border-[#D97706]"
            : entry.actor === "recruiter"
              ? "border-[#111827]"
              : "border-[#D1D5DB]"
        }`}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[#111827]">
            {formatApplicationState(entry.toState)}
          </span>
          <span
            className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
              actorTone[entry.actor]
            }`}
          >
            {TRANSITION_ACTOR_LABELS[entry.actor]}
          </span>
          {isOverride && (
            <span className="inline-flex rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 text-[10px] font-medium text-[#B45309]">
              Override
            </span>
          )}
        </div>

        <p className="mt-0.5 text-xs text-[#9CA3AF]">
          {entry.fromState && (
            <>
              from {formatApplicationState(entry.fromState)}
              {entry.hoursInPreviousState !== null && (
                <> · after {formatDuration(entry.hoursInPreviousState)}</>
              )}
              {" · "}
            </>
          )}
          {formatWhen(entry.at)}
        </p>

        {entry.rationale && (
          <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-[#FAFAFA] px-2.5 py-1.5 text-xs leading-relaxed text-[#4B5563]">
            {entry.rationale}
          </p>
        )}

        {entry.disposition && (
          <p className="mt-1.5 text-xs text-[#6B7280]">
            <span className="font-medium text-[#374151]">
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
          <div className="mt-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-2">
            <p className="text-[11px] font-medium text-[#92400E]">
              Reversed an automated decision:{" "}
              {formatApplicationState(entry.overrides.toState)}
            </p>
            {entry.overrides.rationale && (
              <p className="mt-0.5 text-[11px] leading-relaxed text-[#B45309]">
                {entry.overrides.rationale}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
