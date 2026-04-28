import { createClient } from "@/lib/supabase/server";
import type {
  CampaignStatus,
  AutomationMode,
  InterviewPersona,
  Campaign,
  ScreeningCriterion,
  EvaluationRubric,
  RubricDimension,
  CampaignReviewer,
  SlaTimer,
  PipelineStageCount,
} from "@/lib/constants";
import type { Database } from "@/types/database.types";

type CampaignInsert = Database["public"]["Tables"]["campaigns"]["Insert"];
type CampaignUpdate = Database["public"]["Tables"]["campaigns"]["Update"];
type ScreeningCriterionRow = Database["public"]["Tables"]["screening_criteria"]["Row"];
type EvaluationRubricRow = Database["public"]["Tables"]["evaluation_rubrics"]["Row"];
type RubricDimensionRow = Database["public"]["Tables"]["rubric_dimensions"]["Row"];
type CampaignReviewerRow = Database["public"]["Tables"]["campaign_reviewers"]["Row"];
type SlaTimerRow = Database["public"]["Tables"]["sla_timers"]["Row"];

type RubricInput = {
  stage: "resume" | "screening_q" | "interview";
  dimensions?: Omit<RubricDimension, "id">[];
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
type ScreeningCriterionInput = Omit<ScreeningCriterion, "id">;

const DEFAULT_PIPELINE: PipelineStageCount[] = [
  { name: "Applied", key: "applied", count: 0 },
  { name: "Screening", key: "screening", count: 0 },
  { name: "Interview", key: "interview", count: 0 },
  { name: "Offer", key: "offer", count: 0 },
  { name: "Hired", key: "hired", count: 0 },
];

function assembleCampaign(
  row: Record<string, unknown>,
  screeningCriteria: ScreeningCriterion[],
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
    screening_criteria: screeningCriteria,
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

  const [criteriaRes, rubricsRes, dimensionsRes, reviewersRes, slaRes] =
    await Promise.all([
      supabase.from("screening_criteria").select("*").in("campaign_id", campaignIds).is("deleted_at", null),
      supabase.from("evaluation_rubrics").select("*").in("campaign_id", campaignIds).eq("is_active", true),
      supabase.from("rubric_dimensions").select("*").is("deleted_at", null),
      supabase.from("campaign_reviewers").select("*").in("campaign_id", campaignIds),
      supabase.from("sla_timers").select("*").in("campaign_id", campaignIds),
    ]);

  const criteriaByC = groupBy(criteriaRes.data || [], "campaign_id");
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

    const criteria = ((criteriaByC[row.id] || []) as ScreeningCriterionRow[]).map((c) => ({
      id: c.id,
      label: c.label,
      weight: c.weight,
      is_mandatory: c.is_mandatory,
    }));

    return assembleCampaign(row as unknown as Record<string, unknown>, criteria, rubrics, reviewers, slaTimers);
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

  const [criteriaRes, rubricsRes, reviewersRes, slaRes] = await Promise.all([
    supabase.from("screening_criteria").select("*").eq("campaign_id", id).is("deleted_at", null),
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

  const criteria: ScreeningCriterion[] = (criteriaRes.data || []).map((c) => ({
    id: c.id,
    label: c.label,
    weight: c.weight,
    is_mandatory: c.is_mandatory,
  }));

  return assembleCampaign(row as unknown as Record<string, unknown>, criteria, rubrics, reviewers, slaTimers);
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

  const { data: criteria } = await supabase
    .from("screening_criteria")
    .select("id, label, weight, is_mandatory")
    .eq("campaign_id", campaignId)
    .is("deleted_at", null);

  return {
    id: row.id as string,
    description: row.description as string,
    automation_mode: row.automation_mode as AutomationMode,
    screening_threshold: row.screening_threshold as number,
    screening_criteria: (criteria || []).map((c) => ({
      id: c.id,
      label: c.label,
      weight: c.weight,
      is_mandatory: c.is_mandatory,
    })),
  };
}

// ─── Mutation Helpers
export async function insertCampaignTx(
  payload: Omit<CampaignInsert, "user_id">,
  screeningCriteria: ScreeningCriterionInput[],
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

  // 2. Insert screening criteria
  if (screeningCriteria.length > 0) {
    await supabase.from("screening_criteria").insert(
      screeningCriteria.map((c, i) => ({
        campaign_id: campaign.id,
        label: c.label,
        weight: c.weight,
        is_mandatory: c.is_mandatory,
        sort_order: i,
      }))
    );
  }

  // 3. Insert rubrics and dimensions
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
        rubric.dimensions.map((d) => ({
          rubric_id: insertedRubric.id,
          name: d.name,
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
  screeningCriteria: Omit<ScreeningCriterion, "id">[],
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

  // Handle screening criteria — delete & re-insert
  await supabase.from("screening_criteria").delete().eq("campaign_id", id);
  if (screeningCriteria.length > 0) {
    await supabase.from("screening_criteria").insert(
      screeningCriteria.map((c, i) => ({
        campaign_id: id,
        label: c.label,
        weight: c.weight,
        is_mandatory: c.is_mandatory,
        sort_order: i,
      }))
    );
  }

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

  if (source.screening_criteria.length > 0) {
    await supabase.from("screening_criteria").insert(
      source.screening_criteria.map((c, i) => ({
        campaign_id: cloned.id,
        label: c.label,
        weight: c.weight,
        is_mandatory: c.is_mandatory,
        sort_order: i,
      }))
    );
  }

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
