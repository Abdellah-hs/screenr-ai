"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideManagerReview } from "@/lib/actions/manager-review";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui";
import type { ManagerReviewDecision } from "@/lib/rules/manager-review";

/** Mirrors the server-side floor in `managerReviewDecisionSchema`. */
const MIN_RATIONALE = 20;

interface DecisionCopy {
  /** Button label on the panel. */
  action: string;
  /** Modal title. */
  title: string;
  /** What happens, in the recruiter's terms. */
  consequence: string;
  placeholder: string;
  confirm: string;
}

/**
 * One entry per decision, so the panel and the modal can never disagree about
 * what a button does — and so adding a decision to the rule layer's union
 * surfaces here as a type error rather than a missing label.
 */
const COPY: Record<ManagerReviewDecision, DecisionCopy> = {
  advance: {
    action: "Advance to final interview",
    title: "Advance to the final interview",
    consequence:
      "The candidate is emailed a link to book a time with the team. This is the normal path — the AI interview is evidence, the final call is made by people.",
    placeholder:
      "e.g. Clear system-design reasoning and strong ownership signals; want the platform team to meet them.",
    confirm: "Advance candidate",
  },
  hire: {
    action: "Hire directly",
    title: "Hire without a final interview",
    consequence:
      "This skips the final human interview entirely. Only do this when the evidence above is genuinely enough on its own — a formal offer still comes from a person.",
    placeholder:
      "e.g. Internal transfer already known to the team; final interview would add nothing.",
    confirm: "Confirm hire",
  },
  reject: {
    action: "Reject",
    title: "Reject application",
    consequence:
      "The candidate is emailed a rejection. Your reasoning stays internal — the email never exposes scores or comparisons.",
    placeholder:
      "e.g. Interview showed limited depth on the core stack this role needs day one.",
    confirm: "Confirm rejection",
  },
};

/**
 * The manager's decision point, and the last human step in the pipeline.
 *
 * It deliberately shows **no score of its own**. Every stage above this panel
 * already renders its own evidence — resume score, screening score, interview
 * score, transcript, proctoring report — and the PRD is explicit that managers
 * inspect those independently rather than through a rollup. A composite number
 * here would quietly become the thing people decide on, which is the exact
 * failure the layered scoring was built to avoid. So this panel's job is to ask
 * for a judgement and record it, not to summarise.
 */
export function ManagerReviewPanel({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState<ManagerReviewDecision | null>(null);
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function open(d: ManagerReviewDecision) {
    setDecision(d);
    setRationale("");
    setError(null);
  }

  function close() {
    if (isPending) return;
    setDecision(null);
    setRationale("");
    setError(null);
  }

  function submit() {
    if (!decision) return;
    setError(null);
    startTransition(async () => {
      try {
        await decideManagerReview({
          applicationId,
          decision,
          rationale: rationale.trim(),
        });
        setDecision(null);
        setRationale("");
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to record the decision",
        );
      }
    });
  }

  const copy = decision ? COPY[decision] : null;
  const remaining = MIN_RATIONALE - rationale.trim().length;

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-5">
      <div className="flex items-start gap-3 mb-1">
        <div className="w-8 h-8 rounded-full bg-[#F0F9FF] text-[#0369A1] flex items-center justify-center shrink-0">
          {/* Heroicons: clipboard-document-check */}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C8.913 4.02 8.25 4.815 8.25 5.717V9M17.15 3.836c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0118 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3l1.5 1.5 3-3.75"
            />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[#0C4A6E]">
            Your decision
          </h3>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Every stage above has produced its own score and evidence. Read them
            on their own terms — there is no combined score, on purpose. Whatever
            you choose is recorded with your reasoning on the audit trail.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <button
          type="button"
          onClick={() => open("advance")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#0369A1] rounded-lg cursor-pointer hover:bg-[#0C4A6E] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-1"
        >
          {COPY.advance.action}
        </button>
        <button
          type="button"
          onClick={() => open("hire")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#047857] bg-white border border-[#A7F3D0] rounded-lg cursor-pointer hover:bg-[#ECFDF5] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669] focus-visible:ring-offset-1"
        >
          {COPY.hire.action}
        </button>
        <button
          type="button"
          onClick={() => open("reject")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#DC2626] bg-white border border-[#FECACA] rounded-lg cursor-pointer hover:bg-[#FEF2F2] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2626] focus-visible:ring-offset-1"
        >
          {COPY.reject.action}
        </button>
      </div>

      <Modal open={decision !== null} onClose={close}>
        {copy && (
          <>
            <ModalHeader>
              <h2 className="text-lg font-semibold text-[#0C4A6E]">{copy.title}</h2>
              <p className="text-sm text-[#6B7280] mt-1">{copy.consequence}</p>
            </ModalHeader>

            <label
              htmlFor="manager-review-rationale"
              className="block text-xs font-medium text-[#374151] mb-1.5"
            >
              Why? This is the permanent record of the decision.
            </label>
            <textarea
              id="manager-review-rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              disabled={isPending}
              rows={4}
              placeholder={copy.placeholder}
              aria-describedby="manager-review-rationale-hint"
              className="w-full px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-lg text-[#111827] focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1] outline-none resize-y disabled:opacity-50"
            />

            {/* Explains the disabled confirm button rather than leaving the
                recruiter to guess why it won't press. */}
            <p
              id="manager-review-rationale-hint"
              className={`text-xs mt-1.5 ${remaining > 0 ? "text-[#6B7280]" : "text-[#059669]"}`}
            >
              {remaining > 0
                ? `${remaining} more character${remaining === 1 ? "" : "s"} needed`
                : "Ready to record"}
            </p>

            {error && (
              <p role="alert" className="text-xs text-[#DC2626] mt-2">
                {error}
              </p>
            )}

            <ModalFooter>
              <button
                type="button"
                onClick={close}
                disabled={isPending}
                className="px-4 py-2 text-sm font-medium text-[#4B5563] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={isPending || remaining > 0}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg cursor-pointer transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                  decision === "reject"
                    ? "bg-[#DC2626] hover:bg-[#B91C1C]"
                    : decision === "hire"
                      ? "bg-[#059669] hover:bg-[#047857]"
                      : "bg-[#0369A1] hover:bg-[#0C4A6E]"
                }`}
              >
                {isPending ? "Recording..." : copy.confirm}
              </button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
}
