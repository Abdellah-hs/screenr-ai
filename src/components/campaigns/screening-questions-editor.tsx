"use client";

import { useState, useTransition } from "react";
import { checkScreeningCoverage } from "@/lib/actions/screening-coverage";
import type { ScreeningCoverageResult } from "@/lib/screening/coverage";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  generateScreeningQuestions,
  saveScreeningQuestions,
} from "@/lib/actions/screening-questions";
import { generateScreeningQuestionsFromDescription } from "@/lib/actions/ai-generate";

export interface EditableQuestion {
  id?: string;
  prompt: string;
}

interface ScreeningQuestionsEditorProps {
  /**
   * Empty inside the create wizard, where the campaign row does not exist yet.
   * Its absence is what makes the editor stage questions into `onChange`
   * instead of saving them on their own.
   */
  campaignId?: string;
  initialQuestions: EditableQuestion[];
  canGenerate?: boolean;
  /**
   * Controlled mode, same contract as RubricEditor: pass `value` + `onChange`
   * and the wizard owns the questions, so leaving the step cannot lose them.
   */
  value?: EditableQuestion[];
  onChange?: (questions: EditableQuestion[]) => void;
  /**
   * The job description to draft from. The wizard holds it in its draft rather
   * than in the DOM, so it has to be handed in — there is no field to read.
   */
  description?: string;
  /**
   * The screening rubric this campaign's answers are scored against.
   *
   * Used for two things, both advisory: drafting questions that probe the
   * rubric, and warning when a dimension has no question. A competency no
   * question goes looking for scores zero for every candidate, so both are
   * worth knowing before anyone is interviewed.
   *
   * Ids are carried alongside names because the coverage check reports gaps by
   * id — it is handed a list and must point back into it, rather than returning
   * a name that may or may not match one.
   */
  rubricDimensions?: { id: string; name: string }[];
}

function clientId() {
  return `sq-${Math.random().toString(36).slice(2, 10)}`;
}

export default function ScreeningQuestionsEditor({
  campaignId = "",
  initialQuestions,
  canGenerate = true,
  value,
  onChange,
  description,
  rubricDimensions,
}: ScreeningQuestionsEditorProps) {
  const staged = !campaignId;
  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState<(EditableQuestion & { _key: string })[]>(
    () => initialQuestions.map((q) => ({ ...q, _key: q.id ?? clientId() }))
  );
  const questions = value
    ? value.map((q, i) => ({ ...q, _key: q.id ?? `sq-controlled-${i}` }))
    : internal;
  /**
   * The set that is actually in the database, so Cancel can put the card back.
   *
   * Only meaningful in live mode. Without it the card can sit there displaying
   * questions no candidate will ever be asked — see `closeModal`.
   */
  const [saved, setSaved] = useState<EditableQuestion[]>(initialQuestions);

  function setQuestions(
    update: (prev: (EditableQuestion & { _key: string })[]) => (EditableQuestion & { _key: string })[],
  ) {
    const next = update(questions);
    if (value === undefined) setInternal(next);
    onChange?.(next.map((q) => ({ ...(q.id ? { id: q.id } : {}), prompt: q.prompt })));
  }
  const [generating, startGenerate] = useTransition();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * Coverage, as advice rather than a gate.
   *
   * After the campaign exists this is a soft warning and nothing more: a
   * recruiter editing a live campaign has reasons the app cannot see, and
   * refusing their save over a model's reading would be the app second-guessing
   * a person. Prevention belongs at creation, where the mistake is made.
   */
  const [coverage, setCoverage] = useState<ScreeningCoverageResult | null>(null);
  const [checkingCoverage, setCheckingCoverage] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const hasQuestions = questions.length > 0;

  const uncovered = dismissed ? [] : (coverage?.uncoveredDimensions ?? []);

  /**
   * Check coverage — deliberately NOT on mount.
   *
   * Opening a campaign page is not a change to anything, and firing a model
   * call for it would spend the recruiter's shared AI budget on a page view:
   * browsing ten campaigns would leave "Draft from the role" refusing to work
   * for five minutes, for a reason they never triggered and cannot see. So this
   * runs after a save, and on request — the two moments the answer can actually
   * have changed or actually been asked for.
   *
   * A failure says nothing rather than "all covered". The score breakdown is
   * the backstop that shows a dimension which ended with no evidence.
   */
  async function refreshCoverage(next: EditableQuestion[]) {
    if (staged || !rubricDimensions?.length) return;
    setCheckingCoverage(true);
    try {
      const result = await checkScreeningCoverage({
        dimensions: rubricDimensions.map((d) => ({ id: d.id, name: d.name })),
        questions: next.map((q) => ({ prompt: q.prompt })),
      });
      setCoverage(result);
      setDismissed(false);
    } catch {
      setCoverage(null);
    } finally {
      setCheckingCoverage(false);
    }
  }

  function openModal() {
    setError(null);
    setOpen(true);
  }

  function closeModal() {
    if (generating || saving) return;
    // Live mode: put the card back to what is stored. The card renders the same
    // `questions` the modal edits, so abandoning an edit used to leave the page
    // showing a question set that was never written — indistinguishable, from
    // the outside, from one that was. Staged mode keeps them: there the wizard
    // owns the draft and saves it with the campaign.
    if (!staged) {
      setInternal(saved.map((q) => ({ ...q, _key: q.id ?? clientId() })));
    }
    setOpen(false);
  }

  function addQuestion() {
    setQuestions((prev) => [
      ...prev,
      { _key: clientId(), prompt: "" },
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

  function handleRegenerate() {
    setError(null);

    if (staged && (description ?? "").trim().length < 10) {
      setError("Write the job description first — the questions are drafted from it.");
      return;
    }

    startGenerate(async () => {
      try {
        const generated = staged
          ? await generateScreeningQuestionsFromDescription(
              (description ?? "").trim(),
              (rubricDimensions ?? []).map((d) => d.name),
            )
          : await generateScreeningQuestions(campaignId);
        setQuestions(() =>
          generated.map((q) => ({
            _key: clientId(),
            prompt: q.prompt,
          }))
        );
        // "Draft from the role" is reachable from the CARD, outside the modal,
        // and the only Save lives inside it. Drafting therefore used to fill
        // the card with five questions that were never written to the
        // database: they looked set up, the "no screening questions" banner
        // above kept insisting otherwise, and navigating away lost them.
        // Opening the review step is also the right shape for it — the AI
        // drafts, the recruiter reads them and commits.
        if (!staged) setOpen(true);
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
    }));
    if (!staged && cleaned.length === 0) {
      setError("Add at least one question before saving.");
      return;
    }
    if (cleaned.some((q) => q.prompt.length < 10)) {
      setError("Every question must be at least 10 characters.");
      return;
    }

    if (staged) {
      // Nothing to persist yet — the wizard carries these into createCampaign,
      // which writes them in the same transaction as the campaign.
      setOpen(false);
      return;
    }

    startSave(async () => {
      try {
        await saveScreeningQuestions(campaignId, cleaned);
        setSaved(cleaned);
        setOpen(false);
        // After the save, not before: the warning is about what is now stored.
        void refreshCoverage(cleaned);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save questions");
      }
    });
  }

  const busy = generating || saving;

  return (
    <>
      {/* No inner scroller and no `flex-1`. This card used to split a fixed
          column with the rubric, which sliced the question list mid-sentence
          against a straight edge — on the one panel whose entire job is
          reading what the voice AI will ask. The page scrolls instead. */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        <div className="flex flex-wrap items-center justify-between gap-3.5 border-b border-[#F3F4F6] px-[22px] py-4">
          <div className="min-w-0">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
              Screening questions
              {hasQuestions && (
                <span className="font-semibold tabular-nums text-[#9CA3AF]">
                  {" · "}
                  {questions.length}
                </span>
              )}
            </h2>
            <p className="mt-1 text-[13px] leading-[1.55] text-[#6B7280]">
              Asked by the voice AI, in this order.
            </p>
          </div>
          {/* Two buttons, not three. Drafting and editing are what a recruiter
              came here to do; the coverage check is a diagnostic and sits under
              the list it reports on. */}
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={busy || !canGenerate}
              title={
                canGenerate
                  ? "Replace all questions with fresh AI suggestions"
                  : "Add a job description to enable AI generation"
              }
              className="inline-flex min-h-9 items-center gap-[7px] rounded-lg border border-[#D1D5DB] bg-white px-3 text-[13px] font-semibold text-[#374151] transition-colors duration-150 cursor-pointer hover:bg-[#F9FAFB] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? "Drafting…" : "Draft from the role"}
            </button>
            <button
              type="button"
              onClick={openModal}
              className="inline-flex min-h-9 items-center rounded-lg border border-[#D1D5DB] bg-white px-3 text-[13px] font-semibold text-[#374151] cursor-pointer transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink"
            >
              {hasQuestions ? "Edit questions" : "Add question"}
            </button>
          </div>
        </div>

        <div className="px-[22px] py-[22px]">
        {hasQuestions ? (
          // One bordered container with divided rows, not five bordered boxes:
          // the questions are an ordered set, and five separate cards read as
          // five unrelated things.
          <ol className="overflow-hidden rounded-lg border border-[#E5E7EB]">
            {questions.map((q, i) => (
              <li
                key={q._key}
                className="flex gap-3.5 border-b border-[#F3F4F6] px-3.5 py-3 last:border-b-0"
              >
                {/* The order is the order they are asked in, so the number is
                    the question's identity, not decoration. */}
                <span className="w-5 shrink-0 pt-px text-xs font-semibold text-[#9CA3AF] tabular-nums">
                  {i + 1}
                </span>
                <p className="min-w-0 flex-1 text-[13px] leading-[1.55] text-ink">
                  {q.prompt}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-lg border border-dashed border-[#E5E7EB] px-3.5 py-5 text-center text-[13px] leading-[1.55] text-[#6B7280]">
            No questions yet. Nobody can be approved into screening until this
            campaign has some — draft them from the role description, or write your
            own.
          </p>
        )}

        </div>

        {/* The diagnostic, in a footer under the list it reads — and the result
            directly under the control that asked for it. On request, because a
            page view is not a question worth paying a model for. */}
        {!staged &&
          (rubricDimensions?.length ?? 0) > 0 &&
          (hasQuestions || uncovered.length > 0) && (
            <div className="border-t border-[#F3F4F6] px-[22px] py-3.5">
              {hasQuestions && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <button
                    type="button"
                    onClick={() => void refreshCoverage(questions)}
                    disabled={checkingCoverage}
                    className="min-h-8 shrink-0 cursor-pointer text-[13px] font-semibold text-primary transition-colors duration-150 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {checkingCoverage ? "Checking…" : "Check rubric coverage"}
                  </button>
                  <span className="text-xs leading-[1.55] text-[#9CA3AF]">
                    A rubric dimension no question asks about scores zero for every
                    candidate.
                  </span>
                </div>
              )}

              {/* Advice, hedged and dismissible. It names the dimensions rather
                  than saying "some are uncovered", because a warning you have to
                  go and work out is one you learn to ignore. */}
              {uncovered.length > 0 && (
                <div
                  role="status"
                  className="mt-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-[15px] py-[13px]"
                >
                  <p className="mb-1.5 text-[13px] font-semibold text-[#92400E]">
                    {uncovered.length === 1
                      ? "One rubric dimension may have no question"
                      : `${uncovered.length} rubric dimensions may have no question`}
                  </p>
                  <ul className="mb-2 flex list-disc flex-col gap-1 pl-5">
                    {uncovered.map((d) => (
                      <li
                        key={d.dimensionId}
                        className="text-xs leading-[1.55] text-[#92400E]"
                      >
                        <strong>{d.dimensionName}</strong> — {d.reason}
                      </li>
                    ))}
                  </ul>
                  <p className="mb-2 text-xs leading-[1.55] text-[#92400E]">
                    Ask about it, or take it out of the rubric.
                  </p>
                  <button
                    type="button"
                    onClick={() => setDismissed(true)}
                    className="min-h-8 cursor-pointer rounded-lg border border-[#FDE68A] bg-white px-2.5 text-xs font-semibold text-[#92400E] transition-colors duration-150 hover:bg-[#FFFBEB]"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          )}
      </section>

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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
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
                  className="flex-1 px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus-visible:outline-none transition-colors duration-150 resize-none"
                />
                <button
                  type="button"
                  onClick={() => removeQuestion(q._key)}
                  className="flex-shrink-0 p-1.5 text-[#6B7280] cursor-pointer rounded-lg hover:text-[#DC2626] hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 transition-colors duration-150"
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
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addQuestion}
          disabled={questions.length >= 15}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#4B5563] cursor-pointer rounded-lg hover:bg-[#F3F4F6] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
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
