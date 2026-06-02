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
  high: "bg-[#0369A1] text-white",
  medium: "bg-[#E0F2FE] text-[#0C4A6E]",
  low: "bg-[#F1F5F9] text-[#64748B]",
};

export default function RubricDisplay({ rubrics }: RubricDisplayProps) {
  const activeRubrics = rubrics.filter((r) => r.is_active && r.dimensions.length > 0);

  if (activeRubrics.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] p-6">
      <h2 className="text-sm font-semibold text-[#0C4A6E] uppercase tracking-wider mb-4">
        Evaluation Rubrics
      </h2>
      <div className="space-y-5">
        {activeRubrics.map((rubric) => (
          <div key={rubric.id}>
            <h3 className="text-sm font-medium text-[#0C4A6E] mb-2">
              {STAGE_LABELS[rubric.stage] ?? rubric.stage}
            </h3>
            <div className="space-y-2">
              {rubric.dimensions.map((dim) => (
                <div
                  key={dim.id}
                  className="flex items-center justify-between p-3 bg-[#F0F9FF] rounded-lg border border-[#E2E8F0] transition-all duration-200 hover:border-[#0EA5E9]"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-[#0C4A6E]">
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
