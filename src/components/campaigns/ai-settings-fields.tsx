import { AUTOMATION_MODES, INTERVIEW_PERSONAS } from "@/lib/constants";
import type { AutomationMode, InterviewPersona } from "@/lib/constants";

const fieldClass =
  "w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors";

interface AiSettingsFieldsProps {
  defaultAutomationMode?: AutomationMode;
  defaultScreeningThreshold?: number;
  defaultInterviewPersona?: InterviewPersona;
}

export default function AiSettingsFields({
  defaultAutomationMode = "human_in_loop",
  defaultScreeningThreshold = 70,
  defaultInterviewPersona = "neutral",
}: AiSettingsFieldsProps) {
  return (
    <div className="pt-4 border-t border-[#E5E7EB] mt-2">
      <p className="text-sm font-medium text-[#111827] mb-3">AI Settings</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label htmlFor="automation_mode" className="block text-sm font-medium text-[#111827] mb-1">
            Automation Mode
          </label>
          <select
            id="automation_mode"
            name="automation_mode"
            defaultValue={defaultAutomationMode}
            className={fieldClass}
          >
            {AUTOMATION_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <p className="text-xs text-[#6B7280] mt-1">Controls how much AI acts autonomously</p>
        </div>

        <div>
          <label htmlFor="screening_threshold" className="block text-sm font-medium text-[#111827] mb-1">
            Screening Threshold
          </label>
          <input
            id="screening_threshold"
            name="screening_threshold"
            type="number"
            min={0}
            max={100}
            defaultValue={defaultScreeningThreshold}
            className={fieldClass}
          />
          <p className="text-xs text-[#6B7280] mt-1">Score 0-100; below = auto-reject</p>
        </div>

        <div>
          <label htmlFor="interview_persona" className="block text-sm font-medium text-[#111827] mb-1">
            Interview Persona
          </label>
          <select
            id="interview_persona"
            name="interview_persona"
            defaultValue={defaultInterviewPersona}
            className={fieldClass}
          >
            {INTERVIEW_PERSONAS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <p className="text-xs text-[#6B7280] mt-1">AI interviewer tone and style</p>
        </div>
      </div>
    </div>
  );
}
