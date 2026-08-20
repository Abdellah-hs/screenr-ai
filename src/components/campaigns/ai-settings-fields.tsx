"use client";

import { useState } from "react";
import { AUTOMATION_MODES, INTERVIEW_PERSONAS } from "@/lib/constants";
import type { AutomationMode, InterviewPersona } from "@/lib/constants";

const fieldClass =
  "w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors";

export interface AiSettings {
  automationMode: AutomationMode;
  screeningThreshold: number;
  interviewPersona: InterviewPersona;
}

interface AiSettingsFieldsProps {
  defaultAutomationMode?: AutomationMode;
  defaultScreeningThreshold?: number;
  defaultInterviewPersona?: InterviewPersona;
  /** Reports every change so a caller can show what the settings will run. */
  onChange?: (settings: AiSettings) => void;
}

export default function AiSettingsFields({
  defaultAutomationMode = "human_in_loop",
  defaultScreeningThreshold = 70,
  defaultInterviewPersona = "neutral",
  onChange,
}: AiSettingsFieldsProps) {
  const [settings, setSettings] = useState<AiSettings>({
    automationMode: defaultAutomationMode,
    screeningThreshold: defaultScreeningThreshold,
    interviewPersona: defaultInterviewPersona,
  });

  function update(patch: Partial<AiSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    onChange?.(next);
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
          {/* The one setting in the product that ends an application without a
              person, and only in one mode — say which. */}
          <p className="text-xs text-[#6B7280] mt-1">
            {settings.automationMode === "fully_auto"
              ? "Score 0–100. Below this is auto-rejected, with the rule that fired recorded."
              : "Score 0–100. It sorts your review queue; it rejects nobody in this mode."}
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
