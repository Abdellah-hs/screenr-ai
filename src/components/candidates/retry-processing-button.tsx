"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryResumeProcessing } from "@/lib/actions/candidates";

/**
 * Shown on an application stuck in `processing_failed` — the state our own
 * extractor or a model outage put it in. Re-reads the stored CV and, if it
 * works this time, puts the application back into `new` and scores it.
 *
 * Ink, because it changes an application's state. It is the recruiter's
 * decision to spend a conversion on this CV again, and the outcome moves a
 * person through the pipeline.
 */
export function RetryProcessingButton({
  applicationId,
  campaignActive,
}: {
  applicationId: string;
  // Re-reading a CV is processing, so it's frozen unless the campaign is
  // Active — the same rule the server action enforces.
  campaignActive: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function retry() {
    setError(null);
    startTransition(async () => {
      try {
        await retryResumeProcessing(applicationId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Processing failed again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={retry}
        disabled={isPending || !campaignActive}
        title={
          campaignActive
            ? "Read this CV again and score it"
            : "This campaign isn't Active — set it to Active to process this CV."
        }
        className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-[#111827] px-3 py-1.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#1F2937] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg
          className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.023 9.348h4.992V4.356m-4.992 4.992-3.181-3.183a8.25 8.25 0 0 0-13.803 3.7M2.985 19.644v-4.992m0 0h4.993m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7"
          />
        </svg>
        {isPending ? "Reading the CV…" : "Try again"}
      </button>
      {error && <p className="text-[13px] text-[#B91C1C]">{error}</p>}
    </div>
  );
}
