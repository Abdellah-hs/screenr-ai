import type { ScreeningCriterion } from "@/lib/constants";

interface ScreeningCriteriaDisplayProps {
  criteria: ScreeningCriterion[];
}

export default function ScreeningCriteriaDisplay({
  criteria,
}: ScreeningCriteriaDisplayProps) {
  if (criteria.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] p-6">
      <h2 className="text-sm font-semibold text-[#0C4A6E] uppercase tracking-wider mb-4">
        Screening Criteria
      </h2>
      <div className="space-y-2">
        {criteria.map((criterion) => (
          <div
            key={criterion.id}
            className="flex items-center justify-between p-3 bg-[#F0F9FF] rounded-lg border border-[#E2E8F0] transition-all duration-200 hover:border-[#0EA5E9]"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-[#0C4A6E]">
                {criterion.label}
              </span>
              {criterion.is_mandatory && (
                <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-red-100 text-red-700">
                  Required
                </span>
              )}
            </div>
            <span className="text-sm font-medium text-[#6B7280]">
              {(criterion.weight * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
