import Link from "next/link";
import { ScoreInline } from "@/components/ui";
import type { CandidateScore } from "@/lib/constants";
import { eventLabel } from "@/lib/campaigns/detail-view";
import { decisionPrompt } from "@/lib/candidates/decision-prompt";
import {
  type DecisionGroup,
  type DecisionItem,
  type DecisionQueue,
} from "@/lib/overview/decision-queue";

/**
 * Urgency, and only urgency — a dot beside the title rather than a washed band
 * behind it. `decide` and `approve` share amber on purpose: both are inside
 * SLA and both wait on the same person, so giving them two colours would
 * invent a difference in consequence that does not exist. The title says which
 * job it is; the colour never carries the meaning on its own.
 */
const GROUP_DOT: Record<DecisionGroup["key"], string> = {
  overdue: "bg-[#DC2626]",
  decide: "bg-[#D97706]",
  approve: "bg-[#D97706]",
  // Amber like the other two groups that wait on this person, and NOT the grey
  // of `lapsed`: these have a button behind them. Grey would put an application
  // we broke in the same visual class as one where the candidate never turned
  // up, which is the reading this group was split out to stop.
  failed: "bg-[#D97706]",
  lapsed: "bg-[#9CA3AF]",
};

/**
 * Which scorer wrote the number, said beside every number.
 *
 * Per row rather than per column, because one group mixes stages: a screening
 * score, an interview score and a manager-review handoff all sit under "Scored
 * · waiting on you". An unlabelled 61 next to an unlabelled 74 invites reading
 * them as the same measurement, which is the comparison "Independent Stage
 * Scores" exists to refuse.
 */
const SCORE_STAGE_LABEL: Record<CandidateScore["stage"], string> = {
  resume: "Resume",
  screening: "Screening",
  interview: "Interview",
};

/**
 * The decision queue: every application waiting on this recruiter, grouped by
 * what happens if they do nothing, and named rather than counted.
 *
 * It is the page. The rail beside it is context — the only thing here that
 * changes a candidate's day is somebody opening one of these rows.
 */
export function DecisionQueueSection({ queue }: { queue: DecisionQueue }) {
  if (queue.groups.length === 0) {
    return (
      <section className="rounded-xl border border-[#E5E7EB] bg-white px-6 py-12 text-center">
        <h2 className="text-[15px] font-semibold text-ink">
          Nothing is waiting on you
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-[#6B7280]">
          Approvals, scored candidates, and anyone who has been waiting too long
          land here.
        </p>
      </section>
    );
  }

  // No column heading. It was set in the same uppercase style as the rail's
  // card titles but sat OUTSIDE a card while those sit inside one, so the two
  // columns started 35px apart and the matching type read as a misalignment.
  // Nothing is lost: every group already names its own job, and "Needs you"
  // said the same thing as "waiting on you" one line below it.
  return (
    <section className="space-y-4">
      {queue.groups.map((group) => (
        <div
          key={group.key}
          className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white"
        >
          <div className="flex items-start gap-2.5 border-b border-[#F3F4F6] px-5 py-4">
            <span
              aria-hidden
              className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${GROUP_DOT[group.key]}`}
            />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-tight text-ink">
                {group.title}
              </p>
              <p className="mt-1 text-xs text-[#6B7280]">{group.subtitle}</p>
            </div>
          </div>

          {/* The rows scroll inside the card once a group outgrows ~4 of them,
              so every group is the same compact height and all four are on one
              screen together — the grouping is the thing that says which job
              each row is, and it is worth nothing if you have to scroll the
              page to find the next heading.

              ~4 rather than the ~6.5 this shipped with. At 6.5 the cap only
              ever bit on the one long group; a five-person group still ran to
              its full length, which is the same arrangement that pushed the
              last group off the bottom, just with fewer rows doing it.

              It is a max, not a height: a group of two still ends after two,
              and the group heading stays put while the rows move under it. */}
          <ul className="max-h-[18rem] divide-y divide-[#F3F4F6] overflow-y-auto">
            {group.items.map((item) => (
              <li key={item.applicationId}>
                <QueueRow item={item} explain={EXPLAINED_GROUPS.has(group.key)} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * The two groups whose rows carry a sentence saying what to do about them.
 *
 * The other three do not need one: "Approve into screening" and "Scored ·
 * waiting on you" name the job in the heading, and a line under every row
 * would be the same sentence repeated down the page.
 *
 * These two are the opposite case. Both are outside the decision groups, so a
 * recruiter has no button to reach for and nothing on the page tells them
 * whether anything is owed — and the two look identical while meaning opposite
 * things: an expired link is a fact about the candidate, a processing failure
 * is a fact about us, and only one of them can be undone.
 */
const EXPLAINED_GROUPS = new Set<DecisionGroup["key"]>(["failed", "lapsed"]);

function QueueRow({ item, explain = false }: { item: DecisionItem; explain?: boolean }) {
  const href = `/campaigns/${item.campaignId}/candidates/${item.applicationId}`;
  // `decisionPrompt` is the one place that says what a state means for the
  // person reading the file. It was written, tested, and rendered nowhere —
  // including the correction that stopped `processing_failed` reading as "the
  // CV could not be read", which is wrong for every route into that state.
  const prompt = explain ? decisionPrompt(item.status) : null;

  return (
    <Link
      href={href}
      className="group flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors duration-150 hover:bg-[#F9FAFB]"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">
          {item.candidateName}
        </span>
        {/* The state as an event — "Screening scored", "Link expired unused" —
            from the same map the candidate's own history reads, so a row here
            and a row there never spell the same moment two ways. */}
        <span className="mt-0.5 block truncate text-xs text-[#6B7280]">
          {item.campaignTitle} · {eventLabel(item.status)}
        </span>
        {/* Not truncated, unlike the two lines above it: this is the sentence
            that says whether anything can be done, and half of it is worse
            than none. */}
        {prompt && (
          <span className="mt-1 block text-xs leading-[1.5] text-[#6B7280]">
            {prompt.detail}
          </span>
        )}
      </span>

      {/* Score and verdict are one object, on the indigo rail: nobody should
          read a 61 without seeing that a model wrote it and that it moved
          nobody. Same component as the candidate table, so the same number
          cannot look like two different kinds of fact on two screens. */}
      {/* One fixed-width block, label pinned left and chip pinned right, so
          both form columns down the list. Shrink-wrapped, neither did: the
          label moved with the stage's name length and the chip moved with the
          score's digit count, so a 0 and a 100 sat in different places.

          The width is sized for the RESUME row, which is the widest by some
          way and was the one it was not sized for: the graded stages render
          "0 /100" and stop, while a CV carries a third element nothing else
          has — the eligibility pill — after a "rank" that replaces the
          denominator rather than shortening it.

          Measured in Jost rather than estimated, because being a few px short
          here does not wrap or ellipsise, it truncates the verdict to
          "Eligib": `Screening 0 /100` is 140px and fitted the old 150px box,
          `Resume 90 rank Eligible` is 176px and did not, and the worst real
          case — `Resume 100 rank Ineligible` — is 193px. */}
      {item.score !== null && item.scoreStage && (
        <span className="flex w-[200px] shrink-0 items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-[#9CA3AF]">
            {SCORE_STAGE_LABEL[item.scoreStage]}
          </span>
          <ScoreInline score={item.score} tier={item.tier} />
        </span>
      )}

      {/* Only escalation gets a badge. Everything in this group is late — the
          group heading says so — so a badge on every row would repeat the
          heading; the one thing a row can add is that it went past the second
          threshold too. */}
      {item.sla?.level === "escalation" && (
        <span className="shrink-0 rounded-md border border-[#FCA5A5] bg-[#FEE2E2] px-2 py-0.5 text-[11px] font-semibold text-[#991B1B]">
          Escalated
        </span>
      )}

      {/* The age is the queue's sort key, so it gets a column of its own and
          aligns down the list — the person who has been waiting longest should
          be findable without reading eight sentences. */}
      <span className="w-[92px] shrink-0 text-right text-xs tabular-nums text-[#9CA3AF]">
        {waitedFor(item.hoursInStage)}
      </span>

      <svg
        aria-hidden
        className="h-4 w-4 shrink-0 text-[#D1D5DB] transition-colors duration-150 group-hover:text-primary"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

/**
 * Compact age for the right-hand column. The word "waiting" stays because a
 * bare "18d" in a row of dates could be read as when they applied.
 */
function waitedFor(hours: number): string {
  if (hours < 1) return "<1h waiting";
  if (hours < 24) return `${Math.floor(hours)}h waiting`;
  return `${Math.floor(hours / 24)}d waiting`;
}
