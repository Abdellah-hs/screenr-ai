import type { EvaluationRubric, DimensionImportance } from "@/lib/constants";

interface RubricDisplayProps {
  rubrics: EvaluationRubric[];
}

const STAGE_LABELS: Record<string, string> = {
  resume: "Resume",
  screening_q: "Screening Questions",
  interview: "Interview",
};

const IMPORTANCE_LABELS: Record<DimensionImportance, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const IMPORTANCE_STYLES: Record<DimensionImportance, string> = {
  high: "bg-[#374151] text-white",
  medium: "bg-[#E5E7EB] text-[#374151]",
  low: "bg-[#F3F4F6] text-[#6B7280]",
};

export default function RubricDisplay({ rubrics }: RubricDisplayProps) {
  const activeRubrics = rubrics.filter((r) => r.is_active && r.dimensions.length > 0);

  if (activeRubrics.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-6">
      <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider mb-4">
        Evaluation Rubrics
      </h2>
      <div className="space-y-5">
        {activeRubrics.map((rubric) => (
          <div key={rubric.id}>
            <h3 className="text-sm font-medium text-[#111827] mb-2">
              {STAGE_LABELS[rubric.stage] ?? rubric.stage}
            </h3>
            <div className="space-y-2">
              {rubric.dimensions.map((dim) => (
                <div
                  key={dim.id}
                  className="flex items-center justify-between p-3 bg-[#F9FAFB] rounded-lg border border-[#E5E7EB] transition-colors duration-150 hover:border-[#D1D5DB]"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-[#111827]">
                      {dim.name}
                    </span>
                    {dim.is_mandatory && (
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-red-100 text-red-700">
                        Must have
                      </span>
                    )}
                  </div>
                  <span
                    className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${IMPORTANCE_STYLES[dim.importance]}`}
                    title="Importance"
                  >
                    {IMPORTANCE_LABELS[dim.importance]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
