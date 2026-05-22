import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Derives up-to-two-letter avatar initials from an email address.
 * Splits the local part on common name separators — "jane.doe@x.com" -> "JD",
 * "it@matious.com" -> "IT". Falls back to "?" when there is no local part.
 */
export function initialsFromEmail(email: string): string {
  const localPart = email.split("@")[0]?.trim() ?? "";
  const segments = localPart.split(/[._-]+/).filter(Boolean);

  if (segments.length === 0) return "?";
  if (segments.length === 1) return segments[0].slice(0, 2).toUpperCase();
  return (segments[0][0] + segments[1][0]).toUpperCase();
}
