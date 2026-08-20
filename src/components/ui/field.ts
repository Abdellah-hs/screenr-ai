/**
 * One definition of what a form field looks like, shared by Input, Textarea
 * and Select — and deliberately identical to `.input` in globals.css, which is
 * what most forms in this app actually use. The two had drifted: the CSS class
 * was solid white with a #D1D5DB border, while the React primitives were
 * `bg-white/70 backdrop-blur-md` with a #E5E7EB border and a focus shadow in a
 * blue (#1E40AF) that is not the primary.
 *
 * The glass is the part that mattered. A translucent, blurred field samples
 * whatever sits behind it, so the contrast of the text a recruiter is typing
 * depends on the page underneath it. On the candidate apply form that is the
 * first thing an applicant touches. Fields are solid now.
 */
export const FIELD_BASE =
  "w-full px-4 py-2.5 rounded-lg border border-[#D1D5DB] bg-white text-base text-ink " +
  "placeholder-[#9CA3AF] transition-colors duration-150 " +
  "focus:border-primary focus:outline-[3px] focus:outline-primary/20 outline-none " +
  "disabled:bg-muted disabled:text-[#9CA3AF] disabled:cursor-not-allowed";

/** Error state. The border and outline change, and the message below carries
 *  the text — colour is never the only signal. */
export const FIELD_ERROR =
  "border-[#FCA5A5] focus:border-[#DC2626] focus:outline-[#DC2626]/20";

export const FIELD_LABEL = "block text-sm font-medium text-ink";

export const FIELD_ERROR_TEXT = "text-sm text-[#B91C1C]";
