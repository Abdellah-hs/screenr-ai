import type { MouseEventHandler, ReactNode } from "react";
import Link from "next/link";
import type { RailStage } from "@/lib/campaigns/wizard";

/**
 * The chrome both `(focus)` screens wear: the brand row, the close control, the
 * step rail and its numbered discs.
 *
 * It lives in one file because the wizard and the share page are one flow — the
 * share page IS the wizard's last stage — and the last screen of a flow arriving
 * as a visibly different product is the divergence a user is guaranteed to
 * notice and a maintainer editing only the wizard is guaranteed to miss.
 */

/**
 * The numbered disc on the step rail.
 *
 * The rail outlives the form: the share stage that follows a successful create
 * draws it with every form step done, and a second copy of this would be a
 * second place for "done" to stop looking like done.
 */
export type StepMarkPosition = "current" | "past" | "ahead";

/** A finished step is an emerald check — the one place emerald belongs in the
 *  wizard, because "done" is a terminal outcome. */
export function StepMark({
  index,
  position,
}: {
  index: number;
  position: StepMarkPosition;
}) {
  const base =
    "flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full text-xs font-bold";

  if (position === "current") {
    return <span className={`${base} bg-ink text-white`}>{index + 1}</span>;
  }

  if (position === "past") {
    return (
      <span className={`${base} border border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]`}>
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
        <span className="sr-only">Done</span>
      </span>
    );
  }

  return (
    <span className={`${base} border border-[#E5E7EB] bg-[#F3F4F6] text-[#9CA3AF]`}>
      {index + 1}
    </span>
  );
}

/**
 * The `(focus)` brand row: the product's mark, hard against the left edge where
 * the sidebar's would be, with the caller's own controls in the right-hand slot.
 *
 * It is the PRODUCT's name, not the page's — "New campaign" standing here made
 * the app look as though that were what it was called, so the task name is the
 * eyebrow over the step instead, which is where page context belongs. Full page
 * width, but no bar: placement without a frame.
 *
 * Shared with the share page because that page is the END of the wizard's flow,
 * and the last screen of a flow arriving as a visibly different product is the
 * one divergence a user is guaranteed to notice — while whoever edits only the
 * wizard is guaranteed to miss it.
 */
export function WizardBrandHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex items-center gap-4 px-8 pt-7">
      <div className="flex min-w-0 items-center gap-[11px]">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-primary font-heading text-[17px] font-bold text-white">
          S
        </span>
        <span className="font-heading text-[17px] font-semibold tracking-[-0.01em]">
          Screenr AI
        </span>
      </div>

      {children && <div className="ml-auto flex flex-none items-center gap-2">{children}</div>}
    </header>
  );
}

/** The close control both `(focus)` screens wear, top right. */
export function WizardCloseLink({
  href,
  label,
  onClick,
}: {
  href: string;
  label: string;
  /** Takes the event: the wizard's handler calls `preventDefault` on a dirty draft. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={label}
      className="flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-[#6B7280] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink"
    >
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
      </svg>
    </Link>
  );
}

/**
 * The step rail's scaffolding — the list, the equal-width cells and the hairline
 * between them.
 *
 * The caller renders each cell, because the two rails genuinely differ there and
 * only there: the wizard's steps are buttons you can go back to, and the share
 * page's are static, since there is nothing left to change and the campaign is
 * saved either way. Everything around them — which is all of the geometry —
 * is one definition.
 */
export function WizardRail({
  stages,
  children,
}: {
  stages: RailStage[];
  /** Renders one cell. `index` is what `StepMark` numbers itself from. */
  children: (stage: RailStage, index: number) => ReactNode;
}) {
  return (
    <nav aria-label="Wizard steps" className="overflow-x-auto">
      <ol className="flex items-center gap-1.5 py-1">
        {stages.map((stage, i) => (
          <li key={stage.key} className="flex flex-1 items-center gap-1.5">
            {children(stage, i)}
            {i < stages.length - 1 && (
              <span className="h-px w-3 flex-none bg-[#E5E7EB]" aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
