import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { FIELD_BASE, FIELD_ERROR, FIELD_LABEL, FIELD_ERROR_TEXT } from "./field";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    // The old id fell back to a slugged label, so two fields labelled "Name" on
    // one page produced duplicate ids and the second label pointed at the first
    // input. useId is per-instance, so it cannot collide.
    const generatedId = useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className={FIELD_LABEL}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(FIELD_BASE, error && FIELD_ERROR, className)}
          {...props}
        />
        {error && (
          <p id={errorId} className={FIELD_ERROR_TEXT}>
            {error}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
