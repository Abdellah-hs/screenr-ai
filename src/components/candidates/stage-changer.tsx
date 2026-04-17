"use client";

import { useEffect, useState, useTransition } from "react";
import { updateCandidateStage } from "@/lib/actions/candidates";
import type { CandidateStage } from "@/lib/constants";

const stages: { value: CandidateStage; label: string }[] = [
  { value: "applied", label: "Applied" },
  { value: "screening", label: "Screening" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "hired", label: "Hired" },
  { value: "rejected", label: "Rejected" },
];

const stageColors: Record<CandidateStage, string> = {
  applied: "text-[#6B7280] bg-[#F3F4F6] border-[#E5E7EB]",
  screening: "text-[#2563EB] bg-[#EFF6FF] border-[#BFDBFE]",
  interview: "text-[#7C3AED] bg-[#F5F3FF] border-[#DDD6FE]",
  offer: "text-[#D97706] bg-[#FEF3C7] border-[#FDE68A]",
  hired: "text-[#059669] bg-[#ECFDF5] border-[#A7F3D0]",
  rejected: "text-[#DC2626] bg-[#FEF2F2] border-[#FECACA]",
};

export function StageChanger({
  applicationId,
  currentStage,
}: {
  applicationId: string;
  currentStage: CandidateStage;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState(currentStage);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Keep local state in sync when the parent re-renders after a revalidate —
  // e.g. a sibling component (ScreeningThread, pipeline buttons) advances the
  // stage server-side, Next.js refetches the candidate, and this component
  // gets a new currentStage prop. Without this, the old stage would stick.
  useEffect(() => {
    setStage(currentStage);
  }, [currentStage]);

  function handleSelect(newStage: CandidateStage) {
    if (newStage === stage) {
      setOpen(false);
      return;
    }
    setError(null);
    setOpen(false);
    startTransition(async () => {
      try {
        await updateCandidateStage(applicationId, newStage);
        setStage(newStage);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update stage");
      }
    });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={isPending}
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium border rounded-md capitalize cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-1 ${stageColors[stage]} ${isPending ? "opacity-50" : ""}`}
      >
        {isPending ? "Updating..." : (stages.find((s) => s.value === stage)?.label ?? stage)}
        <svg
          className={`w-3 h-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-[#E5E7EB] rounded-lg py-1 min-w-[140px]">
            {stages.map((s) => (
              <button
                key={s.value}
                onClick={() => handleSelect(s.value)}
                className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-all duration-200 hover:bg-[#F9FAFB] ${
                  s.value === stage
                    ? "font-semibold text-[#0369A1]"
                    : "text-[#4B5563]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}

      {error && (
        <p className="text-xs text-[#DC2626] mt-1">{error}</p>
      )}
    </div>
  );
}
