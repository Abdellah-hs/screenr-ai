"use server";

import { redirect } from "next/navigation";
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_PIPELINE: PipelineStageCount[] = [
  { name: "Applied", key: "applied", count: 0 },
  { name: "Screening", key: "screening", count: 0 },
  { name: "Interview", key: "interview", count: 0 },
  { name: "Offer", key: "offer", count: 0 },
  { name: "Hired", key: "hired", count: 0 },
];

/**
 * Assemble a Campaign object from database rows.
 * The campaigns table stores core fields; related data comes from joined tables.
 */
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

// ─── GET all campaigns ───────────────────────────────────────────────────────

export async function getCampaigns(): Promise<Campaign[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: rows, error } = await supabase
    .from("campaigns")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error || !rows) return [];

  // Fetch related data for all campaigns in batch
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
    const rubrics = (rubricsByC[row.id] || []).map((r) => ({
      id: r.id,
      campaign_id: r.campaign_id,
      stage: r.stage as "resume" | "screening_q" | "interview",
      version: r.version,
      is_active: r.is_active,
      dimensions: (dimensionsByR[r.id] || []).map((d) => ({
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

    const reviewers = (reviewersByC[row.id] || []).map((r) => ({
      id: r.id,
      user_id: r.user_id,
      name: "",
      email: "",
      avatar_url: null,
      role: r.role as "lead" | "reviewer" | "observer",
      assigned_at: r.assigned_at,
    }));

    const slaTimers = (slaByC[row.id] || []).map((s) => ({
      stage: s.stage as SlaTimer["stage"],
      time_limit_hours: s.time_limit_hours,
      alert_threshold_hours: s.alert_threshold_hours,
      escalation_threshold_hours: s.escalation_threshold_hours,
    }));

    const criteria = (criteriaByC[row.id] || []).map((c) => ({
      id: c.id,
      label: c.label,
      weight: c.weight,
      is_mandatory: c.is_mandatory,
    }));

    return assembleCampaign(row, criteria, rubrics, reviewers, slaTimers);
  });
}

// ─── GET single campaign ─────────────────────────────────────────────────────

export async function getCampaignById(id: string): Promise<Campaign | null> {
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error || !row) return null;

  const [criteriaRes, rubricsRes, reviewersRes, slaRes] = await Promise.all([
    supabase.from("screening_criteria").select("*").eq("campaign_id", id).is("deleted_at", null),
    supabase.from("evaluation_rubrics").select("*").eq("campaign_id", id).eq("is_active", true),
    supabase.from("campaign_reviewers").select("*").eq("campaign_id", id),
    supabase.from("sla_timers").select("*").eq("campaign_id", id),
  ]);

  // Fetch dimensions for active rubrics
  const rubricIds = (rubricsRes.data || []).map((r) => r.id);
  const dimensionsRes = rubricIds.length > 0
    ? await supabase.from("rubric_dimensions").select("*").in("rubric_id", rubricIds).is("deleted_at", null)
    : { data: [] };

  const dimensionsByR = groupBy(dimensionsRes.data || [], "rubric_id");

  const rubrics: EvaluationRubric[] = (rubricsRes.data || []).map((r) => ({
    id: r.id,
    campaign_id: r.campaign_id,
    stage: r.stage as "resume" | "screening_q" | "interview",
    version: r.version,
    is_active: r.is_active,
    dimensions: (dimensionsByR[r.id] || []).map((d) => ({
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
    role: r.role as "lead" | "reviewer" | "observer",
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

  return assembleCampaign(row, criteria, rubrics, reviewers, slaTimers);
}

// ─── CREATE campaign ─────────────────────────────────────────────────────────

export async function createCampaign(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const department = (formData.get("department") as string) || null;
  const positions = parseInt(formData.get("positions") as string) || 1;
  const status = (formData.get("status") as CampaignStatus) || "draft";
  const deadline = (formData.get("deadline") as string) || null;
  const location = (formData.get("location") as string) || null;
  const automationMode = (formData.get("automation_mode") as AutomationMode) || "human_in_loop";
  const rawThreshold = parseInt(formData.get("screening_threshold") as string);
  const screeningThreshold = Number.isNaN(rawThreshold) ? 70 : Math.min(100, Math.max(0, rawThreshold));
  const interviewPersona = (formData.get("interview_persona") as InterviewPersona) || "neutral";

  // Parse related data from JSON hidden inputs
  let screeningCriteria: ScreeningCriterion[] = [];
  let rubrics: EvaluationRubric[] = [];
  let slaTimers: SlaTimer[] = [];
  let reviewers: CampaignReviewer[] = [];

  try { screeningCriteria = JSON.parse(formData.get("screening_criteria_json") as string || "[]"); } catch { /* keep empty */ }
  try { rubrics = JSON.parse(formData.get("rubrics_json") as string || "[]"); } catch { /* keep empty */ }
  try { slaTimers = JSON.parse(formData.get("sla_timers_json") as string || "[]"); } catch { /* keep empty */ }
  try { reviewers = JSON.parse(formData.get("reviewers_json") as string || "[]"); } catch { /* keep empty */ }

  // 1. Insert campaign
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({
      title,
      description,
      department,
      positions,
      status,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      location,
      automation_mode: automationMode,
      screening_threshold: screeningThreshold,
      interview_persona: interviewPersona,
      user_id: user.id,
    })
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

    if (insertedRubric && rubric.dimensions?.length > 0) {
      await supabase.from("rubric_dimensions").insert(
        rubric.dimensions.map((d: RubricDimension) => ({
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

  // 5. Insert reviewers (using logged-in user as placeholder reviewer)
  if (reviewers.length > 0) {
    await supabase.from("campaign_reviewers").insert(
      reviewers.map((r) => ({
        campaign_id: campaign.id,
        user_id: r.user_id || user.id,
        role: r.role,
      }))
    );
  }

  // 6. Write audit log entry
  await supabase.from("campaign_audit_log").insert({
    campaign_id: campaign.id,
    user_id: user.id,
    action: "campaign_created",
    entity_type: "campaign",
    entity_id: campaign.id,
    new_data: { title, status },
  });

  redirect(`/campaigns/${campaign.id}`);
}

// ─── UPDATE campaign ─────────────────────────────────────────────────────────

export async function updateCampaign(id: string, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const department = (formData.get("department") as string) || null;
  const positions = parseInt(formData.get("positions") as string) || 1;
  const status = (formData.get("status") as CampaignStatus) || "draft";
  const deadline = (formData.get("deadline") as string) || null;
  const location = (formData.get("location") as string) || null;
  const automationMode = (formData.get("automation_mode") as AutomationMode) || "human_in_loop";
  const rawThreshold = parseInt(formData.get("screening_threshold") as string);
  const screeningThreshold = Number.isNaN(rawThreshold) ? 70 : Math.min(100, Math.max(0, rawThreshold));
  const interviewPersona = (formData.get("interview_persona") as InterviewPersona) || "neutral";

  // Fetch old data for audit log
  const { data: oldCampaign } = await supabase.from("campaigns").select("*").eq("id", id).single();

  // Update campaign
  const { error } = await supabase
    .from("campaigns")
    .update({
      title,
      description,
      department,
      positions,
      status,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      location,
      automation_mode: automationMode,
      screening_threshold: screeningThreshold,
      interview_persona: interviewPersona,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  // Handle screening criteria — delete & re-insert (simple strategy)
  const screeningCriteriaJson = formData.get("screening_criteria_json") as string;
  if (screeningCriteriaJson) {
    try {
      const criteria: ScreeningCriterion[] = JSON.parse(screeningCriteriaJson);
      await supabase.from("screening_criteria").delete().eq("campaign_id", id);
      if (criteria.length > 0) {
        await supabase.from("screening_criteria").insert(
          criteria.map((c, i) => ({
            campaign_id: id,
            label: c.label,
            weight: c.weight,
            is_mandatory: c.is_mandatory,
            sort_order: i,
          }))
        );
      }
    } catch { /* ignore parse errors */ }
  }

  // Handle SLA timers — delete & re-insert
  const slaTimersJson = formData.get("sla_timers_json") as string;
  if (slaTimersJson) {
    try {
      const timers: SlaTimer[] = JSON.parse(slaTimersJson);
      await supabase.from("sla_timers").delete().eq("campaign_id", id);
      if (timers.length > 0) {
        await supabase.from("sla_timers").insert(
          timers.map((s) => ({
            campaign_id: id,
            stage: s.stage,
            time_limit_hours: s.time_limit_hours,
            alert_threshold_hours: s.alert_threshold_hours,
            escalation_threshold_hours: s.escalation_threshold_hours,
          }))
        );
      }
    } catch { /* ignore parse errors */ }
  }

  // Write audit log
  await supabase.from("campaign_audit_log").insert({
    campaign_id: id,
    user_id: user.id,
    action: "campaign_updated",
    entity_type: "campaign",
    entity_id: id,
    old_data: oldCampaign,
    new_data: { title, status },
  });

  redirect(`/campaigns/${id}`);
}

// ─── CLONE campaign ──────────────────────────────────────────────────────────

export async function cloneCampaign(id: string) {
  const source = await getCampaignById(id);
  if (!source) throw new Error("Campaign not found");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // 1. Insert cloned campaign
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
      user_id: user.id,
    })
    .select()
    .single();

  if (error || !cloned) throw new Error(error?.message || "Failed to clone campaign");

  // 2. Clone screening criteria
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

  // 3. Clone rubrics + dimensions
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

  // 4. Clone SLA timers
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

  // 5. Write audit log
  await supabase.from("campaign_audit_log").insert({
    campaign_id: cloned.id,
    user_id: user.id,
    action: "campaign_cloned",
    entity_type: "campaign",
    entity_id: cloned.id,
    new_data: { source_campaign_id: id },
  });

  redirect(`/campaigns/${cloned.id}`);
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function groupBy<T extends Record<string, unknown>>(arr: T[], key: string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = item[key] as string;
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}
