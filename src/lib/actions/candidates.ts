"use server";

import type { gmail_v1 } from "googleapis";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { uuidSchema, candidateStageSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";

// Services
import { fetchUnreadGmailResumes, getGmailMessage, getGmailAttachmentBuffer, markGmailMessageAsRead } from "@/lib/services/gmail";
import { parsePdf } from "@/lib/services/pdf";
import { extractResumeData, type ParsedResumeData } from "@/lib/services/openai";

// Data Access
import {
  uploadResumeToStorage,
  upsertCandidate,
  createApplicationIfNotExists,
  logAiAudit,
  fetchCandidatesByCampaignId,
  fetchCandidateById,
  updateApplicationStage,
  getResumeSignedUrl,
  saveResumeScore,
  advanceApplicationStatus
} from "@/lib/data/candidates";
import { scoreResumeAgainstCriteria } from "@/lib/actions/ai-generate";
import { fetchCampaignScoringConfig } from "@/lib/data/campaigns";
import type { Candidate, CandidateScore, CandidateStage, ScoreFactor, ScreeningTier } from "@/lib/constants";
import type { Database } from "@/types/database.types";

type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"];
type CandidateRow = Database["public"]["Tables"]["candidates"]["Row"];
type ApplicationWithCandidate = ApplicationRow & { candidates: CandidateRow };
type CandidateStageEnum = Database["public"]["Enums"]["candidate_stage_enum"];

/**
 * Action to trigger syncing of resumes from a Gmail inbox
 */
export async function syncResumesFromGmail(campaignId: string) {
  try {
    const supabase = await createClient();

    // Auth guard
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("Unauthorized");
    }

    // Rate limit: 5 Gmail syncs per 10 minutes per user
    checkRateLimit(user.id, { name: "gmail-sync", maxRequests: 5, windowMs: 10 * 60 * 1000 });

    // Find up to 5 recent unread emails with PDF attachments
    const messages = await fetchUnreadGmailResumes(5);

    if (messages.length === 0) {
      return { success: true, count: 0, message: "No new unread resumes found in Gmail." };
    }

    let processedCount = 0;

    for (const msg of messages) {
      if (!msg.id) continue;

      // Get the full message
      const msgData = await getGmailMessage(msg.id);
      const parts: gmail_v1.Schema$MessagePart[] = msgData.payload?.parts || [];
      const pdfParts = parts.filter((p) => p.mimeType === "application/pdf" && p.filename);

      for (const part of pdfParts) {
        if (!part.body?.attachmentId) continue;

        // Fetch attachment data
        const fileBuffer = await getGmailAttachmentBuffer(msg.id, part.body.attachmentId);
        if (!fileBuffer) continue;

        // 1. Upload to Supabase Storage
        const resumeUrl = await uploadResumeToStorage(campaignId, part.filename || "resume.pdf", fileBuffer);

        // 2. Parse PDF to Text locally
        const textContent = await parsePdf(fileBuffer);

        // 3. Extract JSON out of text using OpenAI
        const structuredData = await extractResumeData(textContent);

        // 4. Insert or Update Candidate Record
        const candidateId = await upsertCandidate(structuredData);

        // 5. Create Application link
        const applicationId = await createApplicationIfNotExists(candidateId, campaignId, resumeUrl, structuredData);

        // 6. Log to AI Audit Log
        await logAiAudit({
          campaignId,
          candidateId,
          textContent,
          filename: part.filename || "resume.pdf",
          structuredData,
        });

        // 7. Score resume against campaign criteria (if configured), then let
        //    the rule layer decide whether to advance. Scoring failures are
        //    non-blocking — the application still lands in `new` either way.
        try {
          const scored = await scoreApplicationResume(applicationId, campaignId, structuredData);
          if (scored) await evaluateResumeScoringOutcome(applicationId, scored.result, scored.config);
        } catch (scoreErr) {
          console.error("Resume scoring failed (non-blocking):", scoreErr);
        }

        processedCount++;
      }

      // Mark the email as READ so we don't process it again
      await markGmailMessageAsRead(msg.id);
    }

    revalidatePath(`/campaigns/${campaignId}`);
    return { success: true, count: processedCount, message: `Successfully synced ${processedCount} resume(s) from Gmail.` };

  } catch (error) {
    console.error("Gmail Sync Error:", error);
    throw new Error(error instanceof Error ? error.message : "Failed to sync resumes from Gmail");
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildScoresArray(row: Pick<ApplicationRow, "resume_score" | "screening_tier" | "score_rationale" | "score_factors" | "scored_at" | "created_at">): CandidateScore[] {
  if (row.resume_score == null) return [];
  return [{
    stage: "resume",
    overall: Number(row.resume_score),
    tier: (row.screening_tier as ScreeningTier | null) || undefined,
    ai_summary: row.score_rationale || "Scored by AI",
    factors: (row.score_factors as ScoreFactor[] | null) || [],
    scored_at: row.scored_at || row.created_at,
  }];
}

function normalizeStage(status: string): CandidateStage {
  return (status === "new" ? "applied" : status) as CandidateStage;
}

// ─── Regular Fetch Functions ──────────────────────────────────────────────

export async function getCandidatesByCampaignId(campaignId: string): Promise<Candidate[]> {
  const data = await fetchCandidatesByCampaignId(campaignId);
  if (!data) return [];

  return (data as ApplicationWithCandidate[]).map((app) => {
    const parsed = app.parsed_data as ParsedResumeData | null;
    return {
      id: app.id,
      campaign_id: app.campaign_id,
      name: `${app.candidates.first_name} ${app.candidates.last_name}`,
      email: app.candidates.email,
      phone: app.candidates.phone,
      current_title: parsed?.experience?.[0]?.title || null,
      current_company: parsed?.experience?.[0]?.company || null,
      stage: normalizeStage(app.status),
      scores: buildScoresArray(app),
      resume: {
        skills: parsed?.skills || [],
        experience_years: parsed?.experience?.length || 0,
        education: parsed?.education?.[0]?.institution || "Unknown",
      },
      applied_at: app.created_at,
      updated_at: app.updated_at,
    };
  });
}

export async function getCandidateById(applicationId: string) {
  const data = (await fetchCandidateById(applicationId)) as ApplicationWithCandidate | null;
  if (!data) return null;

  const candidateRecord = data.candidates;
  const parsed = data.parsed_data as ParsedResumeData | null;

  // Generate signed URL for resume if path exists
  const resumeSignedUrl = data.resume_url
    ? await getResumeSignedUrl(data.resume_url)
    : null;

  return {
    id: data.id,
    campaign_id: data.campaign_id,
    name: `${candidateRecord.first_name} ${candidateRecord.last_name}`,
    email: candidateRecord.email,
    phone: candidateRecord.phone,
    current_title: parsed?.experience?.[0]?.title || null,
    current_company: parsed?.experience?.[0]?.company || null,
    stage: normalizeStage(data.status),
    screening_tier: data.screening_tier || null,
    scores: buildScoresArray(data),
    applied_at: data.created_at,
    resume_url: resumeSignedUrl || "",
    resume: {
      skills: parsed?.skills || [],
      experience_years: parsed?.experience?.length || 0,
      education: parsed?.education?.[0]?.institution || "Unknown",
    },
    parsed_data: parsed,
    linkedin_url: candidateRecord.linkedin_url,
    portfolio_url: candidateRecord.portfolio_url,
  };
}

export async function updateCandidateStage(
  applicationId: string,
  stage: string,
  rationale?: string,
) {
  uuidSchema.parse(applicationId);
  candidateStageSchema.parse(stage);

  // Fetch campaign_id before updating so we can revalidate the right paths
  const supabase = await createClient();
  const { data: app } = await supabase
    .from("applications")
    .select("campaign_id")
    .eq("id", applicationId)
    .single();

  await updateApplicationStage(applicationId, stage as CandidateStageEnum, rationale);

  if (app?.campaign_id) {
    revalidatePath(`/campaigns/${app.campaign_id}`);
    revalidatePath(`/campaigns/${app.campaign_id}/candidates/${applicationId}`);
  }
}

// ─── Resume Scoring ─────────────────────────────────────────────────────────
// Scoring and transition are intentionally split: the AI layer only produces
// evidence; the rule layer reads that evidence and decides whether to
// transition. See CLAUDE.md → ATS State Machine Rules.

type CampaignScoringConfig = NonNullable<Awaited<ReturnType<typeof fetchCampaignScoringConfig>>>;
type ResumeScoreResult = Awaited<ReturnType<typeof scoreResumeAgainstCriteria>>;

/**
 * AI layer — produces and persists resume-score evidence. Never transitions.
 * Returns the score + scoring config so the rule layer can decide; returns
 * null if the campaign has no screening criteria configured.
 */
async function scoreApplicationResume(
  applicationId: string,
  campaignId: string,
  parsedResume: ParsedResumeData | Record<string, unknown>,
): Promise<{ result: ResumeScoreResult; config: CampaignScoringConfig } | null> {
  const config = await fetchCampaignScoringConfig(campaignId);
  if (!config || config.screening_criteria.length === 0) return null;

  const result = await scoreResumeAgainstCriteria(
    parsedResume,
    config.screening_criteria,
    config.description,
  );

  await saveResumeScore(
    applicationId,
    result.overall_score,
    result.tier as Database["public"]["Enums"]["screening_tier_enum"],
    result.rationale,
    result.factors,
  );

  return { result, config };
}

/**
 * Rule layer — reads persisted resume-score evidence and decides the next
 * transition. Never calls the AI. Keeping this separate from scoring is what
 * makes AI output "advisory, not authoritative" (CLAUDE.md → AI Usage Rules).
 *
 * Behaviour:
 *   - fully_auto:    pass threshold → `screening_approved`; else → `rejected`.
 *   - human_in_loop: any score        → `screening_review_pending` so a
 *                    recruiter reviews before the application advances.
 */
async function evaluateResumeScoringOutcome(
  applicationId: string,
  result: ResumeScoreResult,
  config: CampaignScoringConfig,
): Promise<void> {
  const scoreLine = `Resume score ${result.overall_score} vs threshold ${config.screening_threshold}`;

  if (config.automation_mode === "human_in_loop") {
    await advanceApplicationStatus(
      applicationId,
      "screening_review_pending",
      `${scoreLine} — awaiting recruiter review (HITL mode)`,
    );
    return;
  }

  if (result.overall_score >= config.screening_threshold) {
    await advanceApplicationStatus(
      applicationId,
      "screening_approved",
      `${scoreLine} — passed`,
    );
  } else {
    await advanceApplicationStatus(
      applicationId,
      "rejected",
      `${scoreLine} — below threshold`,
    );
  }
}

/**
 * Manually trigger resume scoring for an existing candidate.
 * Used when a candidate was imported before criteria were set up,
 * or to re-score after criteria changes.
 */
export async function scoreResume(applicationId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    checkRateLimit(user.id, { name: "ai-generate", maxRequests: 10, windowMs: 5 * 60 * 1000 });

    const data = (await fetchCandidateById(applicationId)) as ApplicationWithCandidate | null;
    if (!data) throw new Error("Application not found");

    const parsedResume = data.parsed_data as ParsedResumeData | null;
    if (!parsedResume) throw new Error("No parsed resume data available for scoring");

    const scored = await scoreApplicationResume(applicationId, data.campaign_id, parsedResume);
    if (scored) await evaluateResumeScoringOutcome(applicationId, scored.result, scored.config);

    revalidatePath(`/campaigns/${data.campaign_id}`);
    revalidatePath(`/campaigns/${data.campaign_id}/candidates/${applicationId}`);
    return { success: true };
  } catch (err) {
    console.error("scoreResume failed:", err);
    if (err instanceof Error) throw err;
    throw new Error(typeof err === "string" ? err : "Resume scoring failed");
  }
}
