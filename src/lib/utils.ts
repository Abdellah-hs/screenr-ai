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

const SLUG_MAX_LENGTH = 60;

/**
 * Derives a URL-safe slug from a campaign title for the public apply link
 * (`/apply/<slug>`). Lower-cases, strips accents to ASCII, collapses any run of
 * non-alphanumerics into a single hyphen, trims edge hyphens, and caps the
 * length without leaving a trailing hyphen. Falls back to "campaign" when the
 * title has no slug-able characters (e.g. emoji- or punctuation-only titles),
 * so the result is always a non-empty base. Uniqueness is the caller's job —
 * the data layer disambiguates collisions before persisting.
 */
export function slugifyTitle(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, ""); // re-trim in case the slice landed mid-hyphen

  return base || "campaign";
}

/**
 * A timestamp as the evidence panels render it — "Aug 24, 2026, 3:05 PM".
 *
 * Shared because the screening thread and the interview transcript sit one
 * above the other on the same candidate page, each carrying its own copy of
 * this. Two copies of one format is how the same moment starts reading two
 * different ways depending on which panel you look at.
 */
export function formatEvidenceTimestamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
