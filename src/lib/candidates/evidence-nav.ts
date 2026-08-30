import type { ApplicationState, CandidateScore } from "@/lib/constants";
import { stageScoreRows, type ScoreStage } from "./detail-header";
import { isLapsedAbsence } from "./score-absence";

/**
 * The evidence file, as a set of views rather than one long scroll.
 *
 * Each key is one thing a recruiter is looking at, and only ever one: the whole
 * point of the change is that reading the screening does not mean scrolling
 * past the CV. The key is also the URL, so a particular reading is linkable and
 * survives a refresh — a recruiter can send a colleague the interview
 * proctoring report rather than "the candidate page, scroll down".
 *
 * The parsed CV is deliberately not among them. Everything in this list is a
 * reading *of* the candidate; the parse is the document itself, so it sits one
 * level up as a page tab — see `CANDIDATE_DETAIL_TABS`.
 *
 * The list is fixed. A nav whose rows appear and vanish per candidate teaches
 * nobody where anything is, so every stage is always listed and each view names
 * its own absence instead.
 */
export const EVIDENCE_VIEWS = [
  "cv",
  "screening",
  "screening-proctoring",
  "interview",
  "interview-proctoring",
] as const;

export type EvidenceView = (typeof EVIDENCE_VIEWS)[number];

/** What the page opens on: the AI's reading of the CV. */
export const DEFAULT_EVIDENCE_VIEW: EvidenceView = "cv";

/**
 * The `view` search param, believed only when it names a real view.
 *
 * A URL is user input. Anything unrecognised falls back to the default rather
 * than rendering an empty panel, so a stale or hand-edited link still opens a
 * candidate's file at something.
 */
export function resolveEvidenceView(raw: string | string[] | undefined): EvidenceView {
  if (typeof raw !== "string") return DEFAULT_EVIDENCE_VIEW;
  return (EVIDENCE_VIEWS as readonly string[]).includes(raw)
    ? (raw as EvidenceView)
    : DEFAULT_EVIDENCE_VIEW;
}

/**
 * How a stage caption should read — the difference between a stage that is
 * working and a stage that quietly stopped.
 *
 * `pending` and `lapsed` were rendered identically until now, and they are
 * opposite facts: "Awaiting the call" needs nothing from anybody, "Screening
 * expired" needs someone today. `isLapsedAbsence` already draws that line for
 * the candidate table; the strip now draws it in the same place.
 *
 * `upcoming` is the lightest of the four, so two tiles both saying "Not reached
 * yet" recede instead of shouting the same non-fact twice.
 */
export type EvidenceCaptionTone = "reading" | "pending" | "lapsed" | "upcoming";

/**
 * A stage score against its campaign bar.
 *
 * `miss` exists because red and amber are **not** interchangeable here, and the
 * evaluation panels already prove it: a resume under `resume_threshold` is
 * rejected, so it renders red; a screening under `screening_threshold` rests at
 * `screening_scored` for a person to decide (2026-08-22), so it renders amber.
 * Dressing the second as a failure would misstate what happens next.
 *
 * `threshold` is null on the interview, which sets no bar at all and must not be
 * given one by implication — the absent tick is the point, not an omission.
 */
export interface EvidenceNavMeter {
  /** 0-100, the fill width. */
  score: number;
  /** The campaign's pass mark, or null on a stage that sets none. */
  threshold: number | null;
  /** At or above the mark. Null where there is no mark to be at or above. */
  clears: boolean | null;
  /** What missing the mark does. Null where there is no mark. */
  miss: "rejects" | "holds" | null;
}

export interface EvidenceNavNode {
  /** The view this tile selects. */
  view: EvidenceView;
  label: string;
  /** The figure beside the label — a stage score or a count. Null on sub-items. */
  meta: string | null;
  /** The tile leads somewhere real but empty: rendered quiet, still reachable. */
  quiet: boolean;
  /**
   * The tile's second line, and it is never blank on a stage.
   *
   * This is the one thing the strip changed about the old vertical rail. There,
   * subtext was suppressed for a stage the pipeline had not reached, because a
   * column of rows with a grey sentence under each is noise. In a row of three
   * equal boxes the opposite holds: a tile with a blank second line reads as a
   * rendering fault, and the three captions line up as a column of their own,
   * so "Eligible / Awaiting the call / Not reached yet" is the fastest thing on
   * the page to read.
   *
   * Scored stages say what the score *was* — the tier — rather than repeating
   * the number in words. The rubric and date behind it belong on the panel,
   * which prints them under the score itself.
   */
  caption: string | null;
  /** How the caption should read. See `EvidenceCaptionTone`. */
  captionTone: EvidenceCaptionTone;
  /**
   * Where this stage's number sits against the bar the campaign set for it.
   *
   * Null when there is no number — never a zero-width bar, because a meter
   * pinned at the left end is a picture of "how close they came" and that is
   * precisely the argument an unscored stage must not invite.
   */
  meter: EvidenceNavMeter | null;
  /**
   * What the stage's own panel is called once a sub-switch has to name its
   * parts — "The call" beside "Proctoring". Null on a stage with no sub-view,
   * which needs no switch and therefore no name for its own half.
   *
   * It is not the `label`: repeating "Screening" in a switch that sits directly
   * under the Screening tile says nothing about which of the two readings you
   * are choosing between.
   */
  selfLabel: string | null;
  children: EvidenceNavNode[];
}

export interface EvidenceNavInput {
  scores: CandidateScore[];
  status: ApplicationState;
  /** A screening proctoring report exists — the browser-signal half. */
  screeningProctored: boolean;
  /** An interview proctoring report exists — browser signals plus vision. */
  interviewProctored: boolean;
  /**
   * The campaign's two bars — and there are exactly two, which is why this is
   * not one number. `resume_threshold` orders a pile of CVs and rejects below
   * itself; `screening_threshold` grades spoken answers and only advances above
   * itself. The interview sets none and is deliberately absent here.
   */
  thresholds: { resume: number; screening: number };
}

/**
 * The strip.
 *
 * Proctoring hangs under the stage it was captured in rather than standing on
 * its own, because that is what it is: a screening report and an interview
 * report are different evidence about different sittings, and the interview's
 * is the only one with a camera behind it. One shared "Proctoring" row would
 * have to pick one of them and silently hide the other.
 *
 * The parents carry the stage scores **side by side and never summed** — which
 * this shape states rather than merely asserting. The rail this replaced stacked
 * the three numbers in a 222px column and then printed a caption under them
 * saying there was no combined figure; a vertical stack of three numbers is the
 * exact shape that invites an average, so the copy was arguing with the layout.
 * Three tiles in a row are three separate readings on their face.
 */
export function evidenceNavTree({
  scores,
  status,
  screeningProctored,
  interviewProctored,
  thresholds,
}: EvidenceNavInput): EvidenceNavNode[] {
  const rows = stageScoreRows(scores, status);
  // A lapse belongs to the stage the pipeline stopped in, not to every stage it
  // got past — and every earlier stage is `reached` too, so `current` is what
  // makes the attribution possible.
  const lapsed = isLapsedAbsence(status);

  const stageRow = (
    view: EvidenceView,
    label: string,
    stage: ScoreStage,
    selfLabel: string | null,
    /** The bar this stage sets, and what dropping below it does. Null on the
     *  interview, which sets none — see `EvidenceNavMeter`. */
    gate: { threshold: number; miss: "rejects" | "holds" } | null,
    children: EvidenceNavNode[],
  ): EvidenceNavNode => {
    const row = rows.find((r) => r.key === stage);
    const score = row?.score ?? null;
    const reached = row?.reached ?? false;
    return {
      view,
      label,
      meta: score === null ? "—" : String(score),
      quiet: score === null,
      // Scored: the tier, which is the reading the number stands for. Unscored:
      // the named absence, which is the whole of what there is to say. Either
      // way the line is filled — see `caption` on the interface for why a stage
      // tile is never allowed a blank one.
      caption: score === null ? (row?.detail ?? null) : (row?.tierLabel ?? row?.detail ?? null),
      captionTone:
        score !== null
          ? "reading"
          : !reached
            ? "upcoming"
            : lapsed && row?.current
              ? "lapsed"
              : "pending",
      meter:
        score === null
          ? null
          : {
              score,
              threshold: gate?.threshold ?? null,
              clears: gate ? score >= gate.threshold : null,
              miss: gate?.miss ?? null,
            },
      selfLabel: children.length > 0 ? selfLabel : null,
      children,
    };
  };

  const child = (view: EvidenceView, label: string, quiet = false): EvidenceNavNode => ({
    view,
    label,
    meta: null,
    quiet,
    caption: null,
    captionTone: "pending",
    meter: null,
    selfLabel: null,
    children: [],
  });

  return [
    // Below `resume_threshold` an eligible CV is rejected outright, so a miss
    // here reads as a failure and is allowed to.
    stageRow("cv", "CV", "resume", null, { threshold: thresholds.resume, miss: "rejects" }, []),
    // Below `screening_threshold` nothing is rejected — it rests for a person
    // (2026-08-22). A miss holds; it does not fail.
    stageRow(
      "screening",
      "Screening",
      "screening",
      "The call",
      { threshold: thresholds.screening, miss: "holds" },
      [child("screening-proctoring", "Proctoring", !screeningProctored)],
    ),
    // No gate, at any threshold, deliberately: the interview never rejects, so
    // it has no bar to draw and must not be given one by implication.
    stageRow("interview", "Interview", "interview", "The interview", null, [
      child("interview-proctoring", "Proctoring", !interviewProctored),
    ]),
  ];
}

/**
 * The candidate page's three views, in the order they answer questions.
 *
 * The parsed CV is what the candidate said about themselves; the evidence file
 * is everything anyone has since concluded about them; the history is what the
 * system did about it. The document comes first, and is what the page opens on,
 * because it is the thing every reading further along is a reading *of* — meet
 * the person before the verdicts.
 *
 * Keeping them one level apart also means the document is never a sub-item of
 * an opinion about it, and each gets the full width of the page.
 *
 * **History is a tab, not an evidence view.** It was one until 2026-08-24, sat
 * in the corner of the evidence strip, and did not belong there: everything in
 * that strip is an AI reading of one sitting, and the audit trail is neither AI
 * nor a reading. Its figure counts events rather than grading anything, so
 * beside three scores it was a fourth number inviting the same glance — which is
 * exactly what the strip's own caption exists to forbid.
 */
export const CANDIDATE_DETAIL_TABS = [
  { key: "parsed", label: "Parsed CV" },
  { key: "evidence", label: "Evidence file" },
  { key: "history", label: "History" },
] as const;

export type CandidateDetailTab = (typeof CANDIDATE_DETAIL_TABS)[number]["key"];

/** The tab a bare candidate URL opens: the first one, as the bar reads. */
export const DEFAULT_CANDIDATE_TAB: CandidateDetailTab = CANDIDATE_DETAIL_TABS[0].key;

/** A stale or hand-edited `?tab=` opens the default tab, never nothing. */
export function resolveCandidateTab(
  raw: string | string[] | undefined,
): CandidateDetailTab {
  const match = CANDIDATE_DETAIL_TABS.find((t) => t.key === raw);
  return match ? match.key : DEFAULT_CANDIDATE_TAB;
}

/**
 * A link to one candidate reading, naming **both** halves of the selection.
 *
 * The page holds two independent choices — which tab, and which evidence view —
 * and each resolver falls back to its default when its param is absent rather
 * than holding still. So a link naming only one of them silently resets the
 * other. That is how every tile of the evidence strip (`?view=screening`) landed
 * the reader back on the Parsed CV: no `tab`, so `resolveCandidateTab` answered
 * `parsed`. Both params are written here, in one place, so no caller can drop
 * one by omission.
 *
 * The default tab is left out of the query so a bare candidate URL stays the
 * canonical one — it resolves to `parsed` either way.
 */
export function candidateDetailHref(
  basePath: string,
  tab: CandidateDetailTab,
  view: EvidenceView,
): string {
  const tabQuery = tab === DEFAULT_CANDIDATE_TAB ? "" : `tab=${tab}&`;
  return `${basePath}?${tabQuery}view=${view}`;
}
