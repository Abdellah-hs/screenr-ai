"use client";

import { useEffect, useState } from "react";
import type { ApplyGateBlocker } from "@/lib/rules/campaign-status";

interface CampaignApplyLinkProps {
  slug: string;
  /** Which intake gate is shut, or null when the link is genuinely live.
   *  Not a boolean and not the status: "Active" covers both a campaign taking
   *  CVs and one turning them away, so the card has to name the gate the
   *  recruiter must reopen. */
  blocker: ApplyGateBlocker | null;
  /** Applications received through this link in the last 7 days — the only
   *  evidence on the page that sharing it did anything. */
  recentApplications?: number;
}

/**
 * What a shut gate means and how to reopen it. One sentence each, because the
 * three are not the same problem: two are a status change and one is a date.
 */
const BLOCKER_NOTE: Record<ApplyGateBlocker, string> = {
  not_active:
    "This campaign isn't Active, so the link turns candidates away. Set it to “Active — accepting applications” to open it.",
  intake_closed:
    "This campaign is Active but closed to new applications, so the link turns candidates away. Switch it to “Active — accepting applications” to reopen it.",
  deadline_passed:
    "The deadline has passed and it is enforced, so the link turns candidates away. Extend the deadline, or stop enforcing it, to reopen the link.",
};

/**
 * Recruiter-facing card that surfaces a campaign's public apply link
 * (`/apply/<slug>`) with a one-click copy. The full origin is resolved on the
 * client after mount, so the first render matches the server (no hydration
 * mismatch) and the copied value is an absolute, shareable URL.
 */
export function CampaignApplyLink({
  slug,
  blocker,
  recentApplications,
}: CampaignApplyLinkProps) {
  const path = `/apply/${slug}`;
  const [url, setUrl] = useState(path);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}${path}`);
  }, [path]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure context / permissions) — leave the URL
      // visible so the recruiter can select and copy it manually.
    }
  }

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
        Public apply link
      </h2>
      <p className="mb-3.5 text-[13px] leading-[1.55] text-[#6B7280]">
        {blocker
          ? "This link is live but closed — anyone opening it is told applications are closed."
          : "Applicants flow straight into this campaign’s pipeline."}
      </p>

      <div className="flex gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5 font-mono text-xs text-[#334155]">
          {url}
        </code>
        {/* Square, ink, icon-only: in a rail this narrow a labelled button eats
            the URL it exists to copy. */}
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Apply link copied" : "Copy apply link"}
          className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-ink bg-ink text-white transition-colors duration-150 hover:bg-ink-hover focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2"
        >
          {copied ? (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      </div>

      {recentApplications !== undefined && !blocker && (
        <p className="mt-3 text-xs text-[#6B7280]">
          {recentApplications === 0
            ? "No applications through this link in the last 7 days."
            : `${recentApplications} application${
                recentApplications === 1 ? "" : "s"
              } through this link in the last 7 days.`}
        </p>
      )}

      {blocker && (
        <p className="mt-3 text-xs text-[#92400E]">{BLOCKER_NOTE[blocker]}</p>
      )}
    </div>
  );
}
