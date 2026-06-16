import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";
import type { ParsedResumeData } from "@/lib/services/openai";
import type { Database, Json } from "@/types/database.types";
import { transitionApplication } from "@/lib/data/transitions";
import { verifyCampaignOwnership } from "@/lib/data/campaigns";
import type { ApplicationState } from "@/lib/constants";
import {
  findCandidateByEmail,
  findCandidateByPhone,
  flagDuplicateCandidate,
  type MatchSignals,
} from "@/lib/data/duplicate-flags";

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

  const { data, error } = await supabase.storage
    .from("resumes")
    .createSignedUrl(filePath, 3600);

  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Insert a candidate from parsed resume data, flagging duplicates instead of
 * auto-merging.
 *
 * Why: PRD requires HR review for duplicates across channels, not silent
 * merges. We always insert the new record so the application can proceed,
 * then queue a flag for HR if email or phone matches an existing candidate.
 * HR resolves via mergeCandidatesTx (approve) or by leaving both records
 * separate (reject). The action layer guarantees `email` is non-null before
 * calling — the parameter type encodes that precondition.
 */
export async function upsertCandidate(
  structuredData: ParsedResumeData & { email: string },
): Promise<string> {
  const supabase = await createClient();

  const [matchedByEmail, matchedByPhone] = await Promise.all([
    findCandidateByEmail(structuredData.email),
    structuredData.phone ? findCandidateByPhone(structuredData.phone) : Promise.resolve(null),
  ]);

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

  const matchedCandidateId = matchedByEmail?.id ?? matchedByPhone?.id ?? null;
  if (matchedCandidateId) {
    const matchSignals: MatchSignals = {
      email_match: !!matchedByEmail,
      phone_match: !!matchedByPhone,
      matched_email: matchedByEmail ? structuredData.email : undefined,
      matched_phone: matchedByPhone ? structuredData.phone ?? null : undefined,
    };
    await flagDuplicateCandidate({
      candidateId,
      matchedCandidateId,
      matchSignals,
    });
  }

  return candidateId;
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

export async function fetchCandidatesByCampaignId(campaignId: string, userId: string) {
  if (!(await verifyCampaignOwnership(campaignId, userId))) {
    throw new Error("Campaign not found or access denied");
  }
  const supabase = await createClient();

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
      ),
      screening_question_responses (
        overall_score,
        overall_rationale,
        scored_at,
        rubric_version,
        status
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

export async function fetchCandidateById(applicationId: string, userId: string) {
  const supabase = await createClient();

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
      ),
      screening_question_responses (
        overall_score,
        overall_rationale,
        scored_at,
        rubric_version,
        status
      )
    `)
    .eq("id", applicationId)
    .single();

  if (error || !data) {
    console.error("Error fetching candidate:", error);
    return null;
  }

  if (!(await verifyCampaignOwnership(data.campaign_id, userId))) {
    throw new Error("Access denied");
  }

  return data;
}

export interface ResumeScoreAuditFields {
  model: string;
  promptVersion: string;
  rawOutput: string;
  inputSnapshot: Json;
}

/**
 * Persist a resume score AND its audit-log evidence. Per CLAUDE.md's
 * "Mandatory AI Output Persistence" rule every AI score must have a matching
 * `ai_audit_log` row — this function is the only sanctioned writer of the
 * pair, so a score cannot exist without its audit row.
 *
 * Write order: application update first, then audit insert. If the audit
 * insert fails the function throws — the score is already on the row, so
 * the caller sees the failure and can decide whether to surface it.
 *
 * `rubricVersion` is the resume-stage `evaluation_rubrics.version` that
 * was active at score time. Stamped both on the application row and on
 * the audit row so the UI can flag scores produced against a stale rubric
 * (issue #36). Pass null when no active rubric exists for the campaign.
 */
export async function saveResumeScore(args: {
  applicationId: string;
  campaignId: string;
  candidateId: string;
  score: number;
  tier: ScreeningTierEnum;
  rationale: string;
  factors: { name: string; weight: number; score: number }[];
  rubricVersion: number | null;
  audit: ResumeScoreAuditFields;
}) {
  const supabase = await createClient();

  const { error: updateError, data: updateData } = await supabase
    .from("applications")
    .update({
      resume_score: args.score,
      screening_tier: args.tier,
      score_rationale: args.rationale,
      score_factors: args.factors as unknown as Json,
      rubric_version: args.rubricVersion,
      scored_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.applicationId)
    .select("id");

  if (updateError) {
    console.error("saveResumeScore failed:", updateError);
    throw new Error(`Failed to save resume score: ${updateError.message}${updateError.details ? ` (${updateError.details})` : ""}`);
  }
  if (!updateData || updateData.length === 0) {
    throw new Error("Failed to save resume score: application not found or access denied");
  }

  const { error: auditError } = await supabase.from("ai_audit_log").insert({
    campaign_id: args.campaignId,
    candidate_id: args.candidateId,
    stage: "resume_scoring",
    model: args.audit.model,
    prompt_version: args.audit.promptVersion,
    rubric_version: args.rubricVersion != null ? String(args.rubricVersion) : null,
    input_snapshot: args.audit.inputSnapshot,
    raw_output: args.audit.rawOutput,
    parsed_score: args.score,
    rationale: args.rationale,
    action_taken: "scored",
  });

  if (auditError) {
    throw new Error(
      `Resume scored but audit log write failed (compliance gap): ${auditError.message}`,
    );
  }
}

/**
 * Minimal read used by action code that only needs to revalidate cache paths
 * for an application's owning campaign.
 */
export async function fetchApplicationCampaignId(
  applicationId: string
): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("applications")
    .select("campaign_id")
    .eq("id", applicationId)
    .single();
  return data?.campaign_id ?? null;
}

/**
 * Unauthenticated read used by the public candidate-response page. Looks up
 * an application + its owning campaign's title without any user scoping — the
 * caller must have already verified a signed token, since RLS alone is not
 * enough to gate this join.
 */
export interface ApplicationForResponse {
  application_id: string;
  campaign_id: string;
  campaign_title: string;
}

export async function fetchApplicationForResponse(
  applicationId: string
): Promise<ApplicationForResponse | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("applications")
    .select("id, campaign_id, campaigns!inner(id, title)")
    .eq("id", applicationId)
    .single<{
      id: string;
      campaign_id: string;
      campaigns: { id: string; title: string };
    }>();

  if (!data) return null;
  return {
    application_id: data.id,
    campaign_id: data.campaign_id,
    campaign_title: data.campaigns.title,
  };
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
 * Recruiter-driven stage change (manual override from the UI). The caller
 * must supply a written rationale — manual overrides without one are
 * forbidden by the ATS state-machine rules. Whether the transition is legal
 * from the current state is validated inside transitionApplication().
 */
export async function updateApplicationStage(
  applicationId: string,
  toState: ApplicationState,
  rationale: string,
) {
  await transitionApplication({
    applicationId,
    toState,
    actor: "recruiter",
    rationale,
  });
}

export interface ApplicationEmailContext {
  candidateName: string;
  candidateEmail: string;
  campaignTitle: string;
}

/**
 * Minimal candidate + campaign read for composing a transition email.
 * No ownership check — the calling action has already authorized the
 * transition that triggered the notification. Returns null if the
 * application is missing or the candidate has no email on file.
 */
export async function fetchApplicationEmailContext(
  applicationId: string,
): Promise<ApplicationEmailContext | null> {
  const supabase = await createClient();

  const select = `campaigns!inner ( title ), candidates!inner ( first_name, last_name, email )`;
  const { data, error } = await supabase
    .from("applications")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select(select as any)
    .eq("id", applicationId)
    .single();

  if (error || !data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  if (!row.candidates?.email) return null;

  return {
    candidateName:
      `${row.candidates.first_name ?? ""} ${row.candidates.last_name ?? ""}`.trim() ||
      row.candidates.email,
    candidateEmail: row.candidates.email,
    campaignTitle: row.campaigns?.title ?? "the role",
  };
}
