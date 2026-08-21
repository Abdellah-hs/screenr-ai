import {
  AUTOMATION_MODES,
  DEFAULT_SCORE_THRESHOLD,
  INTERVIEW_PERSONAS,
} from "@/lib/constants";
import type { AutomationMode, InterviewPersona } from "@/lib/constants";

const fieldClass =
  "w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors";

interface AiSettingsFieldsProps {
  defaultAutomationMode?: AutomationMode;
  defaultResumeThreshold?: number;
  defaultScreeningThreshold?: number;
  defaultInterviewPersona?: InterviewPersona;
}

export default function AiSettingsFields({
  defaultAutomationMode = "human_in_loop",
  defaultResumeThreshold = DEFAULT_SCORE_THRESHOLD,
  defaultScreeningThreshold = DEFAULT_SCORE_THRESHOLD,
  defaultInterviewPersona = "neutral",
}: AiSettingsFieldsProps) {
  return (
    <div className="pt-4 border-t border-[#E5E7EB] mt-2">
      <p className="text-sm font-medium text-[#111827] mb-3">AI Settings</p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
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

        {/* Two bars, not one. A resume score ranks CVs against a rubric; a
            screening score grades spoken answers. They are different kinds of
            number, so they get their own fail lines and their own labels. */}
        <div>
          <label htmlFor="resume_threshold" className="block text-sm font-medium text-[#111827] mb-1">
            Resume Threshold
          </label>
          <input
            id="resume_threshold"
            name="resume_threshold"
            type="number"
            min={0}
            max={100}
            defaultValue={defaultResumeThreshold}
            className={fieldClass}
          />
          <p className="text-xs text-[#6B7280] mt-1">
            CV score 0-100. Below this is auto-rejected in Fully Automatic; in
            Human-in-the-Loop it only sorts your queue.
          </p>
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
          <p className="text-xs text-[#6B7280] mt-1">
            Voice-answer score 0-100. Reaching it invites the candidate to the AI
            interview; below it is auto-rejected in Fully Automatic only.
          </p>
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
