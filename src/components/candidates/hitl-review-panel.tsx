"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { decideHitlReview } from "@/lib/actions/candidates";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui";

type Decision = "approve" | "reject";

export function HitlReviewPanel({
  applicationId,
  campaignId,
  campaignActive,
  hasScreeningQuestions,
  bare = false,
}: {
  applicationId: string;
  // For the "set up screening questions" jump link in the blocked-approval hint.
  campaignId: string;
  // Approving processes the candidate (auto-sends screening), so it's frozen
  // unless the campaign is Active. Rejecting stays available (a stop).
  campaignActive: boolean;
  // Approving emails the screening questions immediately, so it's blocked
  // until the campaign has a question set. The server action re-checks this.
  hasScreeningQuestions: boolean;
  // Drop the card chrome when the panel is already inside one (the decision
  // rail) — a card nested in a card reads as two separate asks.
  bare?: boolean;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Set when approval succeeded but the screening questions could NOT be
  // auto-sent (e.g. the campaign has none configured). We pause on it so the
  // recruiter sees the reason — the panel unmounts on refresh, so a transient
  // toast would be lost.
  const [warning, setWarning] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function open(d: Decision) {
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

  function acknowledgeWarning() {
    setWarning(null);
    setDecision(null);
    setRationale("");
    router.refresh();
  }

  function submit() {
    if (!decision) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await decideHitlReview({
          applicationId,
          decision,
          rationale: rationale.trim(),
        });
        // Approval that couldn't auto-send its questions: hold the modal open
        // and show why, instead of silently refreshing into a half-done state.
        if (decision === "approve" && result.screeningWarning) {
          setWarning(result.screeningWarning);
          return;
        }
        setDecision(null);
        setRationale("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to submit decision");
      }
    });
  }

  const isApprove = decision === "approve";

  return (
    <div
      className={
        bare
          ? "rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4"
          : "rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-5"
      }
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-[#FEF3C7] text-[#B45309] flex items-center justify-center shrink-0">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285zm0 13.036h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[#92400E]">
            Awaiting your review
          </h3>
          <p className="text-xs text-[#B45309] mt-0.5">
            This campaign is in human-in-the-loop mode. The AI has produced a
            score and rationale; the advancement decision is yours.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => open("approve")}
          disabled={!campaignActive || !hasScreeningQuestions}
          title={
            !campaignActive
              ? "This campaign isn't Active — set it to Active to approve candidates into screening."
              : !hasScreeningQuestions
                ? "Approving emails the candidate their screening questions — set them up on the campaign page first."
                : undefined
          }
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#059669] rounded-lg cursor-pointer hover:bg-[#047857] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#059669] focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Approve for screening
        </button>
        <button
          type="button"
          onClick={() => open("reject")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#DC2626] bg-white border border-[#FECACA] rounded-lg cursor-pointer hover:bg-[#FEF2F2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2626] focus-visible:ring-offset-1"
        >
          Reject
        </button>
      </div>

      {campaignActive && !hasScreeningQuestions && (
        <p className="text-xs text-[#B45309] mt-3">
          Approving is disabled because this campaign has no screening
          questions yet — approving emails them to the candidate right away.{" "}
          <Link
            href={`/campaigns/${campaignId}#screening-questions`}
            className="font-medium underline hover:text-[#78350F]"
          >
            Set up screening questions
          </Link>
          , then come back to approve.
        </p>
      )}

      <Modal open={decision !== null} onClose={warning ? acknowledgeWarning : close}>
        {warning ? (
          <>
            <ModalHeader>
              <h2 className="text-lg font-semibold text-[#92400E]">
                Approved — but no email was sent
              </h2>
              <p className="text-sm text-[#6B7280] mt-1">
                The candidate is now approved for screening. The screening
                questions could not be emailed automatically:
              </p>
            </ModalHeader>

            <p className="text-sm text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-3">
              {warning}
            </p>

            <ModalFooter>
              <button
                type="button"
                onClick={acknowledgeWarning}
                className="px-4 py-2 text-sm font-medium text-white bg-[#111827] rounded-lg cursor-pointer hover:bg-[#1F2937] transition-colors"
              >
                Got it
              </button>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalHeader>
              <h2 className="text-lg font-semibold text-[#111827]">
                {isApprove ? "Approve for screening" : "Reject application"}
              </h2>
              <p className="text-sm text-[#6B7280] mt-1">
                {isApprove
                  ? "Approving emails the candidate their screening questions right away. Add a short rationale — it's recorded on the audit trail."
                  : "Add a short rationale. This is recorded on the audit trail."}
              </p>
            </ModalHeader>

            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              disabled={isPending}
              rows={4}
              placeholder={
                isApprove
                  ? "e.g. Strong relevant experience; want to see screening answers."
                  : "e.g. Background does not match required stack; declining."
              }
              className="w-full px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-lg text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none resize-y"
            />

            {error && (
              <p className="text-xs text-[#DC2626] mt-2">{error}</p>
            )}

            <ModalFooter>
              <button
                type="button"
                onClick={close}
                disabled={isPending}
                className="px-4 py-2 text-sm font-medium text-[#4B5563] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={isPending || rationale.trim().length < 10}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg cursor-pointer transition-colors disabled:opacity-50 ${
                  isApprove
                    ? "bg-[#059669] hover:bg-[#047857]"
                    : "bg-[#DC2626] hover:bg-[#B91C1C]"
                }`}
              >
                {isPending
                  ? "Submitting..."
                  : isApprove
                    ? "Confirm approval"
                    : "Confirm rejection"}
              </button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
}
