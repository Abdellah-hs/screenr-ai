/**
 * Shared shapes for the candidate file.
 *
 * Nothing on this page is pinned any more — the identity band scrolls with the
 * evidence — so the sticky offsets that used to live here are gone with it.
 * What is left is the clearance an anchored panel needs and the one button
 * style the decision bar is allowed.
 */

/** Enough air that an anchored decision panel is not flush against the chrome. */
export const SECTION_SCROLL_MARGIN = "scroll-mt-6";

/**
 * The one ink button allowed in the decision bar.
 *
 * Ink means a person is about to change someone's state, so it appears only
 * where a decision is genuinely owed — a human-in-the-loop gate or a manager's
 * review. Every other action beside it is an outline: helpers, not commitments.
 */
export const BAR_ACTION_PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg " +
  "border border-ink bg-ink px-[18px] text-sm font-semibold text-white " +
  "transition-colors duration-150 hover:bg-ink-hover " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2";
