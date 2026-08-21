import { createClient } from "@/lib/supabase/server";
import type { BoardApplication } from "@/lib/campaigns/board-view";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseDb } from "@/lib/supabase/types";
import type {
  CampaignStatus,
  AutomationMode,
  InterviewPersona,
  Campaign,
  EvaluationRubric,
  DimensionImportance,
  CampaignReviewer,
  SlaTimer,
  InterviewAvailabilityRule,
  PipelineStageCount,
} from "@/lib/constants";
import { deriveDimensionFields } from "@/lib/rubric-weights";
import {
  deriveResumeDimensionFields,
  priorityFromMandatoryFlag,
} from "@/lib/resume-scoring";
import { slugifyTitle } from "@/lib/utils";
import type { Database } from "@/types/database.types";

type CampaignInsert = Database["public"]["Tables"]["campaigns"]["Insert"];
type CampaignUpdate = Database["public"]["Tables"]["campaigns"]["Update"];
type EvaluationRubricRow = Database["public"]["Tables"]["evaluation_rubrics"]["Row"];
type RubricDimensionRow = Database["public"]["Tables"]["rubric_dimensions"]["Row"];
type CampaignReviewerRow = Database["public"]["Tables"]["campaign_reviewers"]["Row"];
type SlaTimerRow = Database["public"]["Tables"]["sla_timers"]["Row"];
type AvailabilityRuleRow = Database["public"]["Tables"]["interview_availability_rules"]["Row"];

// Recruiter intent only — weight/min_score/max_score are derived on write
// via deriveDimensionFields (issue #77).
type RubricDimensionInput = {
  name: string;
  importance: DimensionImportance;
  is_mandatory: boolean;
  sort_order: number;
};
type RubricInput = {
  stage: "resume" | "screening_q" | "interview";
  dimensions?: RubricDimensionInput[];
};

/**
 * Derive the numeric columns for one rubric's dimensions.
 *
 * The resume stage is deliberately different: its recruiter model is priority
 * (must-have / nice-to-have) and nothing else, so its fail line is the resume
 * gate (60) rather than the generic MANDATORY_FAIL_LINE (30) the weighted
 * stages use. Screening-question and interview rubrics still score on weighted
 * importance and are untouched by the evidence refactor.
 */
function deriveDimensionRows(stage: RubricInput["stage"], dims: RubricDimensionInput[]) {
  if (stage === "resume") {
    return deriveResumeDimensionFields(
      dims.map((d) => ({ ...d, priority: priorityFromMandatoryFlag(d.is_mandatory) })),
    );
  }
  return deriveDimensionFields(dims);
}
type ReviewerInput = {
  user_id?: string;
  role: "lead" | "reviewer" | "observer";
};
type SlaTimerInput = {
  stage: string;
  time_limit_hours: number;
  alert_threshold_hours: number;
  escalation_threshold_hours: number;
};
type AvailabilityRuleInput = {
  weekday: number;
  start_minute: number;
  end_minute: number;
};
type ScreeningQuestionInput = {
  prompt: string;
};

// Slug-collision retry budget for insertCampaignTx. A handful of suffixed
// attempts is plenty — collisions are rare (only same-titled campaigns).
const MAX_SLUG_ATTEMPTS = 5;

/** Short, URL-safe random suffix to disambiguate a colliding campaign slug. */
function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

const DEFAULT_PIPELINE: PipelineStageCount[] = [
  { name: "New", key: "applied", count: 0 },
  { name: "Screening", key: "screening", count: 0 },
  { name: "Interview", key: "interview", count: 0 },
  { name: "Final Interview", key: "final_interview", count: 0 },
  { name: "Hired", key: "hired", count: 0 },
];

function assembleCampaign(
  row: Record<string, unknown>,
  rubrics: EvaluationRubric[],
  reviewers: CampaignReviewer[],
  slaTimers: SlaTimer[],
  availabilityRules: InterviewAvailabilityRule[]
): Campaign {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    department: (row.department as string) || null,
    positions: row.positions as number,
    status: row.status as CampaignStatus,
    accepting_applications: (row.accepting_applications as boolean) ?? true,
    deadline: (row.deadline as string) || null,
    deadline_enforced: (row.deadline_enforced as boolean) ?? false,
    location: (row.location as string) || null,
    timezone: (row.timezone as string) || null,
    public_slug: (row.public_slug as string) || null,
    automation_mode: row.automation_mode as AutomationMode,
    resume_threshold: row.resume_threshold as number,
    screening_threshold: row.screening_threshold as number,
    interview_persona: row.interview_persona as InterviewPersona,
    rubrics,
    reviewers,
    sla_timers: slaTimers,
    interview_slot_minutes: (row.interview_slot_minutes as number) ?? null,
    interview_timezone: (row.interview_timezone as string) || null,
    interview_booking_horizon_days: (row.interview_booking_horizon_days as number) ?? 14,
    interview_availability_rules: availabilityRules,
    pipeline: DEFAULT_PIPELINE,
    user_id: row.user_id as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    deleted_at: (row.deleted_at as string) || null,
  };
}

function groupBy<T extends Record<string, unknown>>(arr: T[], key: string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = item[key] as string;
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

// ─── GET all campaigns
export async function fetchAllCampaigns(userId: string): Promise<Campaign[]> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error || !rows) return [];

  const campaignIds = rows.map((r) => r.id);

  const [rubricsRes, dimensionsRes, reviewersRes, slaRes, availabilityRes] =
    await Promise.all([
      supabase.from("evaluation_rubrics").select("*").in("campaign_id", campaignIds).eq("is_active", true),
      supabase.from("rubric_dimensions").select("*").is("deleted_at", null),
      supabase.from("campaign_reviewers").select("*").in("campaign_id", campaignIds),
      supabase.from("sla_timers").select("*").in("campaign_id", campaignIds),
      supabase.from("interview_availability_rules").select("*").in("campaign_id", campaignIds),
    ]);

  const rubricsByC = groupBy(rubricsRes.data || [], "campaign_id");
  const dimensionsByR = groupBy(dimensionsRes.data || [], "rubric_id");
  const reviewersByC = groupBy(reviewersRes.data || [], "campaign_id");
  const slaByC = groupBy(slaRes.data || [], "campaign_id");
  const availabilityByC = groupBy(availabilityRes.data || [], "campaign_id");

  return rows.map((row) => {
    const rubrics = ((rubricsByC[row.id] || []) as EvaluationRubricRow[]).map((r) => ({
      id: r.id as string,
      campaign_id: r.campaign_id as string,
      stage: r.stage as "resume" | "screening_q" | "interview",
      version: r.version as number,
      is_active: r.is_active as boolean,
      dimensions: ((dimensionsByR[r.id as string] || []) as RubricDimensionRow[]).map((d) => ({
        id: d.id,
        name: d.name,
        importance: d.importance,
        weight: d.weight,
        is_mandatory: d.is_mandatory,
        min_score: d.min_score,
        max_score: d.max_score,
        sort_order: d.sort_order,
      })),
      created_at: r.created_at,
      archived_at: r.archived_at,
    }));

    const reviewers = ((reviewersByC[row.id] || []) as CampaignReviewerRow[]).map((r) => ({
      id: r.id,
      user_id: r.user_id,
      name: "",
      email: "",
      avatar_url: null,
      role: r.role,
      assigned_at: r.assigned_at,
    }));

    const slaTimers = ((slaByC[row.id] || []) as SlaTimerRow[]).map((s) => ({
      stage: s.stage as SlaTimer["stage"],
      time_limit_hours: s.time_limit_hours,
      alert_threshold_hours: s.alert_threshold_hours,
      escalation_threshold_hours: s.escalation_threshold_hours,
    }));

    const availabilityRules = mapAvailabilityRows(availabilityByC[row.id]);

    return assembleCampaign(row as unknown as Record<string, unknown>, rubrics, reviewers, slaTimers, availabilityRules);
  });
}

/** Map raw availability rows to the domain type, sorted weekday → start time.
 *  Exported for unit testing. */
export function mapAvailabilityRows(rows: AvailabilityRuleRow[] | undefined): InterviewAvailabilityRule[] {
  return (rows ?? [])
    .map((r) => ({
      weekday: r.weekday,
      start_minute: r.start_minute,
      end_minute: r.end_minute,
    }))
    .sort((a, b) => a.weekday - b.weekday || a.start_minute - b.start_minute);
}

// ─── GET single campaign
export async function fetchCampaignById(id: string, userId: string): Promise<Campaign | null> {
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();

  if (error || !row) return null;

  const [rubricsRes, reviewersRes, slaRes, availabilityRes] = await Promise.all([
    supabase.from("evaluation_rubrics").select("*").eq("campaign_id", id).eq("is_active", true),
    supabase.from("campaign_reviewers").select("*").eq("campaign_id", id),
    supabase.from("sla_timers").select("*").eq("campaign_id", id),
    supabase.from("interview_availability_rules").select("*").eq("campaign_id", id),
  ]);

  const rubricIds = (rubricsRes.data || []).map((r) => r.id);
  const dimensionsRes = rubricIds.length > 0
    ? await supabase.from("rubric_dimensions").select("*").in("rubric_id", rubricIds).is("deleted_at", null)
    : { data: [] as RubricDimensionRow[] };

  const dimensionsByR = groupBy(dimensionsRes.data || [], "rubric_id");

  const rubrics: EvaluationRubric[] = (rubricsRes.data || []).map((r) => ({
    id: r.id,
    campaign_id: r.campaign_id,
    stage: r.stage as "resume" | "screening_q" | "interview",
    version: r.version,
    is_active: r.is_active,
    dimensions: ((dimensionsByR[r.id] || []) as RubricDimensionRow[]).map((d) => ({
      id: d.id,
      name: d.name,
      importance: d.importance,
      weight: d.weight,
      is_mandatory: d.is_mandatory,
      min_score: d.min_score,
      max_score: d.max_score,
      sort_order: d.sort_order,
    })),
    created_at: r.created_at,
    archived_at: r.archived_at,
  }));

  const reviewers: CampaignReviewer[] = (reviewersRes.data || []).map((r) => ({
    id: r.id,
    user_id: r.user_id,
    name: "",
    email: "",
    avatar_url: null,
    role: r.role,
    assigned_at: r.assigned_at,
  }));

  const slaTimers: SlaTimer[] = (slaRes.data || []).map((s) => ({
    stage: s.stage as SlaTimer["stage"],
    time_limit_hours: s.time_limit_hours,
    alert_threshold_hours: s.alert_threshold_hours,
    escalation_threshold_hours: s.escalation_threshold_hours,
  }));

  const availabilityRules = mapAvailabilityRows(availabilityRes.data ?? undefined);

  return assembleCampaign(row as unknown as Record<string, unknown>, rubrics, reviewers, slaTimers, availabilityRules);
}

/**
 * Returns true if the user owns an active (non-deleted) campaign with the
 * given id. Used by action code to gate recruiter-scoped operations.
 */
export async function verifyCampaignOwnership(
  campaignId: string,
  userId: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();
  return Boolean(data);
}

/**
 * The campaign's current status, scoped to the owning user (doubles as an
 * ownership gate). Returns null when the campaign is missing or not owned.
 * SELECT-only — used by the inline status changer to validate the transition
 * before writing.
 */
export async function fetchCampaignStatus(
  campaignId: string,
  userId: string
): Promise<CampaignStatus | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("status")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();
  return (data?.status as CampaignStatus) ?? null;
}

/**
 * Flip a campaign's status in place (the inline status changer — a quick status
 * change outside the full edit form). Scoped to the owning, non-deleted campaign
 * so it doubles as an ownership gate, and appends a `campaign_status_changed`
 * audit row capturing old → new. The legality of `from → to` is decided by the
 * rule layer before this is called; this only persists the result.
 */
export async function updateCampaignStatusTx(
  id: string,
  fromStatus: CampaignStatus,
  toStatus: CampaignStatus,
  userId: string,
  acceptingApplications?: boolean
): Promise<void> {
  const supabase = await createClient();

  // Bulk callers pass only a status (intake left untouched); the inline changer
  // passes the intake flag too so the two "Active —" options work from there.
  const statusUpdate: { status: CampaignStatus; accepting_applications?: boolean } = {
    status: toStatus,
  };
  if (acceptingApplications !== undefined) {
    statusUpdate.accepting_applications = acceptingApplications;
  }

  const { data: updated, error } = await supabase
    .from("campaigns")
    .update(statusUpdate)
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id")
    .single();

  if (error || !updated) {
    throw new Error(error?.message || "Campaign not found or access denied");
  }

  await supabase.from("campaign_audit_log").insert({
    campaign_id: id,
    user_id: userId,
    action: "campaign_status_changed",
    entity_type: "campaign",
    entity_id: id,
    old_data: { status: fromStatus },
    new_data: { status: toStatus },
  });
}

/**
 * Soft-delete a campaign (the "Remove" row action). Sets `deleted_at` so it
 * drops out of every list query (all of which filter `deleted_at is null`)
 * without destroying its candidates, scores or audit history. Scoped to the
 * owning, not-already-deleted campaign so it doubles as an ownership gate, and
 * appends a `campaign_deleted` audit row.
 */
export async function softDeleteCampaignTx(
  id: string,
  userId: string
): Promise<void> {
  const supabase = await createClient();

  const { data: deleted, error } = await supabase
    .from("campaigns")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id")
    .single();

  if (error || !deleted) {
    throw new Error(error?.message || "Campaign not found or access denied");
  }

  await supabase.from("campaign_audit_log").insert({
    campaign_id: id,
    user_id: userId,
    action: "campaign_deleted",
    entity_type: "campaign",
    entity_id: id,
  });
}

/**
 * Undo a soft-delete (the "Restore" action from the Talent Pool). Clears
 * `deleted_at` so the campaign — and the normal candidate click-through under
 * it — reappears everywhere. Scoped to the owning, currently-removed campaign
 * (`deleted_at is not null`) so it doubles as an ownership gate and is a no-op
 * on a campaign that was never removed. Appends a `campaign_restored` audit row.
 */
export async function restoreCampaignTx(
  id: string,
  userId: string
): Promise<void> {
  const supabase = await createClient();

  const { data: restored, error } = await supabase
    .from("campaigns")
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("user_id", userId)
    .not("deleted_at", "is", null)
    .select("id")
    .single();

  if (error || !restored) {
    throw new Error(error?.message || "Campaign not found or not removed");
  }

  await supabase.from("campaign_audit_log").insert({
    campaign_id: id,
    user_id: userId,
    action: "campaign_restored",
    entity_type: "campaign",
    entity_id: id,
  });
}

export interface CampaignBySlug {
  campaign_id: string;
  user_id: string;
  title: string;
  status: CampaignStatus;
  accepting_applications: boolean;
  deadline: string | null;
  deadline_enforced: boolean;
}

/**
 * Public, session-less lookup of a campaign by its `public_slug` — backs the
 * candidate apply page (`/apply/<slug>`). Service-role by default so it reads
 * without an account (campaigns are owner-RLS). SELECT-only.
 *
 * Returns the status (NOT filtered to active) so the caller can tell apart a
 * non-existent slug (null) from a real campaign that simply isn't accepting
 * applications right now — the page shows different copy for each.
 */
export async function fetchCampaignBySlug(
  slug: string,
  db?: SupabaseDb,
): Promise<CampaignBySlug | null> {
  const supabase = db ?? createAdminClient();
  const { data } = await supabase
    .from("campaigns")
    .select("id, user_id, title, status, accepting_applications, deadline, deadline_enforced")
    .eq("public_slug", slug)
    .is("deleted_at", null)
    .single();

  if (!data) return null;
  return {
    campaign_id: data.id as string,
    user_id: data.user_id as string,
    title: data.title as string,
    status: data.status as CampaignStatus,
    accepting_applications: (data.accepting_applications as boolean) ?? true,
    deadline: (data.deadline as string) || null,
    deadline_enforced: (data.deadline_enforced as boolean) ?? false,
  };
}

/**
 * Just the SLA timers for one campaign.
 *
 * The candidate list needs these to flag overdue rows, and `fetchCampaignById`
 * would drag rubrics, dimensions, reviewers and availability rules along for
 * three columns. RLS scopes `sla_timers` through its campaign, so no explicit
 * owner filter is needed — and a campaign the caller cannot see returns an
 * empty list, which reads as "no SLA configured": no rows leak either way.
 */
export async function fetchSlaTimersByCampaignId(
  campaignId: string,
): Promise<SlaTimer[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("sla_timers")
    .select("stage, time_limit_hours, alert_threshold_hours, escalation_threshold_hours")
    .eq("campaign_id", campaignId);

  if (error || !data) return [];

  return data.map((row) => ({
    stage: row.stage as SlaTimer["stage"],
    time_limit_hours: row.time_limit_hours,
    alert_threshold_hours: row.alert_threshold_hours,
    escalation_threshold_hours: row.escalation_threshold_hours,
  }));
}

// ─── Lightweight query for scoring pipeline (avoids loading rubrics, reviewers, SLAs)
export async function fetchCampaignScoringConfig(campaignId: string, userId: string, db?: SupabaseDb) {
  const supabase = db ?? (await createClient());

  const { data: row } = await supabase
    .from("campaigns")
    .select("id, description, automation_mode, resume_threshold, screening_threshold")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();

  if (!row) return null;

  // Resume scoring is driven by the active `resume` evaluation rubric — the
  // single source of truth for "how to score a CV" (issue #65). Each rubric
  // dimension maps to one criterion, and the ONLY thing carried forward is its
  // priority: `weight` and `min_score` are deliberately not read, because a
  // must-have gate that consulted a weight would be a gate that could be
  // out-weighed. `sort_order` matters and is not cosmetic — evidence comes back
  // index-aligned to this list.
  const { data: resumeRubric } = await supabase
    .from("evaluation_rubrics")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("stage", "resume")
    .eq("is_active", true)
    .maybeSingle();

  const { data: dimensions } = resumeRubric
    ? await supabase
        .from("rubric_dimensions")
        .select("id, name, is_mandatory, sort_order")
        .eq("rubric_id", resumeRubric.id)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
    : { data: [] };

  return {
    id: row.id as string,
    description: row.description as string,
    automation_mode: row.automation_mode as AutomationMode,
    // Both bars are returned because two callers share this fetcher: the resume
    // rule reads `resume_threshold`, the screening scorer reads
    // `screening_threshold`. The rule's own `CampaignScoringConfig` declares
    // only the resume bar, so the resume decision structurally cannot reach for
    // the screening one.
    resume_threshold: row.resume_threshold as number,
    screening_threshold: row.screening_threshold as number,
    screening_criteria: (dimensions || []).map((d) => ({
      id: d.id,
      label: d.name,
      priority: priorityFromMandatoryFlag(d.is_mandatory),
    })),
  };
}

/**
 * Look up the version of the active evaluation_rubric for a campaign/stage.
 * Used at score time to stamp every score (and its audit row) with the
 * rubric version it was scored under, so the UI can flag candidates whose
 * scores were produced against an older rubric than the campaign's
 * current one.
 *
 * Returns null when there is no active rubric for that stage — the
 * campaign may have been set up without one. Callers should treat null
 * as "rubric version unknown" and not surface a mismatch badge.
 */
export type RubricStage = "resume" | "screening_q" | "interview";

export async function fetchActiveRubricVersion(
  campaignId: string,
  stage: RubricStage,
  db?: SupabaseDb,
): Promise<number | null> {
  const supabase = db ?? (await createClient());
  const { data, error } = await supabase
    .from("evaluation_rubrics")
    .select("version")
    .eq("campaign_id", campaignId)
    .eq("stage", stage)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error(`fetchActiveRubricVersion(${campaignId}, ${stage}) failed:`, error);
    return null;
  }
  return data?.version ?? null;
}

// ─── Mutation Helpers

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Structural equality of two dimension sets by recruiter intent (name +
 * importance + Must-Have + order), order-independent. Weight/min_score are
 * derived from these, so comparing intent is what decides whether an edit
 * warrants a new rubric version. Equal → reuse the active rubric; different →
 * archive + bump. Exported for unit testing.
 */
export function dimensionsEqual(
  a: RubricDimensionInput[],
  b: RubricDimensionInput[],
): boolean {
  if (a.length !== b.length) return false;
  const norm = (d: RubricDimensionInput) =>
    `${d.name}|${d.importance}|${d.is_mandatory}|${d.sort_order}`;
  const as = [...a].map(norm).sort();
  const bs = [...b].map(norm).sort();
  return as.every((v, i) => v === bs[i]);
}

/**
 * Persist rubrics with version history (used by the update path). For each
 * submitted stage that has dimensions, compare against the campaign's active
 * rubric for that stage:
 *   - no active rubric        → insert version 1 (active)
 *   - dimensions unchanged    → no-op (don't churn a new version on every save)
 *   - dimensions changed      → archive the active rubric (is_active=false,
 *     archived_at=now) and insert version+1 as the new active rubric.
 *
 * Never updates dimensions in place — old versions stay intact so a score
 * stamped `rubric_version = N` remains interpretable against version N.
 */
async function upsertRubricsVersioned(
  supabase: SupabaseServerClient,
  campaignId: string,
  rubrics: RubricInput[],
): Promise<void> {
  for (const rubric of rubrics) {
    const dims = rubric.dimensions ?? [];

    const { data: active } = await supabase
      .from("evaluation_rubrics")
      .select("id, version")
      .eq("campaign_id", campaignId)
      .eq("stage", rubric.stage)
      .eq("is_active", true)
      .maybeSingle();

    let existingDims: RubricDimensionInput[] = [];
    if (active) {
      const { data: dimRows } = await supabase
        .from("rubric_dimensions")
        .select("name, importance, is_mandatory, sort_order")
        .eq("rubric_id", active.id)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });
      existingDims = (dimRows || []) as RubricDimensionInput[];
    }

    if (active && dimensionsEqual(existingDims, dims)) continue;

    if (active) {
      await supabase
        .from("evaluation_rubrics")
        .update({ is_active: false, archived_at: new Date().toISOString() })
        .eq("id", active.id);
    }

    if (dims.length === 0) continue;

    const nextVersion = (active?.version ?? 0) + 1;
    const { data: inserted } = await supabase
      .from("evaluation_rubrics")
      .insert({
        campaign_id: campaignId,
        stage: rubric.stage,
        version: nextVersion,
        is_active: true,
      })
      .select()
      .single();

    if (inserted) {
      await supabase.from("rubric_dimensions").insert(
        deriveDimensionRows(rubric.stage, dims).map((d) => ({
          rubric_id: inserted.id,
          name: d.name,
          importance: d.importance,
          weight: d.weight,
          is_mandatory: d.is_mandatory,
          min_score: d.min_score,
          max_score: d.max_score,
          sort_order: d.sort_order,
        })),
      );
    }
  }
}

export async function insertCampaignTx(
  payload: Omit<CampaignInsert, "user_id">,
  rubrics: RubricInput[],
  slaTimers: SlaTimerInput[],
  reviewers: ReviewerInput[],
  availabilityRules: AvailabilityRuleInput[],
  screeningQuestions: ScreeningQuestionInput[],
  userId: string
): Promise<string> {
  const supabase = await createClient();

  // 1. Insert campaign with a unique public_slug derived from the title. The
  //    slug is set once here and never changes, so a shared apply link survives
  //    later title edits. On the rare slug collision (Postgres 23505 against
  //    idx_campaigns_public_slug) retry with a short random suffix.
  const baseSlug = slugifyTitle(payload.title);
  let campaign: { id: string } | null = null;
  for (let attempt = 0; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const publicSlug = attempt === 0 ? baseSlug : `${baseSlug}-${randomSlugSuffix()}`;
    const { data, error } = await supabase
      .from("campaigns")
      .insert({ ...payload, user_id: userId, public_slug: publicSlug })
      .select()
      .single();

    if (data) {
      campaign = data;
      break;
    }
    if (error?.code === "23505" && attempt < MAX_SLUG_ATTEMPTS) continue;
    throw new Error(error?.message || "Failed to create campaign");
  }
  if (!campaign) throw new Error("Failed to create campaign: could not allocate a unique slug");

  // 2. Insert rubrics and dimensions — the resume rubric is the single source
  //    of truth for CV scoring (issue #65); screening_criteria is retired.
  for (const rubric of rubrics) {
    const { data: insertedRubric } = await supabase
      .from("evaluation_rubrics")
      .insert({
        campaign_id: campaign.id,
        stage: rubric.stage,
        version: 1,
        is_active: true,
      })
      .select()
      .single();

    if (insertedRubric && rubric.dimensions && rubric.dimensions.length > 0) {
      await supabase.from("rubric_dimensions").insert(
        deriveDimensionRows(rubric.stage, rubric.dimensions).map((d) => ({
          rubric_id: insertedRubric.id,
          name: d.name,
          importance: d.importance,
          weight: d.weight,
          is_mandatory: d.is_mandatory,
          min_score: d.min_score,
          max_score: d.max_score,
          sort_order: d.sort_order,
        }))
      );
    }
  }

  // 4. Insert SLA timers
  if (slaTimers.length > 0) {
    await supabase.from("sla_timers").insert(
      slaTimers.map((s) => ({
        campaign_id: campaign.id,
        stage: s.stage,
        time_limit_hours: s.time_limit_hours,
        alert_threshold_hours: s.alert_threshold_hours,
        escalation_threshold_hours: s.escalation_threshold_hours,
      }))
    );
  }

  // 5. Insert reviewers
  if (reviewers.length > 0) {
    await supabase.from("campaign_reviewers").insert(
      reviewers.map((r) => ({
        campaign_id: campaign.id,
        user_id: r.user_id || userId,
        role: r.role,
      }))
    );
  }

  // 5b. Insert AI-interview availability rules
  if (availabilityRules.length > 0) {
    await supabase.from("interview_availability_rules").insert(
      availabilityRules.map((a) => ({
        campaign_id: campaign.id,
        weekday: a.weekday,
        start_minute: a.start_minute,
        end_minute: a.end_minute,
      }))
    );
  }

  // 5c. Insert screening questions staged on the create form. Same shape and
  //     ordering rule as `replaceScreeningQuestions` — `sort_order` is the
  //     array index, which is the order the candidate is asked them in.
  if (screeningQuestions.length > 0) {
    await supabase.from("screening_questions").insert(
      screeningQuestions.map((q, i) => ({
        campaign_id: campaign.id,
        prompt: q.prompt,
        sort_order: i,
      }))
    );
  }

  // 6. Write audit log entry
  await supabase.from("campaign_audit_log").insert({
    campaign_id: campaign.id,
    user_id: userId,
    action: "campaign_created",
    entity_type: "campaign",
    entity_id: campaign.id,
    new_data: { title: payload.title, status: payload.status },
  });

  return campaign.id;
}

export async function updateCampaignTx(
  id: string,
  payload: CampaignUpdate,
  rubrics: RubricInput[],
  slaTimers: { stage: string; time_limit_hours: number; alert_threshold_hours: number; escalation_threshold_hours: number }[],
  availabilityRules: AvailabilityRuleInput[],
  userId: string
): Promise<void> {
  const supabase = await createClient();

  // Ownership check
  const { data: ownerCheck } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (!ownerCheck) throw new Error("Campaign not found or access denied");

  const { data: oldCampaign } = await supabase.from("campaigns").select("*").eq("id", id).single();

  const { error } = await supabase
    .from("campaigns")
    .update(payload)
    .eq("id", id);

  if (error) throw new Error(error.message);

  // Handle evaluation rubrics — versioned, never overwritten (CLAUDE.md:
  // "overwriting historical rubrics" is forbidden). A stage whose dimensions
  // changed gets a fresh active version; the old one is archived.
  await upsertRubricsVersioned(supabase, id, rubrics);

  // Handle SLA timers — delete & re-insert
  await supabase.from("sla_timers").delete().eq("campaign_id", id);
  if (slaTimers.length > 0) {
    await supabase.from("sla_timers").insert(
      slaTimers.map((s) => ({
        campaign_id: id,
        stage: s.stage,
        time_limit_hours: s.time_limit_hours,
        alert_threshold_hours: s.alert_threshold_hours,
        escalation_threshold_hours: s.escalation_threshold_hours,
      }))
    );
  }

  // Handle AI-interview availability rules — delete & re-insert
  await supabase.from("interview_availability_rules").delete().eq("campaign_id", id);
  if (availabilityRules.length > 0) {
    await supabase.from("interview_availability_rules").insert(
      availabilityRules.map((a) => ({
        campaign_id: id,
        weekday: a.weekday,
        start_minute: a.start_minute,
        end_minute: a.end_minute,
      }))
    );
  }

  await supabase.from("campaign_audit_log").insert({
    campaign_id: id,
    user_id: userId,
    action: "campaign_updated",
    entity_type: "campaign",
    entity_id: id,
    old_data: oldCampaign,
    new_data: { title: payload.title, status: payload.status },
  });
}

export async function cloneCampaignTx(id: string, source: Campaign, userId: string): Promise<string> {
  const supabase = await createClient();

  const { data: cloned, error } = await supabase
    .from("campaigns")
    .insert({
      title: `${source.title} (Copy)`,
      description: source.description,
      department: source.department,
      positions: source.positions,
      status: "draft" as CampaignStatus,
      accepting_applications: source.accepting_applications,
      deadline: source.deadline,
      deadline_enforced: source.deadline_enforced,
      location: source.location,
      automation_mode: source.automation_mode,
      resume_threshold: source.resume_threshold,
      screening_threshold: source.screening_threshold,
      interview_persona: source.interview_persona,
      interview_slot_minutes: source.interview_slot_minutes,
      interview_timezone: source.interview_timezone,
      interview_booking_horizon_days: source.interview_booking_horizon_days,
      user_id: userId,
    })
    .select()
    .single();

  if (error || !cloned) throw new Error(error?.message || "Failed to clone campaign");

  for (const rubric of source.rubrics) {
    const { data: newRubric } = await supabase
      .from("evaluation_rubrics")
      .insert({
        campaign_id: cloned.id,
        stage: rubric.stage,
        version: 1,
        is_active: true,
      })
      .select()
      .single();

    if (newRubric && rubric.dimensions?.length > 0) {
      await supabase.from("rubric_dimensions").insert(
        rubric.dimensions.map((d) => ({
          rubric_id: newRubric.id,
          name: d.name,
          importance: d.importance,
          weight: d.weight,
          is_mandatory: d.is_mandatory,
          min_score: d.min_score,
          max_score: d.max_score,
          sort_order: d.sort_order,
        }))
      );
    }
  }

  if (source.sla_timers.length > 0) {
    await supabase.from("sla_timers").insert(
      source.sla_timers.map((s) => ({
        campaign_id: cloned.id,
        stage: s.stage,
        time_limit_hours: s.time_limit_hours,
        alert_threshold_hours: s.alert_threshold_hours,
        escalation_threshold_hours: s.escalation_threshold_hours,
      }))
    );
  }

  if (source.interview_availability_rules.length > 0) {
    await supabase.from("interview_availability_rules").insert(
      source.interview_availability_rules.map((a) => ({
        campaign_id: cloned.id,
        weekday: a.weekday,
        start_minute: a.start_minute,
        end_minute: a.end_minute,
      }))
    );
  }

  await supabase.from("campaign_audit_log").insert({
    campaign_id: cloned.id,
    user_id: userId,
    action: "campaign_cloned",
    entity_type: "campaign",
    entity_id: cloned.id,
    new_data: { source_campaign_id: id },
  });

  return cloned.id;
}

// ─── Campaigns board summaries ───────────────────────────────────────────────

/**
 * One roll-up per campaign for the campaigns list: pipeline shape, and the one
 * thing the campaign needs from its owner.
 *
 * Two queries for the whole board rather than one per row — the list renders
 * every campaign a recruiter owns, so anything per-campaign is a fan-out that
 * grows with their history. `updated_at` comes back with the applications
 * because SLA lateness is computed from it (see `summariseCampaign`); the SLA
 * timers are already on the `Campaign` objects the page has. SELECT-only.
 */
export async function fetchCampaignBoardApplications(
  userId: string,
): Promise<BoardApplication[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("campaign_id, status, updated_at, campaigns!inner(user_id, deleted_at)")
    .eq("campaigns.user_id", userId)
    .is("campaigns.deleted_at", null);

  if (error || !data) return [];

  return (
    data as unknown as Array<{
      campaign_id: string;
      status: string;
      updated_at: string | null;
    }>
  ).map((row) => ({
    campaignId: row.campaign_id,
    status: row.status,
    // A row with no `updated_at` has never moved; treating it as "just now"
    // keeps it out of the overdue count rather than inventing infinite age.
    updatedAt: row.updated_at ?? new Date().toISOString(),
  }));
}

/**
 * How many screening questions each of the owner's campaigns has. A campaign
 * with none cannot approve anybody into screening, which the board flags — so
 * the count is only ever compared against zero. SELECT-only.
 */
export async function fetchScreeningQuestionCounts(
  userId: string,
): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("screening_questions")
    .select("campaign_id, campaigns!inner(user_id, deleted_at)")
    .eq("campaigns.user_id", userId)
    .is("campaigns.deleted_at", null);

  if (error || !data) return {};

  const counts: Record<string, number> = {};
  for (const row of data as unknown as Array<{ campaign_id: string }>) {
    counts[row.campaign_id] = (counts[row.campaign_id] ?? 0) + 1;
  }
  return counts;
}
