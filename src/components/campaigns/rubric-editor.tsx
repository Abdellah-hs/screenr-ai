"use client";

import { useState, useTransition } from "react";
import type { EvaluationRubric, RubricDimension, PipelineStage } from "@/lib/constants";
import { generateRubricDimensions } from "@/lib/actions/ai-generate";

interface RubricEditorProps {
  initialRubrics?: EvaluationRubric[];
  campaignId?: string;
}

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: "resume", label: "Resume" },
  { key: "screening_q", label: "Screening Questions" },
  { key: "interview", label: "Interview" },
];

function createEmptyRubric(stage: PipelineStage, campaignId: string): EvaluationRubric {
  return {
    id: `rub-${Math.random().toString(36).slice(2, 11)}`,
    campaign_id: campaignId,
    stage,
    version: 1,
    is_active: true,
    dimensions: [],
    created_at: new Date().toISOString(),
    archived_at: null,
  };
}

function createEmptyDimension(): RubricDimension {
  return {
    id: `dim-${Math.random().toString(36).slice(2, 11)}`,
    name: "",
    importance: "medium",
    is_mandatory: false,
    // Derived server-side from importance/is_mandatory on save (issue #77) —
    // these are placeholders the editor never asks the recruiter to set.
    weight: 0,
    min_score: 0,
    max_score: 100,
    sort_order: 0,
  };
}

export default function RubricEditor({
  initialRubrics = [],
  campaignId = "",
}: RubricEditorProps) {
  const [rubrics, setRubrics] = useState<EvaluationRubric[]>(() => {
    const existing = [...initialRubrics];
    for (const stage of STAGES) {
      if (!existing.find((r) => r.stage === stage.key)) {
        existing.push(createEmptyRubric(stage.key, campaignId));
      }
    }
    return existing;
  });

  const [activeTab, setActiveTab] = useState<PipelineStage>("resume");
  const [generating, startGenerate] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const activeRubric = rubrics.find((r) => r.stage === activeTab);
  const dimensions = activeRubric?.dimensions ?? [];

  function updateRubricDimensions(stage: PipelineStage, newDimensions: RubricDimension[]) {
    setRubrics((prev) =>
      prev.map((r) =>
        r.stage === stage ? { ...r, dimensions: newDimensions } : r
      )
    );
  }

  function addDimension() {
    const newDim = createEmptyDimension();
    newDim.sort_order = dimensions.length;
    updateRubricDimensions(activeTab, [...dimensions, newDim]);
  }

  function removeDimension(dimId: string) {
    updateRubricDimensions(
      activeTab,
      dimensions.filter((d) => d.id !== dimId)
    );
  }

  function updateDimension(dimId: string, field: keyof RubricDimension, value: string | number | boolean) {
    updateRubricDimensions(
      activeTab,
      dimensions.map((d) => (d.id === dimId ? { ...d, [field]: value } : d))
    );
  }

  function handleAutoGenerate() {
    const descriptionEl = document.querySelector<HTMLTextAreaElement>(
      'textarea[name="description"]'
    );
    const description = descriptionEl?.value?.trim() ?? "";

    if (!description) {
      alert("Please enter a job description first so AI can suggest rubric dimensions.");
      return;
    }

    setError(null);
    startGenerate(async () => {
      try {
        const generated = await generateRubricDimensions(description, campaignId);
        setRubrics(generated);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate rubrics");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-[#0C4A6E]">
          Evaluation Rubrics
        </label>
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

      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-200">
          {error}
        </div>
      )}

      {/* Stage Tabs */}
      <div className="flex gap-1 p-1 bg-[#F0F9FF] rounded-lg">
        {STAGES.map((stage) => {
          const rubric = rubrics.find((r) => r.stage === stage.key);
          const dimCount = rubric?.dimensions.length ?? 0;
          return (
            <button
              key={stage.key}
              type="button"
              onClick={() => setActiveTab(stage.key)}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] transition-all duration-200 ${
                activeTab === stage.key
                  ? "bg-white text-[#0C4A6E] shadow-sm"
                  : "text-[#6B7280] hover:text-[#0C4A6E]"
              }`}
            >
              {stage.label}
              {dimCount > 0 && (
                <span className="ml-1.5 text-xs bg-[#E2E8F0] text-[#6B7280] px-1.5 py-0.5 rounded-full">
                  {dimCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Dimensions */}
      {dimensions.length === 0 && (
        <p className="text-sm text-[#6B7280]">
          No dimensions for this stage. Add your own or click <strong>Auto-Generate</strong> to let AI suggest dimensions for all stages.
        </p>
      )}

      <div className="space-y-2">
        {dimensions.map((dim) => (
          <div
            key={dim.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 bg-[#F0F9FF] rounded-lg border border-[#E2E8F0]"
          >
            <input
              type="text"
              value={dim.name}
              onChange={(e) => updateDimension(dim.id, "name", e.target.value)}
              placeholder="Dimension name"
              aria-label="Dimension name"
              className="flex-1 min-w-[180px] px-3 py-1.5 bg-white border border-[#E2E8F0] rounded-lg text-sm text-[#0C4A6E] focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1] focus-visible:outline-none transition-all duration-200"
            />

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#6B7280] whitespace-nowrap">Type</span>
              <SegmentedControl
                ariaLabel={`Type for ${dim.name || "dimension"}`}
                value={dim.is_mandatory ? "must" : "nice"}
                onChange={(v) => updateDimension(dim.id, "is_mandatory", v === "must")}
                options={[
                  { value: "must", label: "Must have" },
                  { value: "nice", label: "Nice to have" },
                ]}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#6B7280] whitespace-nowrap">Importance</span>
              <SegmentedControl
                ariaLabel={`Importance for ${dim.name || "dimension"}`}
                value={dim.importance}
                onChange={(v) => updateDimension(dim.id, "importance", v)}
                options={[
                  { value: "high", label: "High" },
                  { value: "medium", label: "Med" },
                  { value: "low", label: "Low" },
                ]}
              />
            </div>

            <button
              type="button"
              onClick={() => removeDimension(dim.id)}
              className="ml-auto p-1.5 text-[#6B7280] cursor-pointer rounded-lg hover:text-[#DC2626] hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 transition-all duration-200"
              aria-label={`Remove ${dim.name || "dimension"}`}
              title="Remove dimension"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {dimensions.length > 0 && (
        <p className="text-xs text-[#6B7280]">
          Weighting is set automatically from each dimension&apos;s importance. &ldquo;Must have&rdquo; dimensions knock a candidate out if they fail them.
        </p>
      )}

      <button
        type="button"
        onClick={addDimension}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#0369A1] cursor-pointer rounded-lg hover:bg-[#F0F9FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] transition-all duration-200"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add Dimension
      </button>

      <input
        type="hidden"
        name="rubrics_json"
        value={JSON.stringify(rubrics)}
      />
    </div>
  );
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
}

/**
 * Compact single-select control. Selection is signalled by background AND
 * weight AND aria-pressed — never colour alone — so it stays usable for
 * colour-blind and keyboard/screen-reader users.
 */
function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg border border-[#E2E8F0] bg-white p-0.5"
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0369A1] ${
              selected
                ? "bg-[#0369A1] text-white shadow-sm"
                : "text-[#6B7280] hover:text-[#0C4A6E] hover:bg-[#F0F9FF]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
