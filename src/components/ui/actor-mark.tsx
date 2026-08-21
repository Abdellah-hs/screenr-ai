import { cn } from "@/lib/utils";

/**
 * Who did this — the mark that must never let a rule and a person look alike.
 *
 * Three actors, three shapes, and the distinction is load-bearing rather than
 * decorative: this product's whole claim is that AI advises, rules fire, and
 * people decide. A history where "scored 61" and "rejected him" wear the same
 * avatar quietly erases that.
 *
 * - **AI** — indigo ring, chip icon. Advisory. Produced a score or a transcript.
 * - **System** — grey ring, gear icon. A rule fired: expiry, SLA, auto-archive.
 * - **Person** — solid ink, initials. Decisive. A named recruiter clicked.
 */
export type Actor = "ai" | "system" | "person";

const SIZE = {
  sm: "h-6 w-6 text-[9px]",
  md: "h-[26px] w-[26px] text-[10px]",
  lg: "h-8 w-8 text-[11px]",
} as const;

const ICON_SIZE = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
} as const;

export function ActorMark({
  actor,
  /** Required for `person` — a named human is the whole point of that variant. */
  initials,
  size = "md",
  className,
}: {
  actor: Actor;
  initials?: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const base = cn(
    "flex shrink-0 items-center justify-center rounded-full font-bold tracking-[0.04em]",
    SIZE[size],
    className,
  );

  if (actor === "person") {
    return (
      <span
        className={cn(base, "bg-ink text-white")}
        title="A person decided this"
        aria-label="Person"
      >
        {/* `application_transitions.actor` records a ROLE, not a user id, so a
            transition can say a recruiter acted but not which one. A generic
            person glyph is the honest fallback — inventing initials from the
            signed-in viewer would attribute someone else's decision to them. */}
        {initials ?? (
          <svg
            className={ICON_SIZE[size]}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.5 7.5 0 0 1 15 0"
            />
          </svg>
        )}
      </span>
    );
  }

  if (actor === "ai") {
    return (
      <span
        className={cn(base, "border border-ai-line bg-[#EEF2FF] text-ai-deep")}
        title="An AI produced this. Advisory."
        aria-label="AI"
      >
        {/* Heroicons cpu-chip — a machine reading, not magic. */}
        <svg
          className={ICON_SIZE[size]}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={cn(base, "border border-[#E5E7EB] bg-[#F3F4F6] text-[#4B5563]")}
      title="A rule fired"
      aria-label="System"
    >
      <svg
        className={ICON_SIZE[size]}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.3 4.3c.4-1.7 2.9-1.7 3.3 0a1.7 1.7 0 0 0 2.6 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 0 0 1 2.5c1.8.5 1.8 3 0 3.4a1.7 1.7 0 0 0-1 2.6c.9 1.5-.9 3.3-2.4 2.3a1.7 1.7 0 0 0-2.6 1.1c-.4 1.7-2.9 1.7-3.3 0a1.7 1.7 0 0 0-2.6-1.1c-1.5 1-3.3-.8-2.4-2.3a1.7 1.7 0 0 0-1-2.6c-1.8-.4-1.8-2.9 0-3.4a1.7 1.7 0 0 0 1-2.5c-.9-1.6.9-3.3 2.4-2.4.9.6 2.2 0 2.5-1.1Z"
        />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </span>
  );
}

/** The `actor` column on `application_transitions` maps straight onto the mark. */
export function actorFromTransition(actor: string): Actor {
  if (actor === "ai") return "ai";
  if (actor === "recruiter") return "person";
  return "system";
}
