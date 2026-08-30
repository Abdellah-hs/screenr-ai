"use client";

import { useEffect, useMemo, useState } from "react";
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
    <section className="rounded-xl border border-[#E5E7EB] bg-white p-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3.5">
        <div className="min-w-0">
          <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
            Share on social
          </h2>
          <p className="text-[13px] text-[#6B7280]">
            Drafted from the role description. Nothing posts until you press post.
          </p>
        </div>

      </div>

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-[#6B7280]" htmlFor="social-tone">
          Tone
        </label>
        <select
          id="social-tone"
          value={tone}
          onChange={(e) => setTone(e.target.value as SocialPostTone)}
          className="cursor-pointer rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 text-[13px] text-ink outline-none transition-colors duration-150 focus:border-primary focus:outline-[3px] focus:outline-primary/20"
        >
          {SOCIAL_POST_TONES.map((t) => (
            <option key={t} value={t}>
              {toneLabel(t)}
            </option>
          ))}
        </select>

        {/* Secondary, not primary: drafting is a helper. The commitment is the
            post button below, and that one is ink. */}
        <button
          type="button"
          onClick={generate}
          disabled={loading || !canGenerate}
          title={!canGenerate ? "Add a title and description first" : undefined}
          className="ml-auto inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-[#D1D5DB] bg-white px-3 text-[13px] font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {/* "Draft posts", not "Draft from the role": the screening-questions
              card on the same page has a button by that name which drafts
              something else entirely. Two identical buttons doing two different
              things is a coin toss, not a choice. */}
          {loading ? "Drafting…" : posts ? "Redraft" : "Draft posts"}
        </button>
      </div>

      {error && <p className="mb-3 text-xs text-[#DC2626]">{error}</p>}

      {posts && (
        <div className="overflow-hidden rounded-lg border border-[#E5E7EB]">
          {/* The rail says a model wrote what is inside the box, and the caption
              says what that obliges you to do about it: nothing. */}
          <div className="flex flex-wrap items-center gap-2 border-l-[3px] border-ai bg-ai-wash px-3.5 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ai-deep">
              AI draft
            </span>
            <span className="h-3 w-px bg-ai-line" aria-hidden="true" />
            <span className="text-xs text-[#6B7280]">
              Edit freely — this is a starting point, not a suggestion you have to
              accept
            </span>
          </div>

          <div className="flex flex-wrap gap-1 border-t border-[#F3F4F6] bg-white px-3.5 pt-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setActive(p.key);
                  setPublishState(null);
                }}
                className={cn(
                  "-mb-px cursor-pointer border-b-2 px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none",
                  active === p.key
                    ? "border-ink text-ink"
                    : "border-transparent text-[#6B7280] hover:text-ink",
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
            aria-label="Post text"
            className="block w-full resize-y border-0 border-t border-[#F3F4F6] bg-white px-3.5 py-3.5 text-[13px] leading-[1.6] text-ink outline-none"
          />

          <div className="flex flex-wrap items-center gap-2.5 border-t border-[#F3F4F6] bg-[#F9FAFB] px-3.5 py-3">
            {isLinkedIn && linkedInConnected && (
              <button
                type="button"
                onClick={publishLinkedIn}
                disabled={publishing || overLimit || activeText.trim().length === 0}
                className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-ink bg-ink px-3.5 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-ink-hover focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {publishing ? "Posting…" : "Review and post"}
              </button>
            )}

            <button
              type="button"
              onClick={copyActive}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[#D1D5DB] bg-white px-3.5 text-[13px] font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink"
            >
              {copied ? "Copied" : "Copy text"}
            </button>

            <button
              type="button"
              onClick={generate}
              disabled={loading || !canGenerate}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[#D1D5DB] bg-white px-3.5 text-[13px] font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Redraft
            </button>

            <span
              className={cn(
                "ml-auto text-xs",
                overLimit ? "font-semibold text-[#DC2626]" : "text-[#6B7280]",
              )}
            >
              {overLimit
                ? `${activeText.length}/280 — over the X limit`
                : isX
                  ? `${activeText.length}/280`
                  : "Apply link is appended automatically"}
            </span>
          </div>

          {isLinkedIn && publishState?.kind === "success" && (
            <p className="border-t border-[#F3F4F6] px-3.5 py-2 text-xs font-semibold text-[#15803D]">
              Posted to LinkedIn.
            </p>
          )}
          {isLinkedIn && publishState?.kind === "error" && (
            <p className="border-t border-[#F3F4F6] px-3.5 py-2 text-xs text-[#DC2626]">
              {publishState.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
