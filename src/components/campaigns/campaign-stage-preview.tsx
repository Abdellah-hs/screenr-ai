import Link from "next/link";
import { pipelineDisplayScore, type Candidate } from "@/lib/constants";
import { daysInStage, lastActivityLabel } from "@/lib/campaigns/detail-view";
import { StageChanger } from "@/components/candidates/stage-changer";
import { MENU_ITEM, ScoreAbsent, ScoreInline } from "@/components/ui";
import { scoreAbsenceLabel } from "@/lib/candidates/score-absence";

const STAGE_SCORE_HEADING: Record<string, string> = {
  applied: "CV score",
  screening: "Screening score",
  interview: "Interview score",
};

/**
 * The candidates sitting in one pipeline stage, on the campaign page.
 *
 * Deliberately not the whole table: the campaign page's job is to show what is
 * happening, and a stage at a time is the unit a recruiter thinks in. The full
 * table is one link away and keeps the filtering, sorting and bulk actions.
 *
 * The score is railed in indigo because a model wrote it — the same attribution
 * as everywhere else, at row scale.
 */
export function CampaignStagePreview({
  campaignId,
  stageKey,
  stageName,
  candidates,
  total,
  now,
  limit = 5,
}: {
  campaignId: string;
  stageKey: string;
  stageName: string;
  /** Already filtered to this stage, in the order they should appear. */
  candidates: Candidate[];
  total: number;
  /** One clock reading for every row, taken by the page. */
  now: Date;
  limit?: number;
}) {
  const rows = candidates.slice(0, limit);
  const scoreHeading = STAGE_SCORE_HEADING[stageKey] ?? "Stage score";

  return (
    <section
      id="candidates"
      className="scroll-mt-6 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-[#E5E7EB] px-[22px] py-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
          Candidates in {stageName}
        </h2>
        <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[11px] font-semibold text-[#4B5563]">
          {total}
        </span>
        <Link
          href={`/campaigns/${campaignId}/candidates?stage=${stageKey}`}
          className="ml-auto text-[13px] font-semibold text-primary hover:underline"
        >
          Open the full table →
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="px-[22px] py-8 text-center text-[13px] text-[#6B7280]">
          Nobody is in {stageName} right now.
        </p>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-[#F9FAFB]">
              <th className="border-b border-[#E5E7EB] px-[22px] py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                Candidate
              </th>
              <th className="border-b border-[#E5E7EB] px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                {scoreHeading}
              </th>
              <th className="border-b border-[#E5E7EB] px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                In stage
              </th>
              <th className="border-b border-[#E5E7EB] px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                Last activity
              </th>
              <th className="w-14 border-b border-[#E5E7EB] py-2.5 pl-3 pr-[22px]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((candidate) => {
              const score = pipelineDisplayScore(candidate);
              return (
                <tr
                  key={candidate.id}
                  className="border-b border-[#F3F4F6] transition-colors duration-150 hover:bg-[#F9FAFB]"
                >
                  <td className="px-[22px] py-3">
                    <Link
                      href={`/campaigns/${campaignId}/candidates/${candidate.id}`}
                      className="block"
                    >
                      <span className="block font-semibold text-ink">
                        {candidate.name}
                      </span>
                      <span className="block text-xs text-[#6B7280]">
                        {candidate.email}
                      </span>
                    </Link>
                  </td>

                  <td className="px-3 py-3">
                    {score ? (
                      <ScoreInline score={score.overall} tier={score.tier} />
                    ) : (
                      /* Never a dash: the reason there is no number here is a
                         fact about the application, and each reason has a
                         different next action. */
                      <ScoreAbsent>{scoreAbsenceLabel(candidate.status)}</ScoreAbsent>
                    )}
                  </td>

                  <td className="px-3 py-3 text-right tabular-nums text-[#374151]">
                    {daysInStage(candidate.updated_at, now)}
                  </td>

                  <td className="px-3 py-3 text-[#4B5563]">
                    {lastActivityLabel(candidate.status, candidate.updated_at, now)}
                  </td>

                  <td className="py-3 pl-3 pr-[22px] text-right">
                    <StageChanger
                      applicationId={candidate.id}
                      currentState={candidate.status}
                      trigger="menu"
                      leadingItems={
                        <Link
                          href={`/campaigns/${campaignId}/candidates/${candidate.id}`}
                          role="menuitem"
                          className={MENU_ITEM}
                        >
                          Open the evidence file
                        </Link>
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {total > rows.length && (
        <p className="border-t border-[#F3F4F6] bg-[#F9FAFB] px-[22px] py-3 text-xs text-[#6B7280]">
          Showing {rows.length} of {total} in {stageName}.{" "}
          <Link
            href={`/campaigns/${campaignId}/candidates?stage=${stageKey}`}
            className="font-semibold text-primary hover:underline"
          >
            Open the full table
          </Link>
        </p>
      )}
    </section>
  );
}
