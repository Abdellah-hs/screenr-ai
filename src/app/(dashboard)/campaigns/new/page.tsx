"use client";

import { useState } from "react";
import { createCampaign } from "@/lib/actions/campaigns";
import ScreeningCriteriaEditor from "@/components/campaigns/screening-criteria-editor";
import RubricEditor from "@/components/campaigns/rubric-editor";

export default function NewCampaignPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setLoading(true);

    try {
      await createCampaign(formData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-[#111827] mb-6">New Campaign</h1>

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
            className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
            placeholder="e.g. Senior Frontend Engineer"
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
            className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors resize-y"
            placeholder="Describe the role and requirements..."
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
            className="w-full px-4 py-2 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition-colors"
            placeholder="e.g. Remote, New York, NY"
          />
        </div>

        {/* Screening Criteria */}
        <div className="pt-4 border-t border-[#E5E7EB] mt-2">
          <ScreeningCriteriaEditor />
        </div>

        {/* Evaluation Rubrics */}
        <div className="pt-4 border-t border-[#E5E7EB] mt-2">
          <RubricEditor />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-[#E5E7EB] mt-6">
          <a
            href="/campaigns"
            className="px-4 py-2.5 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-lg hover:bg-[#F9FAFB] hover:text-[#111827] transition-colors"
          >
            Cancel
          </a>
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
