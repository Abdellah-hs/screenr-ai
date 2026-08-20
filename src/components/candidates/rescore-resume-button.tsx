"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rescoreCandidateResume } from "@/lib/actions/candidates";

/**
 * Shown next to the rubric-mismatch badge on a resume score card. Re-runs the
 * AI scoring against the campaign's current rubric — evidence refresh only,
 * the application's pipeline state never changes.
 */
export function RescoreResumeButton({
  applicationId,
  campaignActive,
}: {
  applicationId: string;
  // Re-scoring is processing, so it's frozen unless the campaign is Active —
  // same rule the server action enforces.
  campaignActive: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function rescore() {
    setError(null);
    startTransition(async () => {
      try {
        await rescoreCandidateResume(applicationId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Re-score failed");
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={rescore}
        disabled={isPending || !campaignActive}
        title={
          campaignActive
            ? "Re-score this resume against the current rubric"
            : "This campaign isn't Active — set it to Active to re-score."
        }
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-full cursor-pointer hover:bg-[#F9FAFB] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg
          className={`w-3 h-3 ${isPending ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
          />
        </svg>
        {isPending ? "Re-scoring…" : "Re-score"}
      </button>
      {error && <span className="text-xs text-[#DC2626]">{error}</span>}
    </span>
  );
}
