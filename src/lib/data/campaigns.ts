import { createClient } from "@/lib/supabase/server";
import type {
  CampaignStatus,
  AutomationMode,
  InterviewPersona,
  Campaign,
  EvaluationRubric,
  DimensionImportance,
  CampaignReviewer,
  SlaTimer,
  PipelineStageCount,
} from "@/lib/constants";
import { deriveDimensionFields } from "@/lib/rubric-weights";
import type { Database } from "@/types/database.types";

type CampaignInsert = Database["public"]["Tables"]["campaigns"]["Insert"];
type CampaignUpdate = Database["public"]["Tables"]["campaigns"]["Update"];
type EvaluationRubricRow = Database["public"]["Tables"]["evaluation_rubrics"]["Row"];
type RubricDimensionRow = Database["public"]["Tables"]["rubric_dimensions"]["Row"];
type CampaignReviewerRow = Database["public"]["Tables"]["campaign_reviewers"]["Row"];
type SlaTimerRow = Database["public"]["Tables"]["sla_timers"]["Row"];

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

const DEFAULT_PIPELINE: PipelineStageCount[] = [
  { name: "Applied", key: "applied", count: 0 },
  { name: "Screening", key: "screening", count: 0 },
  { name: "Interview", key: "interview", count: 0 },
  { name: "Offer", key: "offer", count: 0 },
  { name: "Hired", key: "hired", count: 0 },
];

function assembleCampaign(
  row: Record<string, unknown>,
  rubrics: EvaluationRubric[],
  reviewers: CampaignReviewer[],
  slaTimers: SlaTimer[]
): Campaign {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    department: (row.department as string) || null,
    positions: row.positions as number,
    status: row.status as CampaignStatus,
    deadline: (row.deadline as string) || null,
    location: (row.location as string) || null,
    timezone: (row.timezone as string) || null,
    automation_mode: row.automation_mode as AutomationMode,
    screening_threshold: row.screening_threshold as number,
    interview_persona: row.interview_persona as InterviewPersona,
    rubrics,
    reviewers,
    sla_timers: slaTimers,
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

  const [rubricsRes, dimensionsRes, reviewersRes, slaRes] =
    await Promise.all([
      supabase.from("evaluation_rubrics").select("*").in("campaign_id", campaignIds).eq("is_active", true),
      supabase.from("rubric_dimensions").select("*").is("deleted_at", null),
      supabase.from("campaign_reviewers").select("*").in("campaign_id", campaignIds),
      supabase.from("sla_timers").select("*").in("campaign_id", campaignIds),
    ]);

  const rubricsByC = groupBy(rubricsRes.data || [], "campaign_id");
  const dimensionsByR = groupBy(dimensionsRes.data || [], "rubric_id");
  const reviewersByC = groupBy(reviewersRes.data || [], "campaign_id");
  const slaByC = groupBy(slaRes.data || [], "campaign_id");

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

    return assembleCampaign(row as unknown as Record<string, unknown>, rubrics, reviewers, slaTimers);
  });
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

  const [rubricsRes, reviewersRes, slaRes] = await Promise.all([
    supabase.from("evaluation_rubrics").select("*").eq("campaign_id", id).eq("is_active", true),
    supabase.from("campaign_reviewers").select("*").eq("campaign_id", id),
    supabase.from("sla_timers").select("*").eq("campaign_id", id),
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

  return assembleCampaign(row as unknown as Record<string, unknown>, rubrics, reviewers, slaTimers);
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

// ─── Lightweight query for scoring pipeline (avoids loading rubrics, reviewers, SLAs)
export async function fetchCampaignScoringConfig(campaignId: string, userId: string) {
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("campaigns")
    .select("id, description, automation_mode, screening_threshold")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single();

  if (!row) return null;

  // Resume scoring is driven by the active `resume` evaluation rubric — the
  // single source of truth for "how to score a CV" (issue #65). Each rubric
  // dimension maps to a scoring criterion; `min_score` is that dimension's
  // per-criterion knockout fail line (consumed by the rule layer).
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
        .select("id, name, weight, is_mandatory, min_score, sort_order")
        .eq("rubric_id", resumeRubric.id)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
    : { data: [] };

  return {
    id: row.id as string,
    description: row.description as string,
    automation_mode: row.automation_mode as AutomationMode,
    screening_threshold: row.screening_threshold as number,
    screening_criteria: (dimensions || []).map((d) => ({
      id: d.id,
      label: d.name,
      weight: d.weight,
      is_mandatory: d.is_mandatory,
      min_score: d.min_score,
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
): Promise<number | null> {
  const supabase = await createClient();
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
        deriveDimensionFields(dims).map((d) => ({
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
  userId: string
): Promise<string> {
  const supabase = await createClient();

  // 1. Insert campaign
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({ ...payload, user_id: userId })
    .select()
    .single();

  if (error || !campaign) throw new Error(error?.message || "Failed to create campaign");

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
        deriveDimensionFields(rubric.dimensions).map((d) => ({
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
      deadline: source.deadline,
      location: source.location,
      automation_mode: source.automation_mode,
      screening_threshold: source.screening_threshold,
      interview_persona: source.interview_persona,
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
