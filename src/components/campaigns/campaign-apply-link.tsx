"use client";

import { useEffect, useState } from "react";

interface CampaignApplyLinkProps {
  slug: string;
  /** When the campaign isn't Active, the public page won't accept applications. */
  isActive: boolean;
}

/**
 * Recruiter-facing card that surfaces a campaign's public apply link
 * (`/apply/<slug>`) with a one-click copy. The full origin is resolved on the
 * client after mount, so the first render matches the server (no hydration
 * mismatch) and the copied value is an absolute, shareable URL.
 */
export function CampaignApplyLink({ slug, isActive }: CampaignApplyLinkProps) {
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
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-6">
      <h2 className="text-sm font-semibold text-[#111827] uppercase tracking-wider mb-2">
        Public apply link
      </h2>
      <p className="text-sm text-[#6B7280] mb-4">
        Share this link to let candidates submit their CV directly. New applicants flow into this
        campaign&apos;s pipeline automatically.
      </p>
      <div className="flex flex-col sm:flex-row items-stretch gap-2">
        <code className="flex-1 min-w-0 truncate rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-sm text-[#374151]">
          {url}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#111827] rounded-lg cursor-pointer hover:bg-[#1F2937] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 transition-colors duration-150 whitespace-nowrap"
        >
          {copied ? (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy link
            </>
          )}
        </button>
      </div>
      {!isActive && (
        <p className="mt-3 text-xs text-[#92400E]">
          This campaign isn&apos;t Active, so the link won&apos;t accept applications until you set it
          to Active.
        </p>
      )}
    </div>
  );
}
