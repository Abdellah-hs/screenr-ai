import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * The variant encodes CONSEQUENCE, not just prominence.
 *
 * `primary` is ink because the primary thing a recruiter does in this product
 * is change a person's state, and that should look irreversible. Emerald moved
 * to its own `success` variant and means only a positive TERMINAL outcome —
 * hired, approved, submitted. Before this they were the same colour, so
 * "Advance to interview" and "Hire" were indistinguishable.
 *
 * Blue is deliberately absent: it is navigation and focus, never an action.
 * Indigo is deliberately absent: it attributes AI output and is never a button.
 *
 * `danger` is outlined rather than filled. A destructive action should be
 * unmistakable, not the loudest object on the screen — a solid red button
 * competes with the primary action for attention it has not earned.
 */
const variants = {
  primary: "bg-ink text-white hover:bg-ink-hover",
  secondary:
    "bg-white text-[#374151] border border-[#D1D5DB] hover:bg-[#F9FAFB] hover:text-ink",
  ghost: "bg-transparent text-[#4B5563] hover:bg-muted hover:text-ink",
  success: "bg-cta text-white hover:bg-[#059669]",
  danger:
    "bg-white text-[#B91C1C] border border-[#FCA5A5] hover:bg-[#FEF2F2] hover:border-[#F87171]",
} as const;

const sizes = {
  sm: "px-3 py-1.5 text-sm rounded-lg",
  md: "px-[18px] py-2.5 rounded-lg",
  lg: "px-8 py-4 text-lg rounded-lg",
  icon: "p-2 rounded-lg",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

/**
 * `type` defaults to "button", not to HTML's "submit".
 *
 * A bare `<button>` inside a `<form>` submits it. That default is right for a
 * plain HTML page and wrong for a component used mostly for onClick handlers:
 * every `<Button>` that forgets `type` becomes a submit button, and inside a
 * long form — the campaign wizard is one `<form>` end to end — that means an
 * unrelated control can create the record. Callers that DO want to submit say
 * so explicitly, and `{...props}` lets them.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center gap-2 font-semibold cursor-pointer",
          // Colour only, at 120ms. The old `transition-all duration-300` with a
          // `-translate-y` on hover moves the button out from under the pointer
          // and is visibly jittery across a dense table.
          "transition-colors duration-150",
          // Visible on white, on a tinted row, and on ink itself.
          "focus-visible:outline-[3px] focus-visible:outline-primary/45 focus-visible:outline-offset-2",
          "disabled:bg-muted disabled:text-[#9CA3AF] disabled:border-border disabled:cursor-not-allowed disabled:pointer-events-none",
          variants[variant],
          sizes[size],
          className
        )}
        disabled={disabled}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
