"use client";

import { useState } from "react";
import { createCampaign } from "@/lib/actions/campaigns";

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
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-6">New Campaign</h1>

      <form action={handleSubmit} className="space-y-5 bg-card p-6 rounded-xl border border-border">
        {error && (
          <div className="p-3 text-sm text-red-400 bg-red-400/10 rounded-lg border border-red-400/20">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="title" className="block text-sm font-medium text-foreground mb-1">
            Title <span className="text-red-400">*</span>
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="e.g. Senior Frontend Engineer"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-foreground mb-1">
            Description <span className="text-red-400">*</span>
          </label>
          <textarea
            id="description"
            name="description"
            required
            rows={4}
            className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-y"
            placeholder="Describe the role and requirements..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="department" className="block text-sm font-medium text-foreground mb-1">
              Department
            </label>
            <input
              id="department"
              name="department"
              type="text"
              className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="e.g. Engineering"
            />
          </div>

          <div>
            <label htmlFor="positions" className="block text-sm font-medium text-foreground mb-1">
              Open Positions
            </label>
            <input
              id="positions"
              name="positions"
              type="number"
              min={1}
              defaultValue={1}
              className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="status" className="block text-sm font-medium text-foreground mb-1">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue="draft"
              className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <div>
            <label htmlFor="deadline" className="block text-sm font-medium text-foreground mb-1">
              Deadline
            </label>
            <input
              id="deadline"
              name="deadline"
              type="date"
              className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
        </div>

        <div>
          <label htmlFor="location" className="block text-sm font-medium text-foreground mb-1">
            Location
          </label>
          <input
            id="location"
            name="location"
            type="text"
            className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="e.g. Remote, New York, NY"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <a
            href="/campaigns"
            className="px-4 py-2.5 text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating..." : "Create Campaign"}
          </button>
        </div>
      </form>
    </div>
  );
}
