import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import type { AiAuditStage } from "@/lib/constants";

/**
 * Read side of the AI audit trail (PRD 3.7.3).
 *
 * The write side has been complete and disciplined since the pipeline shipped —
 * five sanctioned writers, each persisting raw output, model, prompt version,
 * rubric version, confidence and rationale. Nothing ever read it back. With the
 * EU AI Act classifying recruitment AI as high-risk, an audit trail that cannot
 * be inspected or exported does not satisfy the requirement it was built for.
 *
 * SELECT-only by construction: `ai_audit_log` has no UPDATE or DELETE policy
 * (see `20260330174903_candidate_pipeline_schema.sql`), so it is append-only at
 * the database level and nothing here could mutate it even by mistake.
 */

/**
 * The raw, unvalidated filter shape the UI sends. Distinct from
 * `AuditLogFilters` (below), which is what survives Zod and reaches the query:
 * dates here are `YYYY-MM-DD` from a date input, there they are ISO instants.
 */
export interface AuditLogQuery {
  campaignId?: string;
  candidateId?: string;
  stage?: string;
  from?: string;
  to?: string;
  overriddenOnly?: boolean;
  page?: number;
}

export interface AuditLogFilters {
  campaignId?: string;
  candidateId?: string;
  stage?: AiAuditStage;
  /** Inclusive ISO date-time lower bound on `created_at`. */
  from?: string;
  /** Exclusive ISO date-time upper bound on `created_at`. */
  to?: string;
  /** Only rows a recruiter acted on afterwards. */
  overriddenOnly?: boolean;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  /** Total matching rows, ignoring pagination — drives the pager. */
  total: number;
}

/** A recruiter transition that followed an AI decision on the same application. */
export interface RecruiterAction {
  to_state: string;
  from_state: string | null;
  rationale: string | null;
  disposition_code: string | null;
  at: string;
}

export interface AuditLogEntry {
  id: string;
  created_at: string;
  stage: string;
  model: string;
  prompt_version: string;
  rubric_version: string | null;
  parsed_score: number | null;
  confidence: number | null;
  rationale: string | null;
  raw_output: string;
  input_snapshot: Json;
  action_taken: string | null;
  campaign_id: string;
  campaign_title: string;
  candidate_id: string | null;
  candidate_name: string | null;
  /**
   * The next recruiter-actor transition after this decision, if any.
   *
   * Deliberately NOT called an "override": pairing is by time on the same
   * application, so this says "a human acted after the AI said this", which is
   * the fact we can actually evidence. Whether it contradicted the AI is the
   * auditor's judgement to make from the two records side by side — asserting it
   * here would be the audit log drawing a conclusion, which is the one thing an
   * audit log must not do.
   */
  recruiter_action_after: RecruiterAction | null;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Campaigns to offer in the audit filter — **every** non-deleted campaign the
 * user owns, not just the Active ones.
 *
 * A compliance review is usually about a campaign that has already closed, so
 * scoping this to Active (as the overview page's list does) would hide exactly
 * the history an auditor came for.
 */
export async function fetchAuditCampaignOptions(
  userId: string,
): Promise<{ id: string; title: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, title")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data as { id: string; title: string }[];
}

/**
 * One page of audit rows for the campaigns `userId` owns, newest first.
 *
 * Scoped through `campaigns!inner(user_id)` on top of RLS — belt and braces, and
 * it makes the ownership boundary visible in the query rather than implicit in
 * a policy. `candidates` is a LEFT join because `candidate_id` is nullable
 * (résumé parsing logs before a candidate row exists), and an inner join there
 * would silently drop exactly the earliest evidence in a candidate's history.
 */
export async function fetchAuditLog(
  userId: string,
  filters: AuditLogFilters = {},
  page = 0,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<AuditLogPage> {
  const supabase = await createClient();

  let query = supabase
    .from("ai_audit_log")
    .select(
      "id, created_at, stage, model, prompt_version, rubric_version, parsed_score, confidence, rationale, raw_output, input_snapshot, action_taken, campaign_id, candidate_id, campaigns!inner(title, user_id, deleted_at), candidates(first_name, last_name)",
      { count: "exact" },
    )
    .eq("campaigns.user_id", userId)
    .is("campaigns.deleted_at", null);

  if (filters.campaignId) query = query.eq("campaign_id", filters.campaignId);
  if (filters.candidateId) query = query.eq("candidate_id", filters.candidateId);
  if (filters.stage) query = query.eq("stage", filters.stage);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lt("created_at", filters.to);

  const offset = page * pageSize;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error || !data) {
    console.error("Error fetching audit log:", JSON.stringify(error, null, 2));
    return { entries: [], total: 0 };
  }

  const rows = data as unknown as Array<{
    id: string;
    created_at: string;
    stage: string;
    model: string;
    prompt_version: string;
    rubric_version: string | null;
    parsed_score: number | null;
    confidence: number | null;
    rationale: string | null;
    raw_output: string;
    input_snapshot: Json;
    action_taken: string | null;
    campaign_id: string;
    candidate_id: string | null;
    campaigns: { title: string } | null;
    candidates: { first_name: string | null; last_name: string | null } | null;
  }>;

  const entries: AuditLogEntry[] = rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    stage: r.stage,
    model: r.model,
    prompt_version: r.prompt_version,
    rubric_version: r.rubric_version,
    parsed_score: r.parsed_score,
    confidence: r.confidence,
    rationale: r.rationale,
    raw_output: r.raw_output,
    input_snapshot: r.input_snapshot,
    action_taken: r.action_taken,
    campaign_id: r.campaign_id,
    campaign_title: r.campaigns?.title ?? "",
    candidate_id: r.candidate_id,
    candidate_name: fullName(r.candidates),
    recruiter_action_after: null,
  }));

  await attachRecruiterActions(entries, supabase);

  // Applied last: the filter is a property of the JOINED transition, which
  // PostgREST can't express against a separate table in one query.
  if (filters.overriddenOnly) {
    const kept = entries.filter((e) => e.recruiter_action_after !== null);
    return { entries: kept, total: kept.length };
  }

  return { entries, total: count ?? entries.length };
}

function fullName(
  c: { first_name: string | null; last_name: string | null } | null,
): string | null {
  if (!c) return null;
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : null;
}

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Pair each audit row with the next recruiter-actor transition on the same
 * application, so a manual decision is readable beside the AI evidence that
 * preceded it (PRD 3.7.2).
 *
 * Two extra queries per page rather than per row: resolve the page's
 * (campaign, candidate) pairs to application ids, then fetch recruiter
 * transitions for that set in one go.
 */
async function attachRecruiterActions(entries: AuditLogEntry[], supabase: Db): Promise<void> {
  const candidateIds = [...new Set(entries.map((e) => e.candidate_id).filter(Boolean))] as string[];
  const campaignIds = [...new Set(entries.map((e) => e.campaign_id))];
  if (candidateIds.length === 0) return;

  const { data: apps } = await supabase
    .from("applications")
    .select("id, campaign_id, candidate_id")
    .in("candidate_id", candidateIds)
    .in("campaign_id", campaignIds);

  if (!apps || apps.length === 0) return;

  const appIdByPair = new Map<string, string>();
  for (const a of apps) {
    appIdByPair.set(`${a.campaign_id}:${a.candidate_id}`, a.id);
  }

  const { data: transitions } = await supabase
    .from("application_transitions")
    .select("application_id, from_state, to_state, rationale, disposition_code, created_at")
    .in("application_id", [...appIdByPair.values()])
    .eq("actor", "recruiter")
    .order("created_at", { ascending: true });

  if (!transitions || transitions.length === 0) return;

  const byApp = new Map<string, typeof transitions>();
  for (const t of transitions) {
    const list = byApp.get(t.application_id) ?? [];
    list.push(t);
    byApp.set(t.application_id, list);
  }

  for (const entry of entries) {
    if (!entry.candidate_id) continue;
    const appId = appIdByPair.get(`${entry.campaign_id}:${entry.candidate_id}`);
    if (!appId) continue;

    // Ascending order means the first match is the NEAREST action after this
    // decision — a later one belongs to whatever evidence came after it.
    const next = byApp.get(appId)?.find((t) => t.created_at > entry.created_at);
    if (!next) continue;

    entry.recruiter_action_after = {
      from_state: next.from_state,
      to_state: next.to_state,
      rationale: next.rationale,
      disposition_code: next.disposition_code,
      at: next.created_at,
    };
  }
}
