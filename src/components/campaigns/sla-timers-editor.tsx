"use client";

import { useState } from "react";
import { type SlaTimer, SLA_STAGES } from "@/lib/constants";
import { EDITOR_HEAD_BUTTON, EDITOR_TITLE, FIELD_SM, LABEL_SM, RemoveButton, SelectChevron } from "./editor-parts";

interface Props {
  /** Uncontrolled seed. Ignored when `value` is passed. */
  initialTimers?: SlaTimer[];
  /** Controlled mode — required by the wizard, whose steps unmount. */
  value?: SlaTimer[];
  onChange?: (timers: SlaTimer[]) => void;
}

const DEFAULT_SLA: SlaTimer = {
  stage: "screening",
  time_limit_hours: 48,
  alert_threshold_hours: 36,
  escalation_threshold_hours: 44,
};

export default function SlaTimersEditor({ initialTimers = [], value, onChange }: Props) {
  const [internal, setInternal] = useState<SlaTimer[]>(initialTimers);
  const timers = value ?? internal;

  function setTimers(next: SlaTimer[]) {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  }

  // Default a new timer to the first stage with no timer yet, so the new card
  // is visibly distinct rather than a confusing duplicate — and one stage can
  // never end up with two timers.
  const availableStages = SLA_STAGES.filter(
    (stage) => !timers.some((t) => t.stage === stage.key),
  );

  function updateTimer<K extends keyof SlaTimer>(index: number, field: K, next: SlaTimer[K]) {
    setTimers(timers.map((t, i) => (i === index ? { ...t, [field]: next } : t)));
  }

  return (
    <div>
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <p className={EDITOR_TITLE}>
          SLA timers
          {timers.length > 0 && (
            <span className="ml-2 text-xs font-normal text-[#6B7280]">
              {timers.length}
            </span>
          )}
        </p>
        {availableStages.length > 0 && (
          <button
            type="button"
            onClick={() =>
              setTimers([...timers, { ...DEFAULT_SLA, stage: availableStages[0].key }])
            }
            className={EDITOR_HEAD_BUTTON}
          >
            Add timer
          </button>
        )}
      </div>

      {timers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] px-4 py-5 text-center text-[13px] text-[#6B7280]">
          No timers. Nothing will chase a candidate who stalls — and nothing will
          reject one either.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {timers.map((timer, index) => (
            <div
              key={index}
              className="relative rounded-lg border border-[#D1D5DB] p-4"
            >
              <RemoveButton
                label={`Remove the ${
                  SLA_STAGES.find((s) => s.key === timer.stage)?.name ?? timer.stage
                } timer`}
                onClick={() => setTimers(timers.filter((_, i) => i !== index))}
                className="absolute right-2.5 top-2.5 h-8 w-8"
              />

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label htmlFor={`sla-stage-${index}`} className={LABEL_SM}>
                    Stage
                  </label>
                  <span className="relative block">
                    <select
                      id={`sla-stage-${index}`}
                      value={timer.stage}
                      onChange={(e) =>
                        updateTimer(index, "stage", e.target.value as SlaTimer["stage"])
                      }
                      className={`${FIELD_SM} cursor-pointer appearance-none pr-[30px]`}
                    >
                      <option value={timer.stage}>
                        {SLA_STAGES.find((s) => s.key === timer.stage)?.name ?? timer.stage}
                      </option>
                      {availableStages.map((stage) => (
                        <option key={stage.key} value={stage.key}>
                          {stage.name}
                        </option>
                      ))}
                    </select>
                    <SelectChevron />
                  </span>
                </div>

                <div>
                  <label htmlFor={`sla-limit-${index}`} className={LABEL_SM}>
                    Time limit (hours)
                  </label>
                  <input
                    id={`sla-limit-${index}`}
                    type="number"
                    min={1}
                    value={timer.time_limit_hours}
                    onChange={(e) =>
                      updateTimer(index, "time_limit_hours", parseInt(e.target.value) || 1)
                    }
                    className={`${FIELD_SM} tabular-nums`}
                  />
                </div>

                <div>
                  <label htmlFor={`sla-alert-${index}`} className={LABEL_SM}>
                    Alert threshold (hours)
                  </label>
                  <input
                    id={`sla-alert-${index}`}
                    type="number"
                    min={1}
                    value={timer.alert_threshold_hours}
                    onChange={(e) =>
                      updateTimer(index, "alert_threshold_hours", parseInt(e.target.value) || 1)
                    }
                    className={`${FIELD_SM} tabular-nums`}
                  />
                </div>

                <div>
                  <label htmlFor={`sla-esc-${index}`} className={LABEL_SM}>
                    Escalation threshold (hours)
                  </label>
                  <input
                    id={`sla-esc-${index}`}
                    type="number"
                    min={1}
                    value={timer.escalation_threshold_hours}
                    onChange={(e) =>
                      updateTimer(
                        index,
                        "escalation_threshold_hours",
                        parseInt(e.target.value) || 1,
                      )
                    }
                    className={`${FIELD_SM} tabular-nums`}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The uncontrolled caller (the edit form) posts through this. */}
      <input type="hidden" name="sla_timers_json" value={JSON.stringify(timers)} />
    </div>
  );
}
