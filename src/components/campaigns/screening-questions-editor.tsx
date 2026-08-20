"use client";

import { useState, useTransition } from "react";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  generateScreeningQuestions,
  saveScreeningQuestions,
} from "@/lib/actions/screening-questions";

interface EditableQuestion {
  id?: string;
  prompt: string;
  is_required: boolean;
}

interface ScreeningQuestionsEditorProps {
  campaignId: string;
  initialQuestions: EditableQuestion[];
  canGenerate: boolean;
}

function clientId() {
  return `sq-${Math.random().toString(36).slice(2, 10)}`;
}

export default function ScreeningQuestionsEditor({
  campaignId,
  initialQuestions,
  canGenerate,
}: ScreeningQuestionsEditorProps) {
  const [open, setOpen] = useState(false);
  const [questions, setQuestions] = useState<(EditableQuestion & { _key: string })[]>(
    () => initialQuestions.map((q) => ({ ...q, _key: q.id ?? clientId() }))
  );
  const [generating, startGenerate] = useTransition();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hasQuestions = questions.length > 0;

  function openModal() {
    setError(null);
    setOpen(true);
  }

  function closeModal() {
    if (generating || saving) return;
    setOpen(false);
  }

  function addQuestion() {
    setQuestions((prev) => [
      ...prev,
      { _key: clientId(), prompt: "", is_required: true },
    ]);
  }

  function removeQuestion(key: string) {
    setQuestions((prev) => prev.filter((q) => q._key !== key));
  }

  function updatePrompt(key: string, prompt: string) {
    setQuestions((prev) =>
      prev.map((q) => (q._key === key ? { ...q, prompt } : q))
    );
  }

  function updateRequired(key: string, is_required: boolean) {
    setQuestions((prev) =>
      prev.map((q) => (q._key === key ? { ...q, is_required } : q))
    );
  }

  function handleRegenerate() {
    setError(null);
    startGenerate(async () => {
      try {
        const generated = await generateScreeningQuestions(campaignId);
        setQuestions(
          generated.map((q) => ({
            _key: clientId(),
            prompt: q.prompt,
            is_required: q.is_required,
          }))
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to generate questions"
        );
      }
    });
  }

  function handleSave() {
    setError(null);
    const cleaned = questions.map((q) => ({
      prompt: q.prompt.trim(),
      is_required: q.is_required,
    }));
    if (cleaned.length === 0) {
      setError("Add at least one question before saving.");
      return;
    }
    if (cleaned.some((q) => q.prompt.length < 10)) {
      setError("Every question must be at least 10 characters.");
      return;
    }
    startSave(async () => {
      try {
        await saveScreeningQuestions(campaignId, cleaned);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save questions");
      }
    });
  }

  const busy = generating || saving;

  return (
    <>
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider">
              Screening Questions
            </h2>
            <p className="text-xs text-[#6B7280] mt-1">
              AI-generated follow-up questions sent to candidates who pass
              resume screening.
            </p>
          </div>
          <button
            type="button"
            onClick={openModal}
            className="px-3 py-1.5 text-xs font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] transition-all duration-200"
          >
            {hasQuestions ? "Edit" : "Set up"}
          </button>
        </div>

        {hasQuestions ? (
          <ol className="space-y-2 list-decimal pl-5">
            {questions.map((q) => (
              <li key={q._key} className="text-sm text-[#111827]">
                <span>{q.prompt}</span>
                {q.is_required && (
                  <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded bg-red-50 text-red-700 text-[10px] font-medium uppercase">
                    Required
                  </span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-[#6B7280]">
            No questions configured yet. Click <strong>Set up</strong> to
            generate them with AI or write your own.
          </p>
        )}
      </div>

      <Modal open={open} onClose={closeModal} className="max-w-[720px]">
        <ModalHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-[#111827]">
                Screening Questions
              </h3>
              <p className="text-sm text-[#6B7280] mt-1">
                Edit the questions sent to candidates who pass resume screening.
                Keep them open-ended and specific to the role.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={busy || !canGenerate}
              title={
                canGenerate
                  ? "Replace all questions with fresh AI suggestions"
                  : "Add a job description to enable AI generation"
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {generating ? (
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
                  Generating…
                </>
              ) : (
                <>
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                    />
                  </svg>
                  {hasQuestions ? "Regenerate" : "Generate"}
                </>
              )}
            </button>
          </div>
        </ModalHeader>

        {error && (
          <div className="p-3 mb-4 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
            {error}
          </div>
        )}

        <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
          {questions.length === 0 && (
            <div className="p-6 text-center text-sm text-[#6B7280] bg-[#F9FAFB] rounded-lg border border-dashed border-[#E5E7EB]">
              No questions yet. Click <strong>Generate</strong> to let AI draft
              them, or add one manually below.
            </div>
          )}

          {questions.map((q, idx) => (
            <div
              key={q._key}
              className="p-3 bg-[#F9FAFB] rounded-lg border border-[#E5E7EB]"
            >
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#374151] text-white text-xs font-semibold mt-1">
                  {idx + 1}
                </span>
                <textarea
                  value={q.prompt}
                  onChange={(e) => updatePrompt(q._key, e.target.value)}
                  placeholder="Ask an open-ended question the resume can't answer…"
                  rows={2}
                  maxLength={1000}
                  className="flex-1 px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus-visible:outline-none transition-all duration-200 resize-none"
                />
                <button
                  type="button"
                  onClick={() => removeQuestion(q._key)}
                  className="flex-shrink-0 p-1.5 text-[#6B7280] cursor-pointer rounded-lg hover:text-[#DC2626] hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 transition-all duration-200"
                  title="Remove question"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <label className="mt-2 ml-8 inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={q.is_required}
                  onChange={(e) => updateRequired(q._key, e.target.checked)}
                  className="w-4 h-4 rounded border-[#D1D5DB] text-[#2563EB] cursor-pointer focus:ring-[#2563EB] focus-visible:ring-2"
                />
                <span className="text-xs text-[#6B7280]">Required answer</span>
              </label>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addQuestion}
          disabled={questions.length >= 15}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#4B5563] cursor-pointer rounded-lg hover:bg-[#F3F4F6] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m8-8H4"
            />
          </svg>
          Add question
        </button>

        <ModalFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={closeModal}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={busy || questions.length === 0}
          >
            {saving ? "Saving…" : "Save questions"}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
