"use client";

import { useState, useTransition } from "react";
import { scoreResume } from "@/lib/actions/candidates";

export function ScoreResumeButton({ applicationId }: { applicationId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await scoreResume(applicationId);
      } catch (err) {
        let msg = "Scoring failed";
        if (err instanceof Error && err.message) {
          msg = err.message;
        } else if (typeof err === "string") {
          msg = err;
        } else if (err && typeof err === "object") {
          const maybe = err as { message?: unknown };
          if (typeof maybe.message === "string") msg = maybe.message;
        }
        setError(msg);
      }
    });
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={isPending}
        className="px-4 py-2 text-sm font-medium text-white bg-[#2563EB] rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
      >
        {isPending ? "Scoring..." : "Score Resume"}
      </button>
      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}
    </div>
  );
}
