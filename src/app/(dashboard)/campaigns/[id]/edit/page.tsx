"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getCampaignById, updateCampaign } from "@/lib/actions/campaigns";
import type { Campaign } from "@/lib/constants";
import RubricEditor from "@/components/campaigns/rubric-editor";
import AiSettingsFields from "@/components/campaigns/ai-settings-fields";
import InterviewAvailabilityEditor from "@/components/campaigns/interview-availability-editor";

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

  async function handleSubmit(formData: FormData) {
    if (!campaign) return;
    setError(null);
    setSaving(true);

    try {
      await updateCampaign(campaign.id, formData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
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
      <div className="flex items-center gap-2 text-sm text-[#6B7280] mb-6">
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

      <form action={handleSubmit} className="space-y-5 bg-white p-6 rounded-xl border border-[#E5E7EB]">
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

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-[#111827] mb-1">
            Description <span className="text-[#DC2626]">*</span>
          </label>
          <textarea
            id="description"
            name="description"
            required
            rows={4}
            defaultValue={campaign.description}
            className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors resize-y"
          />
        </div>

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
              defaultValue={campaign.status}
              className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="closed">Closed</option>
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
              defaultValue={campaign.deadline ?? ""}
              className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
            />
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

        <div>
          <label htmlFor="application_email" className="block text-sm font-medium text-[#111827] mb-1">
            Application email
          </label>
          <input
            id="application_email"
            name="application_email"
            type="email"
            defaultValue={campaign.application_email ?? ""}
            className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
            placeholder="e.g. careers+eng@yourcompany.com"
          />
          <p className="text-xs text-[#6B7280] mt-1">
            The address applicants send CVs to — typically a plus-alias of your connected inbox.
            Gmail sync only pulls resumes sent to this address.
          </p>
        </div>

        <AiSettingsFields
          defaultAutomationMode={campaign.automation_mode}
          defaultScreeningThreshold={campaign.screening_threshold}
          defaultInterviewPersona={campaign.interview_persona}
        />

        {/* Evaluation Rubrics (resume rubric drives CV scoring — issue #65) */}
        <div className="pt-4 border-t border-[#E5E7EB] mt-2">
          <RubricEditor initialRubrics={campaign.rubrics} campaignId={campaign.id} />
        </div>

        {/* AI Interview Availability */}
        <div className="pt-4 border-t border-[#E5E7EB] mt-2">
          <InterviewAvailabilityEditor
            initialRules={campaign.interview_availability_rules}
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
