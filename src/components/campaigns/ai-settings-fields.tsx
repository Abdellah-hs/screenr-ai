"use client";

import { useState } from "react";
import {
  AUTOMATION_MODES,
  DEFAULT_SCORE_THRESHOLD,
  INTERVIEW_PERSONAS,
} from "@/lib/constants";
import type { AutomationMode, InterviewPersona } from "@/lib/constants";

const fieldClass =
  "w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors";

export interface AiSettings {
  automationMode: AutomationMode;
  resumeThreshold: number;
  screeningThreshold: number;
  interviewPersona: InterviewPersona;
}

interface AiSettingsFieldsProps {
  defaultAutomationMode?: AutomationMode;
  defaultResumeThreshold?: number;
  defaultScreeningThreshold?: number;
  defaultInterviewPersona?: InterviewPersona;
  /** Reports every change so a caller can show what the settings will run. */
  onChange?: (settings: AiSettings) => void;
}

export default function AiSettingsFields({
  defaultAutomationMode = "human_in_loop",
  defaultResumeThreshold = DEFAULT_SCORE_THRESHOLD,
  defaultScreeningThreshold = DEFAULT_SCORE_THRESHOLD,
  defaultInterviewPersona = "neutral",
  onChange,
}: AiSettingsFieldsProps) {
  const [settings, setSettings] = useState<AiSettings>({
    automationMode: defaultAutomationMode,
    resumeThreshold: defaultResumeThreshold,
    screeningThreshold: defaultScreeningThreshold,
    interviewPersona: defaultInterviewPersona,
  });

  function update(patch: Partial<AiSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    onChange?.(next);
  }

  const autoRejects = settings.automationMode === "fully_auto";

  return (
    <div>
      {/* Two bars, not one. A resume ranking orders CVs against a rubric; a
          screening score grades spoken answers. They are different kinds of
          number, so they get their own fail lines and their own labels. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div>
          <label htmlFor="automation_mode" className="block text-sm font-medium text-[#111827] mb-1">
            Automation Mode
          </label>
          <select
            id="automation_mode"
            name="automation_mode"
            value={settings.automationMode}
            onChange={(e) =>
              update({ automationMode: e.target.value as AutomationMode })
            }
            className={fieldClass}
          >
            {AUTOMATION_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <p className="text-xs text-[#6B7280] mt-1">Controls how much AI acts autonomously</p>
        </div>

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
            value={settings.resumeThreshold}
            onChange={(e) => update({ resumeThreshold: Number(e.target.value) })}
            className={fieldClass}
          />
          {/* Says what this number does AND what it does not do. The must-have
              gate rejects in every mode, so "rejects nobody in this mode" would
              be a lie about the stage even where it is true about the bar. */}
          <p className="text-xs text-[#6B7280] mt-1">
            {autoRejects
              ? "Ranking 0–100. Below this is auto-rejected. A missing must-have rejects whatever this says."
              : "Ranking 0–100. It sorts your review queue; this number rejects nobody. A missing must-have still rejects."}
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
            value={settings.screeningThreshold}
            onChange={(e) =>
              update({ screeningThreshold: Number(e.target.value) })
            }
            className={fieldClass}
          />
          <p className="text-xs text-[#6B7280] mt-1">
            {autoRejects
              ? "Voice-answer score 0–100. Reaching it invites the candidate to the AI interview; below it is auto-rejected."
              : "Voice-answer score 0–100. It sorts your review queue; it rejects nobody in this mode."}
          </p>
        </div>

        <div>
          <label htmlFor="interview_persona" className="block text-sm font-medium text-[#111827] mb-1">
            Interview Persona
          </label>
          <select
            id="interview_persona"
            name="interview_persona"
            value={settings.interviewPersona}
            onChange={(e) =>
              update({ interviewPersona: e.target.value as InterviewPersona })
            }
            className={fieldClass}
          >
            {INTERVIEW_PERSONAS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <p className="text-xs text-[#6B7280] mt-1">
            Tone of the AI interviewer. It never changes what is scored.
          </p>
        </div>
      </div>
    </div>
  );
}
