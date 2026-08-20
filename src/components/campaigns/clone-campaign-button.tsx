"use client";

import { useState, useTransition } from "react";
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
        setError(e instanceof Error ? e.message : "Failed to clone campaign");
      }
    });
  }

  return (
    <div>
      <button
        onClick={handleClone}
        disabled={pending}
        className="px-4 py-2 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg cursor-pointer hover:bg-[#F9FAFB] hover:text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Cloning..." : "Clone"}
      </button>
      {error && (
        <p className="text-xs text-[#DC2626] mt-1">{error}</p>
      )}
    </div>
  );
}
