"use client";

import { useState, useTransition } from "react";
import {
  sendScreeningQuestionsToCandidate,
  scoreScreeningAnswers,
} from "@/lib/actions/screening-questions";
import { isEligibleForScreeningSend } from "@/lib/rules/screening-response";
import {
  analyzeTranscriptCadence,
  type ScriptedSignal,
} from "@/lib/screening/transcript-cadence";
import {
  isUnaskedOutcome,
  SCREENING_QUESTION_OUTCOME_COPY,
  screeningQuestionOutcome,
} from "@/lib/screening/question-outcome";
import { Badge, type BadgeProps } from "@/components/ui";
import { cn, formatEvidenceTimestamp } from "@/lib/utils";
import {
  EvidenceExcerpt,
  TURN_TARGET_HIGHLIGHT,
  transcriptTurnId,
} from "./score-evidence";
import {
  CARD,
  CARD_EYEBROW,
  CARD_HEADER,
  CARD_NOTE,
  HEADER_ICON,
  HeaderIcon,
} from "./evidence-level-ui";
import type { ApplicationState } from "@/lib/constants";
import type {
  ScoredAnswerRow,
  ScreeningQuestionRow,
  ScreeningResponseRow,
  VoiceTranscriptTurn,
} from "@/lib/data/screening-questions";

interface ScreeningThreadProps {
  applicationId: string;
  applicationStatus: ApplicationState | null;
  questions: ScreeningQuestionRow[];
  response: ScreeningResponseRow | null;
  // False when the campaign isn't Active — sends and scoring are frozen, so the
  // buttons disable (mirrors the server-side freeze guard).
  campaignActive: boolean;
}


const ANCHOR = "screening";

function scoreColor(score: number | null): string {
  if (score == null) return "text-[#9CA3AF]";
  if (score >= 80) return "text-[#059669]";
  if (score >= 60) return "text-[#D97706]";
  return "text-[#DC2626]";
}

/**
 * The screening thread: the state of the call, the transcript it produced, and
 * the questions it went looking with.
 *
 * A stack of sibling cards rather than one card containing three more. The score
 * and the rubric breakdown deliberately are NOT here — they render above as
 * `ScoreSection` and `ScreeningEvaluation`, so the number sits with its rail and
 * its provenance and the breakdown gets the room a set of dimensions needs.
 */
export default function ScreeningThread({
  applicationId,
  applicationStatus,
  questions,
  response,
  campaignActive,
}: ScreeningThreadProps) {
  const [sending, startSend] = useTransition();
  const [scoring, startScore] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSend() {
    setError(null);
    startSend(async () => {
      try {
        await sendScreeningQuestionsToCandidate(applicationId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send");
      }
    });
  }

  function handleScore() {
    setError(null);
    startScore(async () => {
      try {
        await scoreScreeningAnswers(applicationId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to score");
      }
    });
  }

  const status = response?.status ?? "not_sent";

  // The pre-send states ("no questions configured", "ready to send", mid-send
  // "pending") have nothing candidate-specific to show. The CALLER decides that
  // — `screeningWasSent` in `detail-header.ts` — and renders a named absence in
  // this card's place, so this no longer returns null on its own copy of the
  // condition: two copies drift, and the drift shows up as a blank panel with
  // no explanation.
  const answersById = new Map<string, ScoredAnswerRow>();
  for (const a of response?.answers ?? []) {
    answersById.set(a.question_id, a);
  }
  const transcript = response?.transcript ?? [];
  const isVoice = transcript.length > 0;
  // True only for a response graded before 2026-08-22, or down the legacy typed
  // path. The rubric dimension is the scoring unit now, so a modern response has
  // no number per question — and the questions card says which it is looking at
  // rather than leaving a reader to wonder where the scores went.
  const scoredPerQuestion = (response?.answers ?? []).some((a) => a.score != null);

  // Mirror the server-side guards: the send/resend buttons stay disabled until
  // the application reaches the screening stage AND the campaign is Active, so a
  // recruiter can't fire an email (or score) the action would reject.
  const frozenReason =
    "This campaign isn't Active — set it to Active to send screening questions or score answers.";
  const canSend =
    campaignActive &&
    applicationStatus != null &&
    isEligibleForScreeningSend(applicationStatus);
  const sendDisabledReason = !campaignActive
    ? frozenReason
    : "This candidate hasn't been approved into screening yet — screening questions can only be sent once they reach the screening stage.";

  return (
    <div className="space-y-4">
      <section className={CARD}>
        <div className={CARD_HEADER}>
          <h2 className={CARD_EYEBROW}>
            <HeaderIcon d={HEADER_ICON.call} />
            Voice screening
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <StatusLine response={response} />
            {(status === "sent" || status === "expired") && (
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !canSend}
                title={canSend ? undefined : sendDisabledReason}
                className="inline-flex min-h-9 cursor-pointer items-center whitespace-nowrap rounded-lg border border-[#D1D5DB] bg-white px-3 text-xs font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "Resending…" : "Resend email"}
              </button>
            )}
            {status === "responded" && (
              <button
                type="button"
                onClick={handleScore}
                disabled={scoring || !campaignActive}
                title={campaignActive ? undefined : frozenReason}
                className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg bg-ink px-3 text-xs font-semibold text-white transition-colors duration-150 hover:bg-ink-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {scoring ? (
                  <>
                    <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Scoring…
                  </>
                ) : (
                  "Score answers"
                )}
              </button>
            )}
          </div>
        </div>

        {error && (
          <p className="border-t border-[#FECACA] bg-[#FEF2F2] px-5 py-3 text-xs leading-[1.6] text-[#991B1B]">
            {error}
          </p>
        )}
      </section>

      {isVoice && (
        <TranscriptReview transcript={transcript} audioUrl={response?.audio_url ?? null} />
      )}

      <section className={CARD}>
        <div className={CARD_HEADER}>
          <h2 className={CARD_EYEBROW}>
            <HeaderIcon d={HEADER_ICON.questions} />
            Questions asked
          </h2>
          <span className="text-[11px] tabular-nums text-[#9CA3AF]">
            {questions.length} question{questions.length === 1 ? "" : "s"}
          </span>
        </div>

        <p className={CARD_NOTE}>
          {scoredPerQuestion
            ? "This response was graded one score per question — the unit used before 2026-08-22. It is shown the way it was actually graded rather than redrawn against today's rubric; re-score to move it onto the current rules."
            : "Questions are how the call goes looking; the rubric is what is graded. A competency evidenced while answering some other question has still been evidenced, which is why the score lives above, per dimension, and not here."}
        </p>

        <ol className="divide-y divide-[#F3F4F6]">
          {questions.map((q, idx) => {
            const answer = answersById.get(q.id);
            // What happened to this question comes from the call's coverage
            // ledger, not from `answers[]`. Those columns belong to the retired
            // typed-answer form and are never written on a voice call, so
            // reading them made every question on every rubric-era call read
            // "Never answered." — including the ones the candidate answered.
            const outcome = screeningQuestionOutcome({
              questionId: q.id,
              responseStatus: status,
              isVoice,
              answerText: answer?.answer_text,
              ledger: response?.topic_state ?? null,
            });
            const hasAnswer = outcome === "written" || answer?.score != null;

            return (
              <li key={q.id} className="flex items-start gap-3 px-5 py-4">
                <span className="mt-[1px] inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-[#F3F4F6] text-[11px] font-semibold tabular-nums text-[#4B5563]">
                  {idx + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-[1.5] text-ink">{q.prompt}</p>

                  {hasAnswer ? (
                    <>
                      {answer?.answer_text ? (
                        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-[#F9FAFB] px-3.5 py-2.5 text-[13px] leading-[1.65] text-[#374151]">
                          {answer.answer_text}
                        </p>
                      ) : (
                        <p className="mt-2 text-[11px] text-[#9CA3AF]">
                          Answered aloud — read it in the transcript above.
                        </p>
                      )}

                      {answer?.score != null && (
                        <div className="mt-2.5 rounded-lg border border-[#E5E7EB] px-3.5 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#9CA3AF]">
                              Score for this question
                            </span>
                            <span
                              className={cn(
                                "text-sm font-semibold tabular-nums",
                                scoreColor(answer.score),
                              )}
                            >
                              {answer.score}
                              <span className="text-[11px] font-normal text-[#9CA3AF]"> / 100</span>
                            </span>
                          </div>
                          {answer.rationale && (
                            <p className="mt-1.5 text-[11px] leading-[1.55] text-[#6B7280]">
                              {answer.rationale}
                            </p>
                          )}
                          {/* Voice only: a typed answer is already the evidence
                              and renders directly above, so an excerpt would
                              just repeat it back. */}
                          {isVoice && (
                            <EvidenceExcerpt
                              quote={answer.evidence_quote}
                              turnIndex={answer.evidence_turn_index}
                              anchorPrefix={ANCHOR}
                              zeroScored={answer.score === 0}
                            />
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p
                      className={cn(
                        "mt-2 text-[11px]",
                        // A question nobody asked is the one line here a
                        // recruiter must not skim past: the rubric dimension
                        // behind it scored 0 on evidence never solicited.
                        isUnaskedOutcome(outcome)
                          ? "text-[#B45309]"
                          : "text-[#9CA3AF]",
                      )}
                    >
                      {SCREENING_QUESTION_OUTCOME_COPY[outcome]}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

const SCRIPTED_SIGNAL: Record<
  ScriptedSignal,
  { variant: BadgeProps["variant"]; label: string }
> = {
  low: { variant: "active", label: "Low" },
  medium: { variant: "paused", label: "Medium" },
  high: { variant: "closed", label: "High" },
};

/**
 * Recruiter-facing review of a voice-screening call (#85): the spoken
 * transcript, an optional audio playback, and the soft "reads-as-scripted"
 * cadence signal recomputed from the transcript. The signal is a nudge for the
 * reviewer, never a score — that contract lives in the scoring action.
 *
 * Open by default: it is the evidence every number on this page was read out
 * of, and the jump links in the breakdown above land inside it.
 */
function TranscriptReview({
  transcript,
  audioUrl,
}: {
  transcript: VoiceTranscriptTurn[];
  audioUrl: string | null;
}) {
  const cadence = analyzeTranscriptCadence(transcript);
  const signal = SCRIPTED_SIGNAL[cadence.scripted_signal];

  return (
    <details open className={CARD}>
      <summary className={cn(CARD_HEADER, "cursor-pointer list-none select-none")}>
        <span className={CARD_EYEBROW}>
          <HeaderIcon d={HEADER_ICON.call} />
          Voice transcript
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-[#9CA3AF]">Reads-as-scripted</span>
          <Badge variant={signal.variant} title={cadence.rationale}>
            {signal.label}
          </Badge>
        </span>
      </summary>

      <p className={CARD_NOTE}>{cadence.rationale}</p>

      <div className="space-y-3 px-5 py-4">
        {audioUrl && (
          <div>
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.07em] text-[#9CA3AF]">
              Recording
            </span>
            <audio controls src={audioUrl} className="w-full" />
          </div>
        )}

        <ol className="space-y-2">
          {transcript.map((turn, i) => {
            const isAgent = turn.role === "agent";
            return (
              <li
                key={`${turn.at}-${i}`}
                id={transcriptTurnId(ANCHOR, i)}
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  TURN_TARGET_HIGHLIGHT,
                  // The interviewer is chrome; the candidate is the evidence.
                  // Only one of the two is ever quoted into a score, so only one
                  // of them is drawn as a thing to read closely.
                  isAgent
                    ? "border-[#F3F4F6] bg-[#FBFBFC]"
                    : "border-[#E5E7EB] bg-white",
                )}
              >
                <span
                  className={cn(
                    "mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.07em]",
                    isAgent ? "text-[#9CA3AF]" : "text-[#4B5563]",
                  )}
                >
                  {isAgent ? "Interviewer" : "Candidate"}
                  <span className="font-normal normal-case tracking-normal text-[#C4C7CE]">
                    turn {i + 1}
                  </span>
                </span>
                <p
                  className={cn(
                    "whitespace-pre-wrap text-[13px] leading-[1.65]",
                    isAgent ? "text-[#6B7280]" : "text-[#374151]",
                  )}
                >
                  {turn.text}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </details>
  );
}

function StatusLine({ response }: { response: ScreeningResponseRow | null }) {
  const text = (() => {
    if (!response) return "Not sent yet";
    switch (response.status) {
      case "sent":
        return `Sent ${formatEvidenceTimestamp(response.sent_at)} · awaiting response`;
      case "responded":
        return `Responded ${formatEvidenceTimestamp(response.responded_at)} · ready to score`;
      case "scored":
        return `Scored ${formatEvidenceTimestamp(response.scored_at)}`;
      case "expired":
        return "Link expired — resend required";
      default:
        return "Pending";
    }
  })();

  const expired = response?.status === "expired";

  return (
    <span className={cn("text-[11px]", expired ? "text-[#B91C1C]" : "text-[#9CA3AF]")}>
      {text}
    </span>
  );
}
