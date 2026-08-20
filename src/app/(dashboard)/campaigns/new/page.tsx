"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { createCampaign } from "@/lib/actions/campaigns";
import {
  CAMPAIGN_STATUS_SELECTIONS,
  type CampaignStatusSelection,
  type SlaTimer,
} from "@/lib/constants";
import { DescriptionField } from "@/components/campaigns/description-field";
import RubricEditor from "@/components/campaigns/rubric-editor";
import AiSettingsFields, {
  type AiSettings,
} from "@/components/campaigns/ai-settings-fields";
import SlaTimersEditor from "@/components/campaigns/sla-timers-editor";
import TeamReviewersEditor from "@/components/campaigns/team-reviewers-editor";
import { isTeamReviewersEnabled } from "@/lib/flags";
import InterviewAvailabilityEditor from "@/components/campaigns/interview-availability-editor";
import { CampaignRunPreview } from "@/components/campaigns/campaign-run-preview";

/** Today's date as YYYY-MM-DD in the user's local timezone, for a date input's
 *  `min` so a deadline can't be set in the past. */
function todayLocalYmd(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

const fieldClass =
  "w-full px-4 py-2 bg-white border border-[#D1D5DB] rounded-lg text-sm text-ink placeholder-[#9CA3AF] outline-none transition-colors duration-150 focus:border-primary focus:outline-[3px] focus:outline-primary/20";

export default function NewCampaignPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Mirrored from the form so the preview can say what these settings will
  // actually run. The form itself stays uncontrolled — this is a read of the
  // handful of values that change the pipeline's shape, not a second copy of
  // every input.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<CampaignStatusSelection>("draft");
  const [ai, setAi] = useState<AiSettings>({
    automationMode: "human_in_loop",
    screeningThreshold: 70,
    interviewPersona: "neutral",
  });
  const [resumeDimensions, setResumeDimensions] = useState(0);
  const [slaTimers, setSlaTimers] = useState<SlaTimer[]>([]);
  const [slotMinutes, setSlotMinutes] = useState(45);
  const [horizonDays, setHorizonDays] = useState(14);

  // Use onSubmit + preventDefault rather than the form `action` prop: React 19
  // auto-resets an uncontrolled form once its action resolves, and since we
  // catch validation errors here the action always "resolves" — which would
  // wipe everything the recruiter typed on a failed submit. preventDefault
  // keeps the entered values intact while native `required` checks still run.
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    try {
      await createCampaign(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex items-baseline gap-2 text-sm text-[#6B7280]">
        <Link href="/campaigns" className="transition-colors duration-150 hover:text-ink">
          Campaigns
        </Link>
        <span>/</span>
        <span className="text-ink">New campaign</span>
      </div>

      <header className="mb-8 max-w-3xl">
        <h1 className="text-2xl font-semibold text-ink">New campaign</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[#6B7280]">
          A campaign is one open role and everything the pipeline needs to run it:
          the description candidates read, the rubric the AI scores against, who
          reviews, and how long each stage may take.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <form
          onSubmit={handleSubmit}
          className="space-y-4 min-w-0 lg:col-span-2"
          id="new-campaign-form"
        >
          {error && (
            <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-[#DC2626]">
              {error}
            </div>
          )}

          <Section
            index="01"
            title="The role"
            hint="Candidates see everything in this section"
          >
            <div>
              <label
                htmlFor="title"
                className="mb-1 block text-sm font-medium text-ink"
              >
                Title <span className="text-[#DC2626]">*</span>
              </label>
              <input
                id="title"
                name="title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={fieldClass}
                placeholder="e.g. Senior Frontend Engineer"
              />
            </div>

            <DescriptionField onChange={setDescription} />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="department"
                  className="mb-1 block text-sm font-medium text-ink"
                >
                  Department
                </label>
                <input
                  id="department"
                  name="department"
                  type="text"
                  className={fieldClass}
                  placeholder="e.g. Engineering"
                />
              </div>

              <div>
                <label
                  htmlFor="positions"
                  className="mb-1 block text-sm font-medium text-ink"
                >
                  Open positions
                </label>
                <input
                  id="positions"
                  name="positions"
                  type="number"
                  min={1}
                  defaultValue={1}
                  className={fieldClass}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="location"
                className="mb-1 block text-sm font-medium text-ink"
              >
                Location
              </label>
              <input
                id="location"
                name="location"
                type="text"
                className={fieldClass}
                placeholder="e.g. Remote, New York, NY"
              />
            </div>
          </Section>

          <Section
            index="02"
            title="Status and deadline"
            hint="Controls whether the apply link accepts anyone"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="status"
                  className="mb-1 block text-sm font-medium text-ink"
                >
                  Status
                </label>
                <select
                  id="status"
                  name="status"
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as CampaignStatusSelection)
                  }
                  className={fieldClass}
                >
                  {CAMPAIGN_STATUS_SELECTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[#6B7280]">
                  Draft keeps the apply link dark. Nothing is scored and nobody is
                  contacted until you set it Active.
                </p>
              </div>

              <div>
                <label
                  htmlFor="deadline"
                  className="mb-1 block text-sm font-medium text-ink"
                >
                  Deadline
                </label>
                <input
                  id="deadline"
                  name="deadline"
                  type="date"
                  min={todayLocalYmd()}
                  suppressHydrationWarning
                  className={fieldClass}
                />

                <fieldset className="mt-2">
                  <legend className="mb-1 text-xs font-medium text-[#6B7280]">
                    After the deadline passes
                  </legend>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-[#374151]">
                    <input
                      type="radio"
                      name="deadline_enforced"
                      value="false"
                      defaultChecked
                      className="h-4 w-4 cursor-pointer accent-ink"
                    />
                    Keep accepting (informational only)
                  </label>
                  <label className="mt-1 flex cursor-pointer items-center gap-2 text-sm text-[#374151]">
                    <input
                      type="radio"
                      name="deadline_enforced"
                      value="true"
                      className="h-4 w-4 cursor-pointer accent-ink"
                    />
                    Stop accepting applications
                  </label>
                </fieldset>
              </div>
            </div>
          </Section>

          <Section index="03" title="How much the AI may do alone">
            <AiSettingsFields onChange={setAi} />
          </Section>

          <Section index="04" title="Evaluation rubrics">
            <RubricEditor onResumeDimensionsChange={setResumeDimensions} />
          </Section>

          {/* Team Reviewers — behind NEXT_PUBLIC_ENABLE_TEAM_REVIEWERS, default off.
              The section is omitted entirely rather than disabled: a greyed-out
              editor would advertise a capability that does not exist yet. */}
          {isTeamReviewersEnabled() && (
            <Section index="05" title="Who reviews">
              <TeamReviewersEditor />
            </Section>
          )}

          <Section
            index={isTeamReviewersEnabled() ? "06" : "05"}
            title="SLA timers"
            hint="Timers only alert a person — they never advance and never reject"
          >
            <SlaTimersEditor onChange={setSlaTimers} />
          </Section>

          <Section
            index={isTeamReviewersEnabled() ? "07" : "06"}
            title="Final interview availability"
          >
            <InterviewAvailabilityEditor
              onChange={(next) => {
                setSlotMinutes(next.slotMinutes);
                setHorizonDays(next.horizonDays);
              }}
            />
          </Section>

          <div className="flex flex-wrap items-center justify-end gap-3 rounded-xl border border-[#E5E7EB] bg-white p-5">
            <p className="mr-auto text-xs text-[#6B7280]">
              Creating saves the campaign only. Nothing is sent, scored or published
              until the status is Active.
            </p>
            <Link href="/campaigns" className="btn-secondary text-sm">
              Cancel
            </Link>
            <button type="submit" disabled={loading} className="btn-primary text-sm">
              {loading ? "Creating…" : "Create campaign"}
            </button>
          </div>
        </form>

        <CampaignRunPreview
          config={{
            status,
            automationMode: ai.automationMode,
            screeningThreshold: ai.screeningThreshold,
            resumeDimensions,
            interviewPersona: ai.interviewPersona,
            slaTimers,
            slotMinutes,
            horizonDays,
          }}
          preflight={[
            { label: "Title", done: title.trim().length > 0 },
            { label: "Description", done: description.trim().length >= 10 },
            {
              label:
                resumeDimensions > 0
                  ? `Resume rubric · ${resumeDimensions} ${
                      resumeDimensions === 1 ? "dimension" : "dimensions"
                    }`
                  : "Resume rubric · no dimensions yet",
              done: resumeDimensions > 0,
            },
          ]}
        />
      </div>
    </div>
  );
}

/**
 * A numbered step with a one-line statement of what it decides.
 *
 * The form was one card of stacked fields, which gave a recruiter no way to
 * tell which answers were consequential and which were labels. The hint is the
 * point of the number.
 */
function Section({
  index,
  title,
  hint,
  children,
}: {
  index: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#E5E7EB] bg-white p-6">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="text-xs font-semibold tabular-nums text-[#9CA3AF]">
          {index}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">
            {title}
          </h2>
          {hint && <p className="mt-0.5 text-xs text-[#6B7280]">{hint}</p>}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
