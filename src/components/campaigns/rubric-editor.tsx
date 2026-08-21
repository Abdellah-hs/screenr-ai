"use client";

import { useState, useTransition } from "react";
import type { EvaluationRubric, RubricDimension, PipelineStage } from "@/lib/constants";
import { generateRubricDimensions } from "@/lib/actions/ai-generate";
import { RUBRIC_STAGES } from "@/lib/campaigns/wizard";

interface RubricEditorProps {
  /** Uncontrolled seed. Ignored when `value` is passed. */
  initialRubrics?: EvaluationRubric[];
  campaignId?: string;
  /**
   * Controlled mode. The wizard has to pass this: its steps unmount, so state
   * held in here would be destroyed by pressing Next.
   */
  value?: EvaluationRubric[];
  onChange?: (rubrics: EvaluationRubric[]) => void;
  /**
   * The description the AI drafts dimensions from. Falls back to reading the
   * sibling textarea, which is how the edit page (one long form) supplies it —
   * in the wizard that textarea is on another step and not in the DOM.
   */
  description?: string;
}

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

function seedRubrics(
  initialRubrics: EvaluationRubric[],
  campaignId: string,
): EvaluationRubric[] {
  const existing = [...initialRubrics];
  for (const stage of RUBRIC_STAGES) {
    if (!existing.find((r) => r.stage === stage.key)) {
      existing.push(createEmptyRubric(stage.key, campaignId));
    }
  }
  return existing;
}

export default function RubricEditor({
  initialRubrics = [],
  campaignId = "",
  value,
  onChange,
  description,
}: RubricEditorProps) {
  const [internal, setInternal] = useState<EvaluationRubric[]>(() =>
    seedRubrics(initialRubrics, campaignId),
  );
  const rubrics = value ?? internal;

  function setRubrics(next: EvaluationRubric[]) {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  }

  const [activeTab, setActiveTab] = useState<PipelineStage>("resume");
  const [generating, startGenerate] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dimensions = rubrics.find((r) => r.stage === activeTab)?.dimensions ?? [];

  function setDimensions(next: RubricDimension[]) {
    setRubrics(
      rubrics.map((r) => (r.stage === activeTab ? { ...r, dimensions: next } : r)),
    );
  }

  function updateDimension(
    dimId: string,
    field: keyof RubricDimension,
    fieldValue: string | number | boolean,
  ) {
    setDimensions(
      dimensions.map((d) => (d.id === dimId ? { ...d, [field]: fieldValue } : d)),
    );
  }

  function handleAutoGenerate() {
    const fromDom = document.querySelector<HTMLTextAreaElement>(
      'textarea[name="description"]',
    )?.value;
    const source = (description ?? fromDom ?? "").trim();

    if (!source) {
      setError(
        "Write the job description first — the dimensions are drafted from it.",
      );
      return;
    }

    setError(null);
    startGenerate(async () => {
      try {
        setRubrics(await generateRubricDimensions(source, campaignId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate rubrics");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[280px] flex-1 gap-1 rounded-lg bg-[#F3F4F6] p-1">
          {RUBRIC_STAGES.map((stage) => {
            const count =
              rubrics.find((r) => r.stage === stage.key)?.dimensions.length ?? 0;
            const active = activeTab === stage.key;
            return (
              <button
                key={stage.key}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveTab(stage.key)}
                className={`inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-[7px] rounded-md px-2.5 text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  active
                    ? "bg-white font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
                    : "font-medium text-[#6B7280] hover:text-ink"
                }`}
              >
                {stage.label}
                {count > 0 && (
                  <span className="rounded-full bg-[#E5E7EB] px-[7px] py-px text-[11px] text-[#4B5563]">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Secondary, not primary: drafting a rubric is a helper, not a
            commitment — and an AI never gets an ink button. */}
        <button
          type="button"
          onClick={handleAutoGenerate}
          disabled={generating}
          className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[#D1D5DB] bg-white px-3 text-[13px] font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generating && (
            <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {generating ? "Drafting…" : "Auto-generate from the description"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-[13px] text-[#B91C1C]">
          {error}
        </p>
      )}

      {dimensions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] px-3.5 py-5 text-center text-[13px] text-[#6B7280]">
          No dimensions for this stage. Nothing here is scored until you add one.
        </p>
      ) : (
        <div className="flex flex-col gap-[9px]">
          {dimensions.map((dim) => (
            <div
              key={dim.id}
              className="flex flex-wrap items-center gap-3.5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3"
            >
              <input
                type="text"
                value={dim.name}
                onChange={(e) => updateDimension(dim.id, "name", e.target.value)}
                placeholder="Dimension name"
                aria-label="Dimension name"
                className="min-h-10 min-w-[150px] flex-1 rounded-lg border border-[#E5E7EB] bg-white px-3 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-[#9CA3AF] focus:border-primary focus:outline-[3px] focus:outline-primary/20"
              />

              <Segmented
                ariaLabel={`Type for ${dim.name || "dimension"}`}
                value={dim.is_mandatory ? "must" : "nice"}
                onChange={(v) => updateDimension(dim.id, "is_mandatory", v === "must")}
                options={[
                  { value: "must", label: "Must have" },
                  { value: "nice", label: "Nice to have" },
                ]}
              />

              <Segmented
                ariaLabel={`Importance for ${dim.name || "dimension"}`}
                value={dim.importance}
                onChange={(v) => updateDimension(dim.id, "importance", v)}
                options={[
                  { value: "high", label: "High" },
                  { value: "medium", label: "Med" },
                  { value: "low", label: "Low" },
                ]}
              />

              <button
                type="button"
                onClick={() => setDimensions(dimensions.filter((d) => d.id !== dim.id))}
                aria-label={`Remove ${dim.name || "dimension"}`}
                title="Remove dimension"
                className="ml-auto inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-[#9CA3AF] transition-colors duration-150 hover:bg-[#FEF2F2] hover:text-[#DC2626] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2626]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3.5">
        <button
          type="button"
          onClick={() =>
            setDimensions([
              ...dimensions,
              { ...createEmptyDimension(), sort_order: dimensions.length },
            ])
          }
          className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[#D1D5DB] bg-white px-3 text-[13px] font-semibold text-[#374151] transition-colors duration-150 hover:border-[#9CA3AF] hover:bg-[#F9FAFB] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add dimension
        </button>
        <p className="min-w-[240px] flex-1 text-xs leading-[1.55] text-[#6B7280]">
          <strong className="font-semibold text-ink">Must have</strong> dimensions
          knock a candidate out if they fail them. Weighting is derived from
          importance — there are no numbers to tune.
        </p>
      </div>

      {/* The uncontrolled caller (the edit form) posts through this. The wizard
          serialises its own draft and never reads the DOM. */}
      <input type="hidden" name="rubrics_json" value={JSON.stringify(rubrics)} />
    </div>
  );
}

/**
 * Compact single-select. Selection is signalled by ink fill AND weight AND
 * aria-pressed — never colour alone.
 */
function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <span
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-lg border border-[#E5E7EB] bg-white p-0.5"
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            className={`min-h-[34px] cursor-pointer rounded-md px-[11px] text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              selected
                ? "bg-ink font-semibold text-white"
                : "font-medium text-[#6B7280] hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </span>
  );
}
