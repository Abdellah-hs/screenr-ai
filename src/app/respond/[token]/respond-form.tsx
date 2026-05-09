"use client";

import { useState, useTransition } from "react";
import { submitScreeningAnswers } from "@/lib/actions/respond";

interface Question {
  id: string;
  prompt: string;
  is_required: boolean;
}

interface RespondFormProps {
  token: string;
  campaignTitle: string;
  questions: Question[];
  initialAnswers: Record<string, string>;
  expiresAt: string;
}

export default function RespondForm({
  token,
  campaignTitle,
  questions,
  initialAnswers,
  expiresAt,
}: RespondFormProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const q of questions) seed[q.id] = initialAnswers[q.id] ?? "";
    return seed;
  });
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const expiresDate = new Date(expiresAt);
  const formattedExpiry = expiresDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const totalRequired = questions.filter((q) => q.is_required).length;
  const completedRequired = questions.filter(
    (q) => q.is_required && answers[q.id]?.trim().length > 0
  ).length;
  const canSubmit = totalRequired === 0 || completedRequired === totalRequired;

  function updateAnswer(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Build the payload — skip empty optional answers so they don't hit
    // Zod's min(1) validation.
    const payload = questions
      .map((q) => ({
        question_id: q.id,
        answer_text: (answers[q.id] ?? "").trim(),
      }))
      .filter((a) => a.answer_text.length > 0);

    if (payload.length === 0) {
      setError("Please answer at least one question before submitting.");
      return;
    }

    startSubmit(async () => {
      try {
        await submitScreeningAnswers({ token, answers: payload });
        setSubmitted(true);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to submit. Please try again."
        );
      }
    });
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-[#E5E7EB] p-6 sm:p-8 shadow-sm text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-4 mx-auto">
            <svg
              className="w-6 h-6 text-emerald-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-[#111827] mb-2">
            Thank you!
          </h1>
          <p className="text-sm text-[#6B7280]">
            Your answers for <strong>{campaignTitle}</strong> have been
            submitted. The hiring team will review them and be in touch.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] py-6 sm:py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <header className="mb-6 sm:mb-8">
          <p className="text-xs font-medium uppercase tracking-wider text-[#0369A1] mb-2">
            Screening Questions
          </p>
          <h1 className="text-xl sm:text-2xl font-semibold text-[#111827] mb-2">
            {campaignTitle}
          </h1>
          <p className="text-sm text-[#6B7280]">
            Take your time — we&apos;re looking for concrete examples and your
            honest perspective. You can close this tab and come back as long as
            the link is active (before {formattedExpiry}).
          </p>
        </header>

        {error && (
          <div className="mb-6 p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {questions.map((q, idx) => {
            const value = answers[q.id] ?? "";
            return (
              <div
                key={q.id}
                className="bg-white rounded-xl border border-[#E5E7EB] p-4 sm:p-5 shadow-sm"
              >
                <label
                  htmlFor={`q-${q.id}`}
                  className="block text-sm font-medium text-[#111827] mb-2"
                >
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#0369A1] text-white text-xs font-semibold mr-2">
                    {idx + 1}
                  </span>
                  {q.prompt}
                  {q.is_required && (
                    <span className="ml-2 text-xs font-medium text-red-600">
                      *
                    </span>
                  )}
                </label>
                <textarea
                  id={`q-${q.id}`}
                  value={value}
                  onChange={(e) => updateAnswer(q.id, e.target.value)}
                  placeholder="Share a concrete example…"
                  rows={4}
                  maxLength={5000}
                  required={q.is_required}
                  className="w-full px-3 py-2.5 bg-white border border-[#E2E8F0] rounded-lg text-base text-[#111827] focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1] focus-visible:outline-none transition-all duration-200 resize-y min-h-[44px]"
                />
                <div className="flex justify-between text-xs text-[#9CA3AF] mt-1.5">
                  <span>
                    {q.is_required ? "Required" : "Optional"}
                  </span>
                  <span>{value.length} / 5000</span>
                </div>
              </div>
            );
          })}

          <div className="sticky bottom-3 sm:bottom-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 sm:p-4 bg-white rounded-xl border border-[#E5E7EB] shadow-md">
            <p className="text-xs text-[#6B7280] text-center sm:text-left">
              {totalRequired > 0 ? (
                <>
                  {completedRequired} of {totalRequired} required questions
                  answered
                </>
              ) : (
                "All questions are optional — submit whenever you're ready"
              )}
            </p>
            <button
              type="submit"
              disabled={submitting || !canSubmit}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 sm:py-2.5 text-base sm:text-sm font-semibold text-white bg-[#0369A1] rounded-lg cursor-pointer hover:bg-[#0C4A6E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] sm:min-h-0"
            >
              {submitting ? (
                <>
                  <svg
                    className="w-4 h-4 animate-spin"
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
                  Submitting…
                </>
              ) : (
                "Submit answers"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
