import {
  CANDIDATE_STAGES,
  TIER_LABELS,
  toCandidateStage,
  type ApplicationState,
  type CandidateScore,
  type CandidateStage,
  type ScreeningTier,
  type SlaBreachLevel,
} from "@/lib/constants";
import { scoreAbsenceLabel } from "./score-absence";

/**
 * The facts in a candidate's header and decision rail, worked out away from the
 * markup.
 *
 * All of it is one-of-N mappings and small arithmetic, which is exactly the
 * kind of thing that rots quietly inside JSX — a new application state gets
 * added, one branch is missed, and a page says "not taken yet" about an
 * interview that expired.
 */

// ─── The stage pill ──────────────────────────────────────────────────────────

export interface StagePill {
  label: string;
  /** Dot + text. */
  ink: string;
  bg: string;
}

/**
 * One pill per pipeline bucket, in the same palette the funnel and the
 * candidate table use — a candidate must not change colour between the list
 * they were clicked from and the page they land on.
 */
const STAGE_PILL: Record<CandidateStage, StagePill> = {
  applied: { label: "New", ink: "#475569", bg: "#F1F5F9" },
  screening: { label: "Screening", ink: "#2563EB", bg: "#EFF6FF" },
  interview: { label: "Interview", ink: "#7C3AED", bg: "#F5F3FF" },
  final_interview: { label: "Final interview", ink: "#D97706", bg: "#FEF3C7" },
  hired: { label: "Hired", ink: "#059669", bg: "#ECFDF5" },
  rejected: { label: "Rejected", ink: "#DC2626", bg: "#FEF2F2" },
};

export function stagePill(status: ApplicationState): StagePill {
  return STAGE_PILL[toCandidateStage(status)];
}

// ─── Time in stage, and whether that is a problem ────────────────────────────

/** "3 days in stage" / "6 hours in stage". Null when nothing has moved yet. */
export function timeInStageLabel(hours: number | null): string | null {
  if (hours === null || !Number.isFinite(hours) || hours < 0) return null;
  if (hours < 1) return "under an hour in stage";
  if (hours < 48) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? "" : "s"} in stage`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} in stage`;
}

export interface SlaPhrase {
  text: string;
  breached: boolean;
}

/**
 * The SLA half of the header line.
 *
 * "within SLA" is worth saying out loud. Silence there is ambiguous between
 * "fine" and "this campaign has no timer for this stage", and those are
 * different facts about whether anyone will be told when this stalls.
 */
export function slaPhrase(
  sla: { level: SlaBreachLevel; hours: number } | null,
  hasTimerForStage: boolean,
): SlaPhrase {
  if (sla) {
    return {
      text: sla.level === "escalation" ? "past SLA · escalated" : "past SLA",
      breached: true,
    };
  }
  return {
    text: hasTimerForStage ? "within SLA" : "no SLA timer on this stage",
    breached: false,
  };
}

// ─── The three stage scores ──────────────────────────────────────────────────

export type ScoreStage = CandidateScore["stage"];

const SCORE_STAGES: { key: ScoreStage; label: string }[] = [
  { key: "resume", label: "CV" },
  { key: "screening", label: "Screening" },
  { key: "interview", label: "Interview" },
];

const STAGE_RANK: Record<ScoreStage, number> = {
  resume: 0,
  screening: 1,
  interview: 2,
};

/** The furthest scored stage an application in this state has *reached*. */
const REACHED_BY_STATE: Record<ApplicationState, ScoreStage> = {
  new: "resume",
  screening_review_pending: "resume",
  screening_approved: "resume",
  processing_failed: "resume",

  screening_sent: "screening",
  screening_completed: "screening",
  screening_scored: "screening",
  screening_expired: "screening",

  interview_invited: "interview",
  interview_scheduling: "interview",
  interview_scheduled: "interview",
  interview_completed: "interview",
  interview_scored: "interview",
  interview_expired: "interview",
  interview_no_show: "interview",

  reference_check: "interview",
  manager_review: "interview",
  final_interview_scheduling: "interview",
  hired: "interview",

  // Terminal-by-decision: the state says nothing about where it happened, so
  // the scores on file are the only evidence of how far this person got.
  rejected: "resume",
  archived: "resume",
};

export interface StageScoreRow {
  key: ScoreStage;
  label: string;
  score: number | null;
  tier: ScreeningTier | null;
  tierLabel: string | null;
  /** "rubric v3 · 14 Aug" when scored, the named absence when not. */
  detail: string;
  /** True once the pipeline has arrived here — drives the indigo vs grey rail. */
  reached: boolean;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * The rail's three rows: CV, Screening, Interview — and never a fourth.
 *
 * Three numbers stacked in a column is exactly the shape that invites someone
 * to average them, which is why the card that renders this says outright that
 * there is no combined figure. The absence of a score is named per stage: a
 * stage the pipeline has not reached reads differently from one it reached and
 * lapsed in, and only the second is a thing to chase.
 */
export function stageScoreRows(
  scores: CandidateScore[],
  status: ApplicationState,
): StageScoreRow[] {
  const furthestScored = Math.max(
    -1,
    ...scores.map((s) => STAGE_RANK[s.stage] ?? -1),
  );
  const reachedRank = Math.max(STAGE_RANK[REACHED_BY_STATE[status]], furthestScored);

  return SCORE_STAGES.map(({ key, label }) => {
    const score = scores.find((s) => s.stage === key);
    const rank = STAGE_RANK[key];

    if (score) {
      const version = score.rubric_version;
      return {
        key,
        label,
        score: score.overall,
        tier: score.tier ?? null,
        tierLabel: score.tier ? TIER_LABELS[score.tier] : null,
        detail: `${version === null ? "rubric —" : `rubric v${version}`} · ${shortDate(
          score.scored_at,
        )}`,
        reached: true,
      };
    }

    // Sentence case, and never case-folded: `scoreAbsenceLabel` is free to
    // return something with an acronym in it, and no lower-casing rule can
    // tell "CV" from an ordinary word.
    const detail =
      rank > reachedRank
        ? "Not reached yet"
        : rank === reachedRank
          ? scoreAbsenceLabel(status)
          : // Passed through without producing one — a stage with no rubric.
            "No score recorded";

    return {
      key,
      label,
      score: null,
      tier: null,
      tierLabel: null,
      detail,
      reached: rank <= reachedRank,
    };
  });
}

// ─── Prev / next within the stage ────────────────────────────────────────────

export interface NeighbourNav {
  /** 1-based position among the candidates in the same bucket. */
  position: number;
  total: number;
  stageName: string;
  prevId: string | null;
  nextId: string | null;
}

/**
 * Where this candidate sits in the list you clicked in from, and who is either
 * side of them.
 *
 * Scoped to the current pipeline bucket rather than the whole campaign: the
 * recruiter is working a stage, and stepping from the last of 31 in Screening
 * straight into someone already hired would not be "next".
 */
export function neighbourNav(
  candidates: { id: string; status: ApplicationState }[],
  currentId: string,
): NeighbourNav | null {
  const current = candidates.find((c) => c.id === currentId);
  if (!current) return null;

  const bucket = toCandidateStage(current.status);
  const peers = candidates.filter((c) => toCandidateStage(c.status) === bucket);
  const index = peers.findIndex((c) => c.id === currentId);
  if (index === -1) return null;

  return {
    position: index + 1,
    total: peers.length,
    stageName:
      CANDIDATE_STAGES.find((s) => s.key === bucket)?.name ?? STAGE_PILL[bucket].label,
    prevId: index > 0 ? peers[index - 1].id : null,
    nextId: index < peers.length - 1 ? peers[index + 1].id : null,
  };
}

// ─── The interview that has not happened ─────────────────────────────────────

export interface InterviewAbsence {
  title: string;
  body: string;
}

/**
 * Why there is no interview evidence, said precisely.
 *
 * "Not yet" and "the window closed unused" are different facts with different
 * next actions, and a single empty state covering both would quietly turn a
 * no-show into someone still being waited on. The closing sentence is fixed
 * across all of them on purpose: an empty proctoring section means the camera
 * never watched this person, which is *not* the same as a clean run, and that
 * distinction has to survive whichever branch produced the card.
 */
const NEVER_WATCHED =
  "Integrity monitoring has therefore never watched this candidate, which is not the same as a clean run.";

export function interviewAbsence(status: ApplicationState): InterviewAbsence {
  switch (status) {
    case "interview_invited":
    case "interview_scheduling":
    case "interview_scheduled":
      return {
        title: "Invited — not started",
        body: `The link is live and the deadline is running. No transcript, section scores or proctoring report exist until they take it, so this section stays empty rather than showing zeros. ${NEVER_WATCHED}`,
      };

    case "interview_expired":
      return {
        title: "The interview window closed unused",
        body: `The invite lapsed before the candidate started. Nobody rejected them — this needs a decision or a new invite. ${NEVER_WATCHED}`,
      };

    case "interview_no_show":
      return {
        title: "Recorded as a no-show",
        body: `The window closed with nothing captured. Nobody rejected them — this needs a decision or a new invite. ${NEVER_WATCHED}`,
      };

    case "interview_completed":
      return {
        title: "Interview taken, not yet scored",
        body: `The call is in and the transcript is being read. Section scores and the proctoring report appear when scoring finishes. ${NEVER_WATCHED}`,
      };

    case "rejected":
    case "archived":
      return {
        title: "No AI interview took place",
        body: `This application closed before the interview stage produced anything. ${NEVER_WATCHED}`,
      };

    default:
      return {
        title: "AI interview hasn't happened yet",
        body: `Advancing sends the invite and opens the response window. No transcript, section scores or proctoring report exist until they take it, so this section stays empty rather than showing zeros. ${NEVER_WATCHED}`,
      };
  }
}

// ─── Pulling the three stages back together ──────────────────────────────────

/** The interview score's shape on `interview_sessions`, which is not a `CandidateScore`. */
export interface InterviewScoreLike {
  overall_score: number;
  overall_rationale: string;
  rubric_version: number | null;
  scored_at: string;
}

/**
 * The interview score, folded in beside the CV and screening ones.
 *
 * `buildScoresArray` only ever produces `resume` and `screening` — the
 * interview's lives on `interview_sessions` and is rendered by the transcript
 * component. Without this the rail claimed "not reached yet" about an interview
 * that had been taken *and* scored, which is the exact failure the rail exists
 * to prevent: three stage scores you can compare at a glance, from any scroll
 * depth.
 */
export function withInterviewScore(
  scores: CandidateScore[],
  interview: InterviewScoreLike | null,
): CandidateScore[] {
  if (!interview || scores.some((s) => s.stage === "interview")) return scores;

  return [
    ...scores,
    {
      stage: "interview",
      overall: interview.overall_score,
      // No tier: the interview scorer bands nothing, and inventing one here
      // would put a verdict on screen that no model ever produced.
      ai_summary: interview.overall_rationale,
      // No evidence record either — `evaluation` belongs to resume screening,
      // which is the only stage that reports per-criterion levels.
      evaluation: null,
      factors: [],
      scored_at: interview.scored_at,
      rubric_version: interview.rubric_version,
      current_rubric_version: null,
    },
  ];
}

/** Rubric stage keys are not score stage keys — `screening_q` vs `screening`. */
const RUBRIC_STAGE: Record<ScoreStage, "resume" | "screening_q" | "interview"> = {
  resume: "resume",
  screening: "screening_q",
  interview: "interview",
};

/**
 * Which criteria the campaign marked must-have, so the score breakdown can say
 * which failures are disqualifying and which are preferences.
 */
export function mandatoryDimensionNames(
  rubrics: { stage: string; dimensions: { name: string; is_mandatory: boolean }[] }[],
  stage: ScoreStage,
): string[] {
  return (
    rubrics
      .find((r) => r.stage === RUBRIC_STAGE[stage])
      ?.dimensions.filter((d) => d.is_mandatory)
      .map((d) => d.name) ?? []
  );
}
