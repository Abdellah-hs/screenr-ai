import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Three families, and the shape tells you which one you are reading:
 *
 * - **Stage** and **tier** are pills. They describe what someone *is* right
 *   now — where they sit, and one AI verdict on one stage.
 * - **Severity** and **lifecycle** are rounded rectangles with an icon slot.
 *   They describe an *exception*: something expired, lapsed, or was flagged.
 *
 * Tier badges never combine across stages. There is no composite score in this
 * product, so there is no badge for one.
 *
 * Colour is never the only signal — every variant here is meant to sit beside
 * its own word, and the exception family expects an icon as well.
 *
 * The original six variants (`default` … `info`) are unchanged; campaign status
 * chips across the app depend on them.
 */
const variants = {
  // ── Original set, untouched ────────────────────────────────────────────
  default: "bg-primary/10 text-primary",
  draft: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-700",
  paused: "bg-amber-100 text-amber-700",
  closed: "bg-red-100 text-red-700",
  info: "bg-blue-100 text-blue-700",

  // ── Stage: where a person is ───────────────────────────────────────────
  stageNew: "bg-[#F1F5F9] text-[#475569]",
  stageScreening: "bg-[#EFF6FF] text-[#2563EB]",
  stageInterview: "bg-[#F5F3FF] text-[#7C3AED]",
  stageFinal: "bg-[#FEF3C7] text-[#B45309]",
  stageHired: "bg-[#ECFDF5] text-[#047857]",
  stageRejected: "bg-[#FEF2F2] text-[#DC2626]",
  stageArchived: "bg-[#F3F4F6] text-[#6B7280]",

  // ── Tier: one AI verdict on one stage ──────────────────────────────────
  tierStrong: "bg-[#ECFDF5] border border-[#A7F3D0] text-tier-strong",
  tierPotential: "bg-[#FEF3C7] border border-[#FDE68A] text-tier-potential",
  tierWeak: "bg-[#FEF2F2] border border-[#FECACA] text-tier-weak",
  tierNoMatch: "bg-[#FEE2E2] border border-[#FCA5A5] text-tier-no-match",

  // ── Exception: severity + lifecycle. Rectangles, not pills. ────────────
  warning: "rounded-md bg-[#FFFBEB] border border-[#FDE68A] text-[#B45309]",
  critical: "rounded-md bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626]",
  overdue: "rounded-md bg-[#FEE2E2] border border-[#FCA5A5] text-[#991B1B]",
  lapsed: "rounded-md bg-[#F3F4F6] border border-border text-[#4B5563]",
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof variants;
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
