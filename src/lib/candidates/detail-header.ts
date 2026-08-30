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
import { eventLabel } from "@/lib/campaigns/detail-view";

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

/**
 * Every state that ENDED without anybody turning the candidate down.
 *
 * `APPLICATION_STAGE_BUCKET` folds these into `rejected`, which is right for
 * the funnel — it answers "still in play?", and none of them are — but wrong as
 * a label on somebody's file. The overview already split them out of its rail
 * for exactly this reason; the pill beside the name was the copy it missed, so
 * the queue group headed "nobody was rejected" linked to a page whose loudest
 * object was a red REJECTED.
 *
 * `processing_failed` is the one it hurt most: that state means OUR extractor
 * fell over, so the pill reported our outage as a verdict on the candidate.
 */
const CLOSED_OUT_STATES: ApplicationState[] = [
  "screening_expired",
  "interview_expired",
  "interview_no_show",
  "processing_failed",
  "archived",
];

/**
 * Grey, not red: the colour has to say "no verdict was reached", and it is the
 * same grey the funnel's archived row and the overview's lapsed group already
 * use. Red is reserved for a rejection somebody actually made.
 */
const CLOSED_OUT_INK = "#6B7280";
const CLOSED_OUT_BG = "#F3F4F6";

export function stagePill(status: ApplicationState): StagePill {
  // The label is the EVENT, from the same map the overview row and the
  // candidate's own history read — "Interview window closed" on the row you
  // clicked, "Interview window closed" on the page you land on. A pill that
  // renamed it would break the one thing this palette exists to hold: a
  // candidate must not change between the list and their page.
  if (CLOSED_OUT_STATES.includes(status)) {
    return { label: eventLabel(status), ink: CLOSED_OUT_INK, bg: CLOSED_OUT_BG };
  }
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
  /**
   * The stage the pipeline is actually sitting in, as opposed to one it merely
   * got past. Exactly the rows whose `detail` came from `scoreAbsenceLabel`,
   * which is what makes "Screening expired" attributable to a stage: every
   * earlier stage is `reached` too, and a lapse belongs to one of them.
   */
  current: boolean;
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
        current: rank === reachedRank,
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
      current: rank === reachedRank,
    };
  });
}

// ─── What each stage's assessment says about itself ──────────────────────────

export interface StageAssessmentCopy {
  /** e.g. "Voice screening · AI assessment" */
  eyebrow: string;
  /** e.g. "Screening score" */
  title: string;
  /** The "an AI wrote this" sentence, which differs by stage. Optional: the
   *  resume stage dropped its own, and shows only the provenance. */
  fallibility?: string;
}

/**
 * The three fallibility notes, in one place.
 *
 * They are near-identical on purpose — a recruiter should meet the same
 * sentence at every stage — and they differ in exactly one way: the interview
 * score also admits that it never gates. That single difference is the whole
 * reason this is a map and not a constant, and it is the first thing that
 * would drift if each component wrote its own copy. The interview's entry sat
 * unused on the candidate page for exactly that reason: the interview score
 * renders from its own component, which had no attribution at all.
 */
export const STAGE_ASSESSMENT_COPY: Record<ScoreStage, StageAssessmentCopy> = {
  resume: {
    eyebrow: "CV · AI assessment",
    // Not "CV score". This stage produces a pass/fail gate and a ranking over
    // the optional criteria — two results, and neither is a grade for the CV.
    // The old title made the smaller of the two sound like the verdict.
    title: "CV assessment",
  },
  screening: {
    eyebrow: "Voice screening · AI assessment",
    title: "Screening score",
    fallibility:
      "An AI scored the transcript of a spoken call. It can be wrong, and it moved nobody.",
  },
  interview: {
    eyebrow: "AI interview · AI assessment",
    title: "Interview score",
    fallibility:
      "An AI scored the transcript. It can be wrong, it never gates, and it moved nobody.",
  },
};

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
 *
 * Exported for the same reason it is a constant: the candidate page's own
 * "Never monitored" cards make exactly this claim, and had been making it in a
 * second, differently-worded sentence. One claim, one wording — otherwise the
 * two drift and a reader has to work out whether they mean the same thing.
 */
export const NEVER_WATCHED =
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
 *
 * **Resume is the only stage this is true of.** Screening and the interview
 * have no must-have gate, so a "· must-have" suffix there would name a rule
 * nothing enforces — the flag survives on old rows only because rubrics are
 * never rewritten in place. Keyed by stage rather than hard-wired to resume so
 * a caller has to say which stage it is asking about.
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

// ─── Did this stage actually happen? ────────────────────────────────────────
//
// What decides, on the candidate detail page, between rendering a stage's
// evidence and rendering a named absence in its place.
//
// These used to live in the page, under a comment reading "mirrors the guards
// the components apply to themselves" — which is to say, the page re-derived
// them and each component ALSO returned null on its own copy. That is fine
// while the two agree and fails silently when they drift: the page renders the
// panel, the panel renders nothing, and the recruiter gets a blank evidence
// view with no absence card and no explanation. Untestable there, too, since
// components are verified by hand.
//
// One definition, here, where it can be tested. The components' own early
// returns become the caller's decision.

/** The half of an interview session these predicates read. */
export interface InterviewSessionLike {
  status: string;
  transcript?: unknown[] | null;
}

/**
 * Did the candidate actually sit the interview?
 *
 * An `invited` session with an empty transcript is a pending link, not an
 * interview — the pipeline stage already says so, and a transcript card over it
 * would be an empty white box.
 */
export function interviewWasTaken(session: InterviewSessionLike | null): boolean {
  if (!session) return false;
  return !(session.status === "invited" && (session.transcript ?? []).length === 0);
}

/** The half of a screening response these predicates read. */
export interface ScreeningResponseLike {
  status: string;
  transcript?: unknown[] | null;
}

/**
 * Has the screening thread got anything on it yet?
 *
 * `not_sent` and `pending` are both "nothing has happened", and the difference
 * between them is not something the thread can show.
 */
export function screeningWasSent(response: ScreeningResponseLike | null | undefined): boolean {
  const status = response?.status ?? "not_sent";
  return status !== "not_sent" && status !== "pending";
}

/**
 * Did a voice call actually take place?
 *
 * A transcript with turns on it is what makes it a call; the status is what
 * makes it a FINISHED one. Both, because a transcript can exist mid-call.
 */
export function screeningCallWasTaken(
  response: ScreeningResponseLike | null | undefined,
): boolean {
  if ((response?.transcript ?? []).length === 0) return false;
  return response?.status === "responded" || response?.status === "scored";
}
