"use client";

import { useState, useTransition } from "react";
import {
  sendScreeningQuestionsToCandidate,
  scoreScreeningAnswers,
} from "@/lib/actions/screening-questions";
import type {
  ScoredAnswerRow,
  ScreeningQuestionRow,
  ScreeningResponseRow,
} from "@/lib/data/screening-questions";

interface ScreeningThreadProps {
  applicationId: string;
  questions: ScreeningQuestionRow[];
  response: ScreeningResponseRow | null;
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

function scoreColor(score: number | null): string {
  if (score == null) return "text-[#9CA3AF]";
  if (score >= 80) return "text-[#059669]";
  if (score >= 60) return "text-[#D97706]";
  return "text-[#DC2626]";
}

export default function ScreeningThread({
  applicationId,
  questions,
  response,
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

  // Fast-path empty states
  if (questions.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
        <h2 className="text-sm font-semibold text-[#0C4A6E] uppercase tracking-wider mb-2">
          Screening Questions
        </h2>
        <p className="text-sm text-[#6B7280]">
          No screening questions configured for this campaign. Set them up on
          the campaign page to enable this workflow.
        </p>
      </div>
    );
  }

  const status = response?.status ?? "not_sent";
  const answersById = new Map<string, ScoredAnswerRow>();
  for (const a of response?.answers ?? []) {
    answersById.set(a.question_id, a);
  }

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#0C4A6E] uppercase tracking-wider">
            Screening Questions
          </h2>
          <StatusLine response={response} />
        </div>
        {status === "not_sent" && (
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className="px-3 py-1.5 text-xs font-medium text-white bg-[#0369A1] rounded-lg cursor-pointer hover:bg-[#0C4A6E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {sending ? "Sending…" : "Send questions"}
          </button>
        )}
        {(status === "sent" || status === "expired") && (
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className="px-3 py-1.5 text-xs font-medium text-[#0369A1] bg-[#F0F9FF] border border-[#BAE6FD] rounded-lg cursor-pointer hover:bg-[#E0F2FE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] transition-all duration-200 disabled:opacity-50 whitespace-nowrap"
          >
            {sending ? "Resending…" : "Resend email"}
          </button>
        )}
        {status === "responded" && (
          <button
            type="button"
            onClick={handleScore}
            disabled={scoring}
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

      {status === "not_sent" ? (
        <p className="text-sm text-[#6B7280]">
          {questions.length} question{questions.length === 1 ? "" : "s"}{" "}
          ready to send. Click <strong>Send questions</strong> to email the
          candidate a personal response link.
        </p>
      ) : (
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

                {answer?.answer_text ? (
                  <div className="mt-2 p-3 bg-[#F9FAFB] rounded-lg border border-[#E5E7EB]">
                    <p className="text-sm text-[#374151] whitespace-pre-wrap leading-relaxed">
                      {answer.answer_text}
                    </p>
                    {answer.score != null && (
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
      )}
    </div>
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
