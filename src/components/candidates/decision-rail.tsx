import type { ReactNode } from "react";
import {
  TIER_LABELS,
  type ApplicationState,
  type CandidateScore,
} from "@/lib/constants";
import { decisionPrompt } from "@/lib/candidates/decision-prompt";
import { AiCaption } from "@/components/ui";

const TIER_TONE: Record<string, string> = {
  strong: "text-tier-strong bg-[#ECFDF5] border-[#A7F3D0]",
  moderate: "text-tier-potential bg-[#FEF3C7] border-[#FDE68A]",
  weak: "text-tier-weak bg-[#FEF2F2] border-[#FECACA]",
  no_match: "text-tier-no-match bg-[#FEE2E2] border-[#FCA5A5]",
};

const STAGES: { key: CandidateScore["stage"]; label: string }[] = [
  { key: "resume", label: "CV" },
  { key: "screening", label: "Screening" },
  { key: "interview", label: "Interview" },
];

/**
 * The three stage scores side by side, and nothing else.
 *
 * Three numbers in a column is exactly the shape that invites someone to add
 * them up, so the card says outright that there is no combined figure. Each is
 * a separate model reading separate evidence against a separate rubric, and the
 * PRD requires managers to inspect them independently rather than through a
 * rollup gate.
 */
export function StageScoresCard({ scores }: { scores: CandidateScore[] }) {
  return (
    <section className="rounded-xl border border-[#E5E7EB] bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">
        Stage scores
      </h2>

      <ul className="mt-4 space-y-3">
        {STAGES.map(({ key, label }) => {
          const score = scores.find((s) => s.stage === key);
          return (
            <li key={key} className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-[#4B5563]">{label}</p>
                <p className="mt-0.5 text-xs text-[#9CA3AF]">
                  {score
                    ? `rubric v${score.rubric_version ?? "—"} · ${new Date(
                        score.scored_at,
                      ).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}`
                    : "not taken yet"}
                </p>
              </div>
              <div className="flex shrink-0 items-baseline gap-2">
                {score ? (
                  <>
                    <span className="text-lg font-semibold tabular-nums text-ink">
                      {score.overall}
                    </span>
                    {score.tier && (
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          TIER_TONE[score.tier]
                        }`}
                      >
                        {TIER_LABELS[score.tier]}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-lg text-[#D1D5DB]">—</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <AiCaption className="mt-4">
        Kept separate on purpose. There is no combined figure, and none of these
        moved anybody.
      </AiCaption>
    </section>
  );
}

/**
 * The decision, pinned beside the evidence rather than buried under it.
 *
 * The heading is a claim about the state machine, not a label: it says what has
 * happened and who it is waiting on, so a state where nothing is owed does not
 * present a row of buttons that imply otherwise.
 */
export function DecisionCard({
  status,
  children,
}: {
  status: ApplicationState;
  children: ReactNode;
}) {
  const prompt = decisionPrompt(status);

  return (
    <section
      className={`rounded-xl border p-5 ${
        prompt.waitingOnYou ? "border-[#D1D5DB] bg-white" : "border-[#E5E7EB] bg-[#F9FAFB]"
      }`}
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">
        Your decision
      </h2>
      <p className="mt-3 text-sm font-semibold text-ink">{prompt.headline}</p>
      <p className="mt-1 text-sm leading-relaxed text-[#6B7280]">{prompt.detail}</p>

      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}
