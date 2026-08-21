"use client";

import { useState } from "react";
import type { CampaignReviewer, ReviewerRole } from "@/lib/constants";
import {
  EDITOR_HEAD_BUTTON,
  EDITOR_TITLE,
  FIELD_SM,
  RemoveButton,
  SelectChevron,
} from "./editor-parts";

interface Props {
  /** Uncontrolled seed. Ignored when `value` is passed. */
  initialReviewers?: CampaignReviewer[];
  /** Controlled mode — required by the wizard, whose steps unmount. */
  value?: CampaignReviewer[];
  onChange?: (reviewers: CampaignReviewer[]) => void;
}

const ROLES: { value: ReviewerRole; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "reviewer", label: "Reviewer" },
  { value: "observer", label: "Observer" },
];

export default function TeamReviewersEditor({
  initialReviewers = [],
  value,
  onChange,
}: Props) {
  const [internal, setInternal] = useState<CampaignReviewer[]>(initialReviewers);
  const reviewers = value ?? internal;

  function setReviewers(next: CampaignReviewer[]) {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  }

  function updateReviewer<K extends keyof CampaignReviewer>(
    index: number,
    field: K,
    next: CampaignReviewer[K],
  ) {
    setReviewers(reviewers.map((r, i) => (i === index ? { ...r, [field]: next } : r)));
  }

  return (
    <div>
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <p className={EDITOR_TITLE}>Team reviewers</p>
        <button
          type="button"
          onClick={() =>
            setReviewers([
              ...reviewers,
              {
                id: crypto.randomUUID(),
                // A placeholder identity: this person has no account yet, which
                // is exactly why the whole editor sits behind a flag.
                user_id: `user-temp-${Date.now()}`,
                name: "",
                email: "",
                avatar_url: null,
                role: "reviewer",
                assigned_at: new Date().toISOString(),
              },
            ])
          }
          className={EDITOR_HEAD_BUTTON}
        >
          Add reviewer
        </button>
      </div>

      {reviewers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] px-4 py-5 text-center text-[13px] text-[#6B7280]">
          Nobody but you. You can add reviewers after the campaign exists.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {reviewers.map((reviewer, index) => (
            <div
              key={reviewer.id}
              className="flex flex-wrap items-center gap-[11px] rounded-lg border border-[#E5E7EB] p-3"
            >
              <input
                type="text"
                placeholder="Full name"
                aria-label="Reviewer name"
                value={reviewer.name}
                onChange={(e) => updateReviewer(index, "name", e.target.value)}
                className={`${FIELD_SM} min-w-0 flex-1`}
              />
              <input
                type="email"
                placeholder="Email address"
                aria-label="Reviewer email"
                value={reviewer.email}
                onChange={(e) => updateReviewer(index, "email", e.target.value)}
                className={`${FIELD_SM} min-w-0 flex-1`}
              />
              <span className="relative w-[140px] shrink-0">
                <select
                  aria-label="Reviewer role"
                  value={reviewer.role}
                  onChange={(e) =>
                    updateReviewer(index, "role", e.target.value as ReviewerRole)
                  }
                  className={`${FIELD_SM} cursor-pointer appearance-none pr-[30px]`}
                >
                  {ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <SelectChevron />
              </span>
              <RemoveButton
                label={`Remove ${reviewer.name || "reviewer"}`}
                onClick={() => setReviewers(reviewers.filter((_, i) => i !== index))}
              />
            </div>
          ))}
        </div>
      )}

      {/* The uncontrolled caller posts through this. */}
      <input type="hidden" name="reviewers_json" value={JSON.stringify(reviewers)} />
    </div>
  );
}
