import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary:
    "bg-cta text-white shadow-md hover:opacity-90 hover:-translate-y-[1px] hover:shadow-lg",
  secondary:
    "bg-transparent text-primary border-2 border-primary hover:bg-primary hover:text-white hover:shadow-lg",
  ghost:
    "bg-transparent text-foreground hover:bg-primary/5",
  danger:
    "bg-red-600 text-white shadow-md hover:bg-red-700 hover:shadow-lg",
} as const;

const sizes = {
  sm: "px-3 py-1.5 text-sm rounded-md",
  md: "px-6 py-3 rounded-lg",
  lg: "px-8 py-4 text-lg rounded-lg",
  icon: "p-2 rounded-lg",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center font-semibold transition-all duration-300 cursor-pointer",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
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
