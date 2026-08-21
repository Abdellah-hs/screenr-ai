"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getCampaignById, updateCampaign } from "@/lib/actions/campaigns";
import { CAMPAIGN_STATUS_SELECTIONS, type Campaign } from "@/lib/constants";
import { encodeStatusSelection } from "@/lib/rules/campaign-status";
import { DescriptionField } from "@/components/campaigns/description-field";
import RubricEditor from "@/components/campaigns/rubric-editor";
import AiSettingsFields from "@/components/campaigns/ai-settings-fields";
import SlaTimersEditor from "@/components/campaigns/sla-timers-editor";
import InterviewAvailabilityEditor from "@/components/campaigns/interview-availability-editor";

/** Today's date as YYYY-MM-DD in the user's local timezone, for a date input's
 *  `min` so a deadline can't be moved into the past. */
function todayLocalYmd(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { id } = await params;
      const data = await getCampaignById(id);
      if (!data) {
        router.replace("/campaigns");
        return;
      }
      setCampaign(data);
      setLoading(false);
    }
    load();
  }, [params, router]);

  // onSubmit + preventDefault, not the form `action` prop: React 19 auto-resets
  // an uncontrolled form when its action resolves, and our catch makes the
  // action always resolve — which would discard the recruiter's unsaved edits
  // on a failed save. preventDefault preserves them; native `required` still runs.
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!campaign) return;
    setError(null);
    setSaving(true);

    const formData = new FormData(e.currentTarget);
    try {
      await updateCampaign(campaign.id, formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSaving(false);
    }
  }

  if (loading || !campaign) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-baseline gap-2 text-sm text-[#6B7280] mb-6">
        <Link href="/campaigns" className="hover:text-[#111827] transition-colors">
          Campaigns
        </Link>
        <span>/</span>
        <Link href={`/campaigns/${campaign.id}`} className="hover:text-[#111827] transition-colors">
          {campaign.title}
        </Link>
        <span>/</span>
        <span className="text-[#111827]">Edit</span>
      </div>

      <h1 className="text-2xl font-semibold text-[#111827] mb-6">Edit Campaign</h1>

      <form onSubmit={handleSubmit} className="space-y-5 bg-white p-6 rounded-xl border border-[#E5E7EB]">
        {error && (
          <div className="p-3 text-sm text-[#DC2626] bg-[#FEF2F2] rounded-lg border border-[#FECACA]">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="title" className="block text-sm font-medium text-[#111827] mb-1">
            Title <span className="text-[#DC2626]">*</span>
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            defaultValue={campaign.title}
            className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
          />
        </div>

        <DescriptionField initialValue={campaign.description} />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="department" className="block text-sm font-medium text-[#111827] mb-1">
              Department
            </label>
            <input
              id="department"
              name="department"
              type="text"
              defaultValue={campaign.department ?? ""}
              className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
              placeholder="e.g. Engineering"
            />
          </div>

          <div>
            <label htmlFor="positions" className="block text-sm font-medium text-[#111827] mb-1">
              Open Positions
            </label>
            <input
              id="positions"
              name="positions"
              type="number"
              min={1}
              defaultValue={campaign.positions}
              className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="status" className="block text-sm font-medium text-[#111827] mb-1">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={encodeStatusSelection(campaign.status, campaign.accepting_applications)}
              className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
            >
              {CAMPAIGN_STATUS_SELECTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="deadline" className="block text-sm font-medium text-[#111827] mb-1">
              Deadline
            </label>
            <input
              id="deadline"
              name="deadline"
              type="date"
              min={todayLocalYmd()}
              defaultValue={campaign.deadline ? campaign.deadline.slice(0, 10) : ""}
              className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
            />

            <fieldset className="mt-2">
              <legend className="text-xs font-medium text-[#6B7280] mb-1">After the deadline passes</legend>
              <label className="flex items-center gap-2 text-sm text-[#374151] cursor-pointer">
                <input
                  type="radio"
                  name="deadline_enforced"
                  value="false"
                  defaultChecked={!campaign.deadline_enforced}
                  className="h-4 w-4 border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                />
                Keep accepting (informational only)
              </label>
              <label className="mt-1 flex items-center gap-2 text-sm text-[#374151] cursor-pointer">
                <input
                  type="radio"
                  name="deadline_enforced"
                  value="true"
                  defaultChecked={campaign.deadline_enforced}
                  className="h-4 w-4 border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                />
                Stop accepting applications
              </label>
            </fieldset>
          </div>
        </div>

        <div>
          <label htmlFor="location" className="block text-sm font-medium text-[#111827] mb-1">
            Location
          </label>
          <input
            id="location"
            name="location"
            type="text"
            defaultValue={campaign.location ?? ""}
            className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
            placeholder="e.g. Remote, New York, NY"
          />
        </div>

        <AiSettingsFields
          defaultAutomationMode={campaign.automation_mode}
          defaultResumeThreshold={campaign.resume_threshold}
          defaultScreeningThreshold={campaign.screening_threshold}
          defaultInterviewPersona={campaign.interview_persona}
        />

        {/* Evaluation Rubrics (resume rubric drives CV scoring — issue #65) */}
        <div className="pt-4 border-t border-[#E5E7EB] mt-2">
          <RubricEditor initialRubrics={campaign.rubrics} campaignId={campaign.id} />
        </div>

        {/* Screening questions are managed in place on the campaign page (the
            AI generates them from the saved description), not in this form —
            without this pointer recruiters hunt for them here and give up. */}
        <div className="pt-4 border-t border-[#E5E7EB] mt-2">
          <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider">
            Screening Questions
          </h2>
          <p className="text-xs text-[#6B7280] mt-1">
            Set up and edited on the campaign page, not here.{" "}
            <Link
              href={`/campaigns/${campaign.id}#screening-questions`}
              className="font-medium text-[#2563EB] hover:underline"
            >
              Go to screening questions
            </Link>
          </p>
        </div>

        {/* SLA Timers — initialTimers seeds the editor so an edit-save preserves
            existing timers (updateCampaignTx delete+re-inserts from this form). */}
        <div className="pt-4 border-t border-[#E5E7EB] mt-2">
          <SlaTimersEditor initialTimers={campaign.sla_timers} />
        </div>

        {/* Final Interview Availability (calendar-driven) */}
        <div className="pt-4 border-t border-[#E5E7EB] mt-2">
          <InterviewAvailabilityEditor
            initialSlotMinutes={campaign.interview_slot_minutes}
            initialTimezone={campaign.interview_timezone}
            initialHorizonDays={campaign.interview_booking_horizon_days}
          />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-[#E5E7EB] mt-6">
          <Link
            href={`/campaigns/${campaign.id}`}
            className="px-4 py-2.5 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg hover:bg-[#F9FAFB] hover:text-[#111827] transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
