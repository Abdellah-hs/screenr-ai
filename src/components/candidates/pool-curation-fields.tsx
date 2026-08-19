"use client";

import { useState, type KeyboardEvent } from "react";
import { MAX_POOL_NOTES_LENGTH, MAX_POOL_TAGS, MAX_POOL_TAG_LENGTH } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * The tags + note pair, shared by every place a pool entry is curated: the
 * candidate page, the pool list, and the rejection prompt.
 *
 * One component rather than three copies because the constraints (tag ceiling,
 * length, dedupe) have to agree with the Zod schema everywhere, and three
 * copies is how one of them quietly stops agreeing.
 */

interface PoolCurationFieldsProps {
  tags: string[];
  notes: string;
  onTagsChange: (tags: string[]) => void;
  onNotesChange: (notes: string) => void;
  /** Tags already used elsewhere in the pool, offered as one-click suggestions. */
  suggestions?: string[];
  disabled?: boolean;
  notesPlaceholder?: string;
}

export function PoolCurationFields({
  tags,
  notes,
  onTagsChange,
  onNotesChange,
  suggestions = [],
  disabled = false,
  notesPlaceholder = "e.g. Strong systems thinking — revisit when the platform role opens.",
}: PoolCurationFieldsProps) {
  const [draft, setDraft] = useState("");

  const atLimit = tags.length >= MAX_POOL_TAGS;

  function addTag(raw: string) {
    const value = raw.trim().slice(0, MAX_POOL_TAG_LENGTH);
    if (!value || atLimit) return;
    // Case-insensitive, matching `normalizePoolTags` on the server — otherwise
    // the UI would show "React" and "react" as two tags and the server would
    // silently save one.
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onTagsChange([...tags, value]);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Enter and comma both commit, because both are what people actually type
    // into a tag field. Enter must not submit the surrounding form.
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(draft);
      return;
    }
    if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      onTagsChange(tags.slice(0, -1));
    }
  }

  const unusedSuggestions = suggestions
    .filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()))
    .slice(0, 8);

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="pool-tag-input"
          className="mb-1.5 block text-sm font-medium text-[#111827]"
        >
          Tags{" "}
          <span className="font-normal text-[#9CA3AF]">
            ({tags.length}/{MAX_POOL_TAGS})
          </span>
        </label>

        <div
          className={cn(
            "flex flex-wrap items-center gap-1.5 rounded-lg border bg-white px-2 py-1.5 transition-colors",
            disabled ? "border-[#E5E7EB] bg-[#F9FAFB]" : "border-[#D1D5DB]",
            "focus-within:border-[#2563EB] focus-within:ring-2 focus-within:ring-[#2563EB]/20",
          )}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md bg-[#EFF6FF] px-2 py-0.5 text-xs font-medium text-[#1D4ED8]"
            >
              {tag}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onTagsChange(tags.filter((t) => t !== tag))}
                aria-label={`Remove tag ${tag}`}
                className="cursor-pointer rounded text-[#60A5FA] transition-colors hover:text-[#1D4ED8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:cursor-default"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}

          <input
            id="pool-tag-input"
            type="text"
            value={draft}
            disabled={disabled || atLimit}
            maxLength={MAX_POOL_TAG_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => addTag(draft)}
            placeholder={atLimit ? "Tag limit reached" : "Add a tag, then press Enter"}
            className="min-w-[10rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none disabled:cursor-default"
          />
        </div>

        {unusedSuggestions.length > 0 && !disabled && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[#9CA3AF]">Used before:</span>
            {unusedSuggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addTag(s)}
                disabled={atLimit}
                className="cursor-pointer rounded-md border border-[#E5E7EB] bg-white px-2 py-0.5 text-xs text-[#6B7280] transition-colors hover:border-[#BFDBFE] hover:bg-[#EFF6FF] hover:text-[#1D4ED8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] disabled:cursor-default disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label
          htmlFor="pool-notes-input"
          className="mb-1.5 block text-sm font-medium text-[#111827]"
        >
          Note <span className="font-normal text-[#9CA3AF]">(optional)</span>
        </label>
        <textarea
          id="pool-notes-input"
          rows={3}
          value={notes}
          disabled={disabled}
          maxLength={MAX_POOL_NOTES_LENGTH}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder={notesPlaceholder}
          className="w-full resize-y rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#111827] placeholder:text-[#9CA3AF] transition-colors focus-visible:border-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20 disabled:bg-[#F9FAFB]"
        />
        <p className="mt-1 text-xs text-[#9CA3AF]">
          Why they are worth revisiting. Only you see this.
        </p>
      </div>
    </div>
  );
}
