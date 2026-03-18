"use client";

import { useState, useTransition } from "react";
import type { ScreeningCriterion } from "@/lib/constants";
import { generateScreeningCriteria } from "@/lib/actions/ai-generate";

interface ScreeningCriteriaEditorProps {
  initialCriteria?: ScreeningCriterion[];
}

export default function ScreeningCriteriaEditor({
  initialCriteria = [],
}: ScreeningCriteriaEditorProps) {
  const [criteria, setCriteria] = useState<ScreeningCriterion[]>(initialCriteria);
  const [generating, startGenerate] = useTransition();

  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  const weightOk = totalWeight >= 0.95 && totalWeight <= 1.05;

  function addCriterion() {
    setCriteria((prev) => [
      ...prev,
      {
        id: `sc-${Math.random().toString(36).substr(2, 9)}`,
        label: "",
        weight: 0,
        is_mandatory: false,
      },
    ]);
  }

  function removeCriterion(id: string) {
    setCriteria((prev) => prev.filter((c) => c.id !== id));
  }

  function updateCriterion(id: string, field: keyof ScreeningCriterion, value: string | number | boolean) {
    setCriteria((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  }

  function handleAutoGenerate() {
    const descriptionEl = document.querySelector<HTMLTextAreaElement>(
      'textarea[name="description"]'
    );
    const description = descriptionEl?.value?.trim() ?? "";

    if (!description) {
      alert("Please enter a job description first so AI can suggest criteria.");
      return;
    }

    startGenerate(async () => {
      const suggestions = await generateScreeningCriteria(description);
      setCriteria(suggestions);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-[#0C4A6E]">
          Screening Criteria
        </label>
        <div className="flex items-center gap-2">
          {criteria.length > 0 && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded ${
                weightOk
                  ? "bg-green-100 text-green-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              Total weight: {(totalWeight * 100).toFixed(0)}%
            </span>
          )}
          <button
            type="button"
            onClick={handleAutoGenerate}
            disabled={generating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#0369A1] rounded-lg cursor-pointer hover:bg-[#0C4A6E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                </svg>
                Auto-Generate
              </>
            )}
          </button>
        </div>
      </div>

      {criteria.length === 0 && (
        <p className="text-sm text-[#6B7280]">
          No screening criteria yet. Add your own or click <strong>Auto-Generate</strong> to let AI suggest criteria from the job description.
        </p>
      )}

      <div className="space-y-2">
        {criteria.map((criterion) => (
          <div
            key={criterion.id}
            className="flex flex-wrap items-center gap-3 p-3 bg-[#F0F9FF] rounded-lg border border-[#E2E8F0]"
          >
            <input
              type="text"
              value={criterion.label}
              onChange={(e) => updateCriterion(criterion.id, "label", e.target.value)}
              placeholder="Criterion label"
              className="flex-1 min-w-[180px] px-3 py-1.5 bg-white border border-[#E2E8F0] rounded-lg text-sm text-[#0C4A6E] focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1] focus-visible:outline-none transition-all duration-200"
            />
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[#6B7280] whitespace-nowrap">Weight</label>
              <input
                type="number"
                value={criterion.weight}
                onChange={(e) =>
                  updateCriterion(criterion.id, "weight", parseFloat(e.target.value) || 0)
                }
                min={0}
                max={1}
                step={0.05}
                className="w-20 px-2 py-1.5 bg-white border border-[#E2E8F0] rounded-lg text-sm text-[#0C4A6E] focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1] focus-visible:outline-none transition-all duration-200 text-center"
              />
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={criterion.is_mandatory}
                onChange={(e) =>
                  updateCriterion(criterion.id, "is_mandatory", e.target.checked)
                }
                className="w-4 h-4 rounded border-[#D1D5DB] text-[#0369A1] cursor-pointer focus:ring-[#0369A1] focus-visible:ring-2"
              />
              <span className="text-xs text-[#6B7280] whitespace-nowrap">Required</span>
            </label>
            <button
              type="button"
              onClick={() => removeCriterion(criterion.id)}
              className="p-1.5 text-[#6B7280] cursor-pointer rounded-lg hover:text-[#DC2626] hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 transition-all duration-200"
              title="Remove criterion"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addCriterion}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#0369A1] cursor-pointer rounded-lg hover:bg-[#F0F9FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] transition-all duration-200"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add Criterion
      </button>

      <input
        type="hidden"
        name="screening_criteria_json"
        value={JSON.stringify(criteria)}
      />
    </div>
  );
}
