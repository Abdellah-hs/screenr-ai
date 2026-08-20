import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The indigo rail — the one idea of this design system made physical.
 *
 * Every number in this product is an opinion held by a model, and the rail is
 * how the interface says so without a sparkle icon or the word "AI ✨". It is a
 * 3px edge and a pale wash, never a fill and never a button, so it can sit
 * against a stage badge (which IS a fill) without the two competing.
 *
 * Wrap the whole score, not just its header. A score and its "why" are one
 * object: you should not be able to read the figure without seeing whose
 * opinion it is.
 *
 * Known collision, and how it is held apart: stage purple `#7C3AED` sits close
 * to AI indigo `#4F46E5`. Stage colour only ever appears as a small tinted
 * badge; indigo only ever appears as a rail or a caption. They never occupy the
 * same shape, so proximity in hue never becomes ambiguity in meaning.
 */
export function AiRail({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex overflow-hidden rounded-xl border border-border bg-card shadow-sm",
        className
      )}
    >
      <div aria-hidden className="w-[3px] flex-none bg-ai" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * The smallest unit of attribution: what produced this, under which rubric,
 * and the reminder that it decided nothing.
 *
 * `fallibility` is not decoration. A recruiter reading a 61 needs to know in
 * the same glance that a model wrote it and that the model has not moved
 * anybody — otherwise the number reads as a result rather than as evidence.
 * Keep it on any surface where a score is the main thing being read.
 */
export function AiCaption({
  model,
  rubricVersion,
  at,
  fallibility = false,
  children,
  className,
}: {
  /** e.g. `gpt-4o` — the model version stored on the audit row. */
  model?: string | null;
  /** Rubric the score was computed against; an old score is never silently
   *  compared to a new one, so the version travels with the number. */
  rubricVersion?: number | string | null;
  /** Human-readable timestamp. */
  at?: string | null;
  /** Show the longer "it can be wrong, and it moved nobody" line. */
  fallibility?: boolean;
  /** Evidence links — transcript, parsed CV, audit entry. */
  children?: ReactNode;
  className?: string;
}) {
  const provenance = [
    model,
    rubricVersion != null ? `rubric v${rubricVersion}` : null,
    at,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-ai-wash px-6 py-3.5",
        className
      )}
    >
      <span className="max-w-[46ch] text-xs leading-relaxed text-[#6B7280]">
        {fallibility && (
          <>An AI wrote this. It can be wrong, and it has moved nobody. </>
        )}
        {provenance && (
          <strong className="font-semibold text-ai-deep">{provenance}</strong>
        )}
        {!provenance && !fallibility && "Advisory only."}
      </span>
      {children && (
        <span className="flex gap-3.5 text-[13px] font-semibold">{children}</span>
      )}
    </div>
  );
}

/**
 * The eyebrow that opens an AI-produced section, e.g. "Voice screening · AI
 * assessment". Uppercase, indigo, and small — it labels the section without
 * taking the visual weight that belongs to the score itself.
 */
export function AiEyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[7px] text-[11px] font-semibold uppercase tracking-[0.06em] text-ai-deep",
        className
      )}
    >
      {children}
    </span>
  );
}
