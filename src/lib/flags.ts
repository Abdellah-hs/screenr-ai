/**
 * Feature flags, read from the environment.
 *
 * Two rules hold for every flag here:
 *
 * 1. **Default off.** Unset, empty, or any value other than the exact string
 *    `"true"` reads as false. A flag exists to hide something not ready, so an
 *    operator who mistypes it must get the safe state, not the risky one.
 * 2. **The flag holds on the server too.** A flag that only hides UI is a
 *    suggestion — the action behind the form still has to refuse the work.
 *
 * The `NEXT_PUBLIC_` prefix is required because these are read inside Client
 * Components as well as Server Actions. Next inlines them at **build** time, so
 * flipping one takes a redeploy, not just a restart.
 */

function isEnabled(value: string | undefined): boolean {
  return value === "true";
}

/**
 * Team reviewers (#46 / I5) — default **off**.
 *
 * The editor mints placeholder identities (`user-temp-<timestamp>`) for people
 * who have no Screenr account, and `campaign_reviewers` is referenced by no RLS
 * policy at all (#132), so the rows it writes grant nothing. That combination is
 * worse than a missing feature: the UI reads as "these people can review this
 * campaign" when none of them can, and the placeholder ids look like real
 * foreign keys to anyone reading the table later.
 *
 * Stays hidden until reviewer invites create real accounts and #132 settles what
 * a reviewer is actually allowed to do.
 */
export function isTeamReviewersEnabled(): boolean {
  return isEnabled(process.env.NEXT_PUBLIC_ENABLE_TEAM_REVIEWERS);
}
