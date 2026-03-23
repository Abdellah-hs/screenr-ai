"use client";

import { useState } from "react";
import { type SlaTimer, PIPELINE_STAGES } from "@/lib/constants";

interface Props {
  initialTimers?: SlaTimer[];
}

const DEFAULT_SLA: SlaTimer = {
  stage: "screening_q",
  time_limit_hours: 48,
  alert_threshold_hours: 36,
  escalation_threshold_hours: 44,
};

export default function SlaTimersEditor({ initialTimers = [] }: Props) {
  const [timers, setTimers] = useState<SlaTimer[]>(initialTimers);

  const addTimer = () => {
    setTimers([...timers, { ...DEFAULT_SLA }]);
  };

  const removeTimer = (index: number) => {
    setTimers(timers.filter((_, i) => i !== index));
  };

  const updateTimer = (index: number, field: keyof SlaTimer, value: any) => {
    const newTimers = [...timers];
    newTimers[index] = { ...newTimers[index], [field]: value };
    setTimers(newTimers);
  };

  const availableStages = PIPELINE_STAGES.filter(
    (stage) => !timers.some((t) => t.stage === stage.key)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[#111827]">SLA Timers</h3>
        {availableStages.length > 0 && (
          <button
            type="button"
            onClick={addTimer}
            className="text-sm text-[#2563EB] hover:text-[#1D4ED8]"
          >
            + Add Timer
          </button>
        )}
      </div>
      <p className="text-sm text-[#6B7280]">
        Set Service Level Agreements for how long candidates can stay in a specific pipeline stage before triggering alerts.
      </p>

      {timers.length === 0 ? (
        <div className="p-4 bg-gray-50 border border-gray-200 border-dashed rounded-lg text-center text-sm text-gray-500">
          No SLA Timers configured.
        </div>
      ) : (
        <div className="space-y-3">
          {timers.map((timer, index) => (
            <div key={index} className="p-4 bg-white border border-[#D1D5DB] rounded-lg space-y-3 relative group">
              <button
                type="button"
                onClick={() => removeTimer(index)}
                className="absolute top-3 right-3 text-gray-400 hover:text-red-500"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-[#374151] mb-1">Stage</label>
                  <select
                    value={timer.stage}
                    onChange={(e) => updateTimer(index, "stage", e.target.value)}
                    className="w-full text-sm placeholder:text-[#9CA3AF] bg-white border border-[#D1D5DB] focus:border-[#2563EB] outline-none rounded-md px-3 py-1.5 transition-colors"
                  >
                    <option value={timer.stage}>
                      {PIPELINE_STAGES.find((s) => s.key === timer.stage)?.name || timer.stage}
                    </option>
                    {availableStages.map((stage) => (
                      <option key={stage.key} value={stage.key}>
                        {stage.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#374151] mb-1">Time Limit (Hours)</label>
                  <input
                    type="number"
                    min="1"
                    value={timer.time_limit_hours}
                    onChange={(e) => updateTimer(index, "time_limit_hours", parseInt(e.target.value) || 1)}
                    className="w-full text-sm placeholder:text-[#9CA3AF] bg-white border border-[#D1D5DB] focus:border-[#2563EB] outline-none rounded-md px-3 py-1.5 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#374151] mb-1">Alert Threshold (Hours)</label>
                  <input
                    type="number"
                    min="0"
                    value={timer.alert_threshold_hours}
                    onChange={(e) => updateTimer(index, "alert_threshold_hours", parseInt(e.target.value) || 0)}
                    className="w-full text-sm placeholder:text-[#9CA3AF] bg-white border border-[#D1D5DB] focus:border-[#2563EB] outline-none rounded-md px-3 py-1.5 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#374151] mb-1">Escalation Threshold (Hours)</label>
                  <input
                    type="number"
                    min="0"
                    value={timer.escalation_threshold_hours}
                    onChange={(e) => updateTimer(index, "escalation_threshold_hours", parseInt(e.target.value) || 0)}
                    className="w-full text-sm placeholder:text-[#9CA3AF] bg-white border border-[#D1D5DB] focus:border-[#2563EB] outline-none rounded-md px-3 py-1.5 transition-colors"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hidden input to pass data to Server Action */}
      <input type="hidden" name="sla_timers_json" value={JSON.stringify(timers)} />
    </div>
  );
}
