interface RubricMismatchBadgeProps {
  scoredAt: number | null;
  currentVersion: number | null;
}

/**
 * Shown next to a score when it was produced under an older evaluation_rubric
 * than the campaign's currently-active one for that stage. Tells the recruiter
 * "this score may be stale" without blocking advancement (issue #36).
 *
 * Renders nothing when either version is unknown (scored before rubric
 * versioning, or no active rubric configured) or when the versions match.
 */
export function RubricMismatchBadge({ scoredAt, currentVersion }: RubricMismatchBadgeProps) {
  if (scoredAt == null || currentVersion == null) return null;
  if (scoredAt === currentVersion) return null;

  return (
    <span
      title={`This candidate was scored under rubric v${scoredAt}; the current rubric is v${currentVersion}. Re-score to evaluate them against the latest criteria.`}
      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]"
    >
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
        />
      </svg>
      Scored under rubric v{scoredAt} (current: v{currentVersion})
    </span>
  );
}
