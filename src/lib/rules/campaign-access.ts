import type { ReviewerRole } from "@/lib/constants";

/**
 * Who may do what on a campaign (issue #132).
 *
 * `campaign_reviewers` and `reviewer_role_enum` existed from the first schema
 * migration and **no policy referenced either**, so every role was worth the
 * same thing: nothing. This module is the app-layer half of the fix, and it is
 * deliberately pure — the SQL half lives in
 * `20260830140000_campaign_reviewer_access.sql`, and the two must agree.
 *
 * **The database is the boundary, not this file.** These helpers exist so an
 * action can refuse early and return a readable error instead of surfacing a
 * policy violation as a failed query. An observer who calls a Server Action
 * directly is refused twice: here, and by the RLS policy underneath.
 */
export type CampaignAccessRole = "owner" | ReviewerRole;

/**
 * Higher outranks lower, and every level includes the ones beneath it.
 *
 * The ladder is the whole model: `observer` reads, `reviewer` also decides,
 * `lead` also configures, `owner` also deletes. Nothing in the product needs a
 * role that can write but not read, so a single ordering is honest — a matrix
 * would imply combinations that do not exist.
 */
const ROLE_RANK: Record<CampaignAccessRole, number> = {
  observer: 0,
  reviewer: 1,
  lead: 2,
  owner: 3,
};

/** Does `role` meet or exceed `minimum`? A null role is not a member at all. */
export function meetsCampaignRole(
  role: CampaignAccessRole | null,
  minimum: CampaignAccessRole,
): boolean {
  if (role === null) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * May this role move an application, re-score, or write an audit row?
 *
 * Mirrors `can_decide_campaign()` in SQL. An `observer` is excluded here for
 * the same reason the policy excludes them: a read-only role that can
 * transition an application is not read-only.
 */
export function canDecideOnCampaign(role: CampaignAccessRole | null): boolean {
  return meetsCampaignRole(role, "reviewer");
}

/**
 * May this role change the rules — rubrics, criteria, questions, SLA timers,
 * availability, the reviewer list?
 *
 * Mirrors `can_manage_campaign()`. Deciding about one candidate is not the same
 * authority as changing the rubric everyone is judged against, so a plain
 * `reviewer` does not get this.
 */
export function canManageCampaign(role: CampaignAccessRole | null): boolean {
  return meetsCampaignRole(role, "lead");
}

/** Only the creator may delete a campaign outright. */
export function canDeleteCampaign(role: CampaignAccessRole | null): boolean {
  return role === "owner";
}
