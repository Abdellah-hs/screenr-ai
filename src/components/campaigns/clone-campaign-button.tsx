"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { cloneCampaign } from "@/lib/actions/campaigns";

interface CloneCampaignButtonProps {
  campaignId: string;
}

export default function CloneCampaignButton({ campaignId }: CloneCampaignButtonProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClone() {
    setError(null);
    startTransition(async () => {
      try {
        await cloneCampaign(campaignId);
      } catch (e) {
        // A successful clone redirects to the copy, and Next signals a redirect
        // by throwing — so this catch would report the success as a failure.
        unstable_rethrow(e);
        setError(e instanceof Error ? e.message : "Failed to clone campaign");
      }
    });
  }

  return (
    <div className="relative">
      <button
        onClick={handleClone}
        disabled={pending}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#D1D5DB] bg-white px-3.5 text-[13px] font-semibold text-[#374151] cursor-pointer transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        {pending ? "Cloning…" : "Clone"}
      </button>
      {error && (
        <p className="absolute right-0 top-full mt-1 whitespace-nowrap text-xs text-[#DC2626]">
          {error}
        </p>
      )}
    </div>
  );
}
