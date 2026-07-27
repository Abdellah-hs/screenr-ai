"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { generateSocialPosts } from "@/lib/actions/ai-generate";
import { publishLinkedInPost } from "@/lib/actions/social-publish";
import { SOCIAL_POST_TONES } from "@/lib/validations";
import type { SocialPosts, SocialPostTone } from "@/lib/services/openai";
import { cn } from "@/lib/utils";

type Platform = keyof SocialPosts;

const PLATFORMS: { key: Platform; label: string; hint?: string }[] = [
  { key: "linkedin", label: "LinkedIn" },
  { key: "x", label: "X", hint: "280 characters" },
  { key: "facebook", label: "Facebook" },
  { key: "general", label: "General" },
];

function toneLabel(tone: SocialPostTone): string {
  return tone.charAt(0).toUpperCase() + tone.slice(1);
}

/**
 * AI social-post generator for a campaign. Advisory only: it drafts platform-
 * native "we're hiring" copy the recruiter edits and copies to post manually —
 * there is no auto-publishing. The apply link (built from the campaign slug) is
 * woven into the copy so shared posts point straight at the apply page.
 */
export function SocialPostGenerator({
  title,
  description,
  department,
  location,
  slug,
  linkedInConnected = false,
}: {
  title: string;
  description: string;
  department: string | null;
  location: string | null;
  slug: string | null;
  /** Whether the recruiter has connected LinkedIn (enables the Publish button). */
  linkedInConnected?: boolean;
}) {
  const [tone, setTone] = useState<SocialPostTone>("professional");
  const [posts, setPosts] = useState<SocialPosts | null>(null);
  const [active, setActive] = useState<Platform>("linkedin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishState, setPublishState] = useState<
    { kind: "success" } | { kind: "error"; message: string } | null
  >(null);

  // Resolve the absolute apply URL on the client, same approach as the apply
  // link card — keeps SSR output stable and produces a shareable URL.
  const [applyUrl, setApplyUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (slug) setApplyUrl(`${window.location.origin}/apply/${slug}`);
  }, [slug]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const activeText = posts ? posts[active] : "";
  const isX = active === "x";
  const isLinkedIn = active === "linkedin";
  const overLimit = isX && activeText.length > 280;

  const canGenerate = useMemo(
    () => description.trim().length > 0 && title.trim().length > 0,
    [description, title],
  );

  async function generate() {
    setError(null);
    setLoading(true);
    try {
      const result = await generateSocialPosts({
        title,
        description,
        department: department ?? undefined,
        location: location ?? undefined,
        applyUrl,
        tone,
      });
      setPosts(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't generate posts. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  function editActive(value: string) {
    setPosts((p) => (p ? { ...p, [active]: value } : p));
    setPublishState(null);
  }

  async function copyActive() {
    try {
      await navigator.clipboard.writeText(activeText);
      setCopied(true);
    } catch {
      // Clipboard blocked — the text stays selectable in the textarea.
    }
  }

  async function publishLinkedIn() {
    setPublishState(null);
    setPublishing(true);
    try {
      await publishLinkedInPost({ text: posts?.linkedin ?? "" });
      setPublishState({ kind: "success" });
    } catch (err) {
      setPublishState({
        kind: "error",
        message: err instanceof Error ? err.message : "Couldn't publish to LinkedIn.",
      });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#111827]">
          Share on social
        </h2>
        <span className="rounded-md bg-[#EFF6FF] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#2563EB]">
          AI draft
        </span>
      </div>
      <p className="mb-4 text-sm text-[#6B7280]">
        Generate a &ldquo;we&rsquo;re hiring&rdquo; post for each channel, edit it, and copy it to
        share. AI only writes the text — it won&apos;t post for you or invent salary or benefits.
      </p>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-[#6B7280]" htmlFor="social-tone">
          Tone
        </label>
        <select
          id="social-tone"
          value={tone}
          onChange={(e) => setTone(e.target.value as SocialPostTone)}
          className="cursor-pointer rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 text-sm text-[#111827] transition-colors focus-visible:border-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20"
        >
          {SOCIAL_POST_TONES.map((t) => (
            <option key={t} value={t}>
              {toneLabel(t)}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={generate}
          disabled={loading || !canGenerate}
          title={!canGenerate ? "Add a title and description first" : undefined}
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]",
            loading || !canGenerate
              ? "cursor-not-allowed bg-[#93C5FD]"
              : "cursor-pointer bg-[#2563EB] hover:bg-[#1D4ED8]",
          )}
        >
          {loading ? "Generating…" : posts ? "Regenerate" : "Generate social posts"}
        </button>
      </div>

      {error && <p className="mb-3 text-xs text-[#DC2626]">{error}</p>}

      {posts && (
        <div>
          {/* Tabs */}
          <div className="mb-3 flex flex-wrap gap-1 border-b border-[#E5E7EB]">
            {PLATFORMS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setActive(p.key);
                  setPublishState(null);
                }}
                className={cn(
                  "-mb-px cursor-pointer border-b-2 px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none",
                  active === p.key
                    ? "border-[#2563EB] text-[#2563EB]"
                    : "border-transparent text-[#6B7280] hover:text-[#111827]",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <textarea
            value={activeText}
            onChange={(e) => editActive(e.target.value)}
            rows={isX ? 4 : 8}
            className="w-full resize-y rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 text-sm leading-relaxed text-[#111827] outline-none transition-colors focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
          />

          <div className="mt-2 flex items-center justify-between">
            <span
              className={cn(
                "text-xs",
                overLimit ? "font-medium text-[#DC2626]" : "text-[#9CA3AF]",
              )}
            >
              {isX ? `${activeText.length}/280` : `${activeText.length} characters`}
              {overLimit && " — over X's limit"}
            </span>
            <div className="flex items-center gap-2">
              {isLinkedIn &&
                (linkedInConnected ? (
                  <button
                    type="button"
                    onClick={publishLinkedIn}
                    disabled={publishing || overLimit || activeText.trim().length === 0}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A66C2]",
                      publishing || overLimit || activeText.trim().length === 0
                        ? "cursor-not-allowed bg-[#93C5FD]"
                        : "cursor-pointer bg-[#0A66C2] hover:bg-[#08509b]",
                    )}
                  >
                    {publishing ? "Publishing…" : "Publish to LinkedIn"}
                  </button>
                ) : (
                  <Link
                    href="/settings"
                    className="text-xs font-medium text-[#0A66C2] hover:underline"
                  >
                    Connect LinkedIn to publish
                  </Link>
                ))}
              <button
                type="button"
                onClick={copyActive}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#D1D5DB] bg-white px-2.5 py-1 text-xs font-medium text-[#374151] transition-colors hover:bg-[#F9FAFB] hover:text-[#111827] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
              >
                {copied ? (
                  <>
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>

          {isLinkedIn && publishState?.kind === "success" && (
            <p className="mt-2 text-xs font-medium text-[#15803D]">Posted to LinkedIn.</p>
          )}
          {isLinkedIn && publishState?.kind === "error" && (
            <p className="mt-2 text-xs text-[#DC2626]">{publishState.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
