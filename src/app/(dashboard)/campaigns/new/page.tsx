"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createCampaign } from "@/lib/actions/campaigns";
import { CAMPAIGN_STATUS_SELECTIONS } from "@/lib/constants";

/** Today's date as YYYY-MM-DD in the user's local timezone, for a date input's
 *  `min` so a deadline can't be set in the past. */
function todayLocalYmd(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
import { DescriptionField } from "@/components/campaigns/description-field";
import RubricEditor from "@/components/campaigns/rubric-editor";
import AiSettingsFields from "@/components/campaigns/ai-settings-fields";
import SlaTimersEditor from "@/components/campaigns/sla-timers-editor";
import TeamReviewersEditor from "@/components/campaigns/team-reviewers-editor";
import InterviewAvailabilityEditor from "@/components/campaigns/interview-availability-editor";

export default function NewCampaignPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-[#111827] mb-6">New Campaign</h1>

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
            className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
            placeholder="e.g. Senior Frontend Engineer"
          />
        </div>

        <DescriptionField />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="department" className="block text-sm font-medium text-[#111827] mb-1">
              Department
            </label>
            <input
              id="department"
              name="department"
              type="text"
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
              defaultValue={1}
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
              defaultValue="draft"
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
              suppressHydrationWarning
              className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
            />

            <fieldset className="mt-2">
              <legend className="text-xs font-medium text-[#6B7280] mb-1">After the deadline passes</legend>
              <label className="flex items-center gap-2 text-sm text-[#374151] cursor-pointer">
                <input
                  type="radio"
                  name="deadline_enforced"
                  value="false"
                  defaultChecked
                  className="h-4 w-4 border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                />
                Keep accepting (informational only)
              </label>
              <label className="mt-1 flex items-center gap-2 text-sm text-[#374151] cursor-pointer">
                <input
                  type="radio"
                  name="deadline_enforced"
                  value="true"
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
            className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
            placeholder="e.g. Remote, New York, NY"
          />
        </div>

        <AiSettingsFields />

        {/* Evaluation Rubrics (resume rubric drives CV scoring — issue #65) */}
        <div className="pt-4 border-t border-[#E5E7EB] mt-2">
          <RubricEditor />
        </div>

        {/* Team Reviewers */}
        <div className="pt-4 border-t border-[#E5E7EB] mt-2">
          <TeamReviewersEditor />
        </div>

        {/* SLA Timers */}
        <div className="pt-4 border-t border-[#E5E7EB] mt-2">
          <SlaTimersEditor />
        </div>

        {/* AI Interview Availability */}
        <div className="pt-4 border-t border-[#E5E7EB] mt-2">
          <InterviewAvailabilityEditor />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-[#E5E7EB] mt-6">
          <Link
            href="/campaigns"
            className="px-4 py-2.5 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg hover:bg-[#F9FAFB] hover:text-[#111827] transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {loading ? "Creating..." : "Create Campaign"}
          </button>
        </div>
      </form>
    </div>
  );
}
