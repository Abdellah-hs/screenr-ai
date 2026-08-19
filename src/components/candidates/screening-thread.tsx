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
import { Badge, type BadgeProps } from "@/components/ui";
import { ProctoringReportPanel } from "./proctoring-report";
import {
  EvidenceExcerpt,
  TURN_TARGET_HIGHLIGHT,
  transcriptTurnId,
} from "./score-evidence";
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

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const ANCHOR = "screening";

function scoreColor(score: number | null): string {
  if (score == null) return "text-[#9CA3AF]";
  if (score >= 80) return "text-[#059669]";
  if (score >= 60) return "text-[#D97706]";
  return "text-[#DC2626]";
}

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

  // This card exists to review a candidate's screening thread. Until an email
  // has actually gone out there is nothing candidate-specific to show —
  // sending is automatic on approval — so the pre-send states ("no questions
  // configured", "ready to send", mid-send "pending") render nothing.
  if (status === "not_sent" || status === "pending") return null;
  const answersById = new Map<string, ScoredAnswerRow>();
  for (const a of response?.answers ?? []) {
    answersById.set(a.question_id, a);
  }
  const transcript = response?.transcript ?? [];
  const isVoice = transcript.length > 0;

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
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#0C4A6E] uppercase tracking-wider">
            Screening Questions
          </h2>
          <StatusLine response={response} />
        </div>
        {(status === "sent" || status === "expired") && (
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !canSend}
            title={canSend ? undefined : sendDisabledReason}
            className="px-3 py-1.5 text-xs font-medium text-[#0369A1] bg-[#F0F9FF] border border-[#BAE6FD] rounded-lg cursor-pointer hover:bg-[#E0F2FE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#0369A1] rounded-lg cursor-pointer hover:bg-[#0C4A6E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {scoring ? (
              <>
                <svg
                  className="w-3.5 h-3.5 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
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

      {error && (
        <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
          {error}
        </div>
      )}

      {status === "scored" && response && (
        <div className="mb-4 p-3 rounded-lg bg-[#F0F9FF] border border-[#BAE6FD]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-[#0369A1] uppercase tracking-wider">
              Overall Score
            </span>
            <span className={`text-2xl font-bold ${scoreColor(response.overall_score)}`}>
              {response.overall_score ?? "—"}
            </span>
          </div>
          {response.overall_rationale && (
            <p className="text-sm text-[#4B5563] leading-relaxed">
              {response.overall_rationale}
            </p>
          )}
        </div>
      )}

      {/* Voice screening only: there is no browser session to watch for the
          legacy text form. Shown once the candidate has actually responded, so
          a still-open screening doesn't read as "nothing captured". */}
      {isVoice && (status === "responded" || status === "scored") && (
        <ProctoringReportPanel
          report={response?.proctoring ?? null}
          stage="screening"
          showWhenAbsent
        />
      )}

      {isVoice && (
        <TranscriptReview transcript={transcript} audioUrl={response?.audio_url ?? null} />
      )}

      <ol className="space-y-4">
        {questions.map((q, idx) => {
          const answer = answersById.get(q.id);
          return (
            <li
              key={q.id}
              className="pl-7 relative"
            >
              <span className="absolute left-0 top-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#0369A1] text-white text-xs font-semibold">
                {idx + 1}
              </span>
              <p className="text-sm font-medium text-[#111827] mb-1">
                {q.prompt}
                {q.is_required && (
                  <span className="ml-2 text-[10px] font-medium text-red-600 uppercase">
                    Required
                  </span>
                )}
              </p>

              {answer?.answer_text || (isVoice && answer?.score != null) ? (
                <div className="mt-2 p-3 bg-[#F9FAFB] rounded-lg border border-[#E5E7EB]">
                  {answer?.answer_text ? (
                    <p className="text-sm text-[#374151] whitespace-pre-wrap leading-relaxed">
                      {answer.answer_text}
                    </p>
                  ) : (
                    <p className="text-xs text-[#9CA3AF] italic">
                      Answered in the voice interview — see the transcript above.
                    </p>
                  )}
                  {answer?.score != null && (
                    <div className="mt-3 pt-3 border-t border-[#E5E7EB]">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-[#6B7280]">
                          AI Score
                        </span>
                        <span className={`text-sm font-semibold ${scoreColor(answer.score)}`}>
                          {answer.score} / 100
                        </span>
                      </div>
                      {answer.rationale && (
                        <p className="text-xs text-[#6B7280] italic leading-relaxed">
                          {answer.rationale}
                        </p>
                      )}
                      {/* Voice only: a typed answer is already the evidence and
                          renders directly above, so an excerpt would just
                          repeat it back. */}
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
                </div>
              ) : (
                <p className="mt-2 text-xs text-[#9CA3AF] italic">
                  {status === "sent"
                    ? "Awaiting candidate response…"
                    : "No answer provided"}
                </p>
              )}
            </li>
          );
        })}
      </ol>
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
    <details open className="mb-4 rounded-lg border border-[#E5E7EB] bg-white">
      <summary className="flex items-center justify-between gap-3 cursor-pointer select-none px-3 py-2.5 list-none">
        <span className="text-xs font-semibold text-[#0369A1] uppercase tracking-wider">
          Voice Transcript
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-[#6B7280]">Reads-as-scripted</span>
          <Badge variant={signal.variant} title={cadence.rationale}>
            {signal.label}
          </Badge>
        </span>
      </summary>

      <div className="px-3 pb-3 space-y-3">
        <p className="text-[11px] text-[#9CA3AF] leading-relaxed">{cadence.rationale}</p>

        {audioUrl && (
          <div>
            <span className="block text-[11px] font-medium text-[#6B7280] mb-1">Recording</span>
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
                className={`rounded-lg border p-2.5 transition-colors ${TURN_TARGET_HIGHLIGHT} ${
                  isAgent
                    ? "border-[#BAE6FD] bg-[#F0F9FF]"
                    : "border-[#E5E7EB] bg-[#F9FAFB]"
                }`}
              >
                <span
                  className={`block text-[10px] font-semibold uppercase tracking-wider mb-0.5 ${
                    isAgent ? "text-[#0369A1]" : "text-[#6B7280]"
                  }`}
                >
                  {isAgent ? "Interviewer" : "Candidate"}
                </span>
                <p className="text-sm text-[#374151] leading-relaxed whitespace-pre-wrap">
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
  if (!response) {
    return (
      <p className="text-xs text-[#6B7280] mt-1">Not sent yet</p>
    );
  }

  switch (response.status) {
    case "sent":
      return (
        <p className="text-xs text-[#6B7280] mt-1">
          Sent {formatDate(response.sent_at)} · Awaiting response
        </p>
      );
    case "responded":
      return (
        <p className="text-xs text-[#6B7280] mt-1">
          Responded {formatDate(response.responded_at)} · Ready to score
        </p>
      );
    case "scored":
      return (
        <p className="text-xs text-[#6B7280] mt-1">
          Scored {formatDate(response.scored_at)}
        </p>
      );
    case "expired":
      return (
        <p className="text-xs text-red-600 mt-1">Link expired — resend required</p>
      );
    default:
      return (
        <p className="text-xs text-[#6B7280] mt-1">Pending</p>
      );
  }
}
