import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";
import type { ParsedResumeData } from "@/lib/services/openai";
import type { Database, Json } from "@/types/database.types";
import { transitionApplication } from "@/lib/data/transitions";
import type { ApplicationState } from "@/lib/constants";

type CandidateStageEnum = Database["public"]["Enums"]["candidate_stage_enum"];
type ScreeningTierEnum = Database["public"]["Enums"]["screening_tier_enum"];

export async function uploadResumeToStorage(campaignId: string, filename: string, fileBuffer: Buffer): Promise<string> {
  const supabase = await createClient();
  const filePath = `${campaignId}/${randomUUID()}-${filename}`;
  const { error: uploadError } = await supabase.storage
    .from("resumes")
    .upload(filePath, fileBuffer, { contentType: "application/pdf" });

  if (uploadError) throw uploadError;

  // Store the path, not a public URL — generate signed URLs on demand
  return filePath;
}

/**
 * Generate a time-limited signed URL for a resume file.
 * Expires after 1 hour (3600 seconds).
 */
export async function getResumeSignedUrl(filePath: string): Promise<string | null> {
  if (!filePath) return null;
  const supabase = await createClient();

  // Auth guard
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.storage
    .from("resumes")
    .createSignedUrl(filePath, 3600);

  if (error || !data) return null;
  return data.signedUrl;
}

export async function upsertCandidate(structuredData: ParsedResumeData): Promise<string> {
  const supabase = await createClient();

  const { data: existingCandidate } = await supabase
    .from("candidates")
    .select("id")
    .eq("email", structuredData.email)
    .single();

  if (existingCandidate) {
    const candidateId = existingCandidate.id;
    // Update details
    await supabase.from("candidates").update({
      first_name: structuredData.first_name,
      last_name: structuredData.last_name,
      phone: structuredData.phone || null,
      linkedin_url: structuredData.linkedin_url || null,
      portfolio_url: structuredData.portfolio_url || null,
      location: structuredData.location || null,
      updated_at: new Date().toISOString()
    }).eq("id", candidateId);

    return candidateId;
  } else {
    // Insert new
    const candidateId = randomUUID();
    const { error: insertError } = await supabase
      .from("candidates")
      .insert({
        id: candidateId,
        first_name: structuredData.first_name,
        last_name: structuredData.last_name,
        email: structuredData.email,
        phone: structuredData.phone || null,
        linkedin_url: structuredData.linkedin_url || null,
        portfolio_url: structuredData.portfolio_url || null,
        location: structuredData.location || null,
      });

    if (insertError) throw insertError;
    return candidateId;
  }
}

export async function createApplicationIfNotExists(
  candidateId: string,
  campaignId: string,
  resumeUrl: string,
  structuredData: ParsedResumeData
): Promise<string> {
  const supabase = await createClient();

  const { data: existingApp } = await supabase
    .from("applications")
    .select("id, resume_url")
    .eq("candidate_id", candidateId)
    .eq("campaign_id", campaignId)
    .single();

  if (existingApp) {
    // Resubmission: latest CV wins. Overwrite resume_url + parsed_data,
    // but leave recruiter-owned status/score fields alone — scoring re-runs
    // afterwards and will refresh them if criteria are configured.
    const { error: updateError } = await supabase
      .from("applications")
      .update({
        resume_url: resumeUrl,
        parsed_data: structuredData as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingApp.id);

    if (updateError) {
      throw new Error(`Failed to update application on resubmission: ${updateError.message}`);
    }

    // Breadcrumb so recruiters/auditors can trace the replacement.
    await supabase.from("ai_audit_log").insert({
      campaign_id: campaignId,
      candidate_id: candidateId,
      stage: "resume_resubmission",
      model: "system",
      prompt_version: "v1",
      input_snapshot: {
        previous_resume_url: existingApp.resume_url,
        new_resume_url: resumeUrl,
      },
      raw_output: "",
      action_taken: "resume_replaced",
    });

    return existingApp.id;
  }

  const { data: newApp, error } = await supabase.from("applications").insert({
    candidate_id: candidateId,
    campaign_id: campaignId,
    status: "new",
    resume_url: resumeUrl,
    parsed_data: structuredData as unknown as Json,
  }).select("id").single();

  if (error || !newApp) throw new Error("Failed to create application");
  return newApp.id;
}

export async function logAiAudit(params: {
  campaignId: string;
  candidateId: string;
  textContent: string;
  filename: string;
  structuredData: ParsedResumeData;
}) {
  const supabase = await createClient();

  await supabase.from("ai_audit_log").insert({
    campaign_id: params.campaignId,
    candidate_id: params.candidateId,
    stage: "resume_parsing",
    model: "gpt-4o-mini",
    prompt_version: "v1_structured_outputs",
    input_snapshot: { text_length: params.textContent.length, filename: params.filename },
    raw_output: JSON.stringify(params.structuredData),
    action_taken: "parsed_and_created_profile",
  });
}

export async function fetchCandidatesByCampaignId(campaignId: string) {
  const supabase = await createClient();

  // Auth guard
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Ownership check: verify user owns the campaign
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .single();
  if (!campaign) throw new Error("Campaign not found or access denied");

  const { data, error } = await supabase
    .from("applications")
    .select(`
      *,
      candidates (
        id,
        first_name,
        last_name,
        email,
        phone,
        location
      )
    `)
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching candidates:", error);
    return [];
  }

  return data;
}

export async function fetchCandidateById(applicationId: string) {
  const supabase = await createClient();

  // Auth guard
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("applications")
    .select(`
      *,
      candidates (
        id,
        first_name,
        last_name,
        email,
        phone,
        location,
        linkedin_url,
        portfolio_url
      )
    `)
    .eq("id", applicationId)
    .single();

  if (error || !data) {
    console.error("Error fetching candidate:", error);
    return null;
  }

  // Ownership check: verify the application belongs to a campaign the user owns
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", data.campaign_id)
    .eq("user_id", user.id)
    .single();

  if (!campaign) throw new Error("Access denied");

  return data;
}

export async function saveResumeScore(
  applicationId: string,
  score: number,
  tier: ScreeningTierEnum,
  rationale: string,
  factors: { name: string; weight: number; score: number }[]
) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error, data } = await supabase
    .from("applications")
    .update({
      resume_score: score,
      screening_tier: tier,
      score_rationale: rationale,
      score_factors: factors as unknown as Json,
      scored_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicationId)
    .select("id");

  if (error) {
    console.error("saveResumeScore failed:", error);
    throw new Error(`Failed to save resume score: ${error.message}${error.details ? ` (${error.details})` : ""}`);
  }
  if (!data || data.length === 0) {
    throw new Error("Failed to save resume score: application not found or access denied");
  }
}

/**
 * System-driven advancement (rule-based, e.g. resume scoring passes threshold).
 * Delegates to transitionApplication() so validation + audit log stay consistent.
 */
export async function advanceApplicationStatus(
  applicationId: string,
  newStatus: CandidateStageEnum,
  rationale?: string,
) {
  await transitionApplication({
    applicationId,
    toState: newStatus as ApplicationState,
    actor: "system",
    rationale,
  });
}

/**
 * Recruiter-driven stage change (manual override from the UI).
 * Rationale is required per the ATS state-machine rules; we default to a
 * generic label until the UI is updated to prompt for it.
 */
export async function updateApplicationStage(
  applicationId: string,
  stage: CandidateStageEnum,
  rationale?: string,
) {
  await transitionApplication({
    applicationId,
    toState: stage as ApplicationState,
    actor: "recruiter",
    rationale: rationale?.trim() || "Manual stage change (rationale not provided)",
  });
}
