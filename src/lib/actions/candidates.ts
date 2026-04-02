"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { uuidSchema, candidateStageSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";

// Services
import { fetchUnreadGmailResumes, getGmailMessage, getGmailAttachmentBuffer, markGmailMessageAsRead } from "@/lib/services/gmail";
import { parsePdf } from "@/lib/services/pdf";
import { extractResumeData } from "@/lib/services/openai";

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
      const parts = msgData.payload?.parts || [];
      const pdfParts = parts.filter((p: any) => p.mimeType === "application/pdf" && p.filename);

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

        // 7. Score resume against campaign criteria (if campaign has criteria)
        try {
          await scoreAndAdvanceCandidate(applicationId, campaignId, structuredData);
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

function buildScoresArray(row: any): any[] {
  if (!row.resume_score) return [];
  return [{
    stage: "resume",
    overall: Number(row.resume_score),
    tier: row.screening_tier || undefined,
    ai_summary: row.score_rationale || "Scored by AI",
    factors: row.score_factors || [],
    scored_at: row.scored_at || row.created_at,
  }];
}

function normalizeStage(status: string): string {
  return status === "new" ? "applied" : status;
}

// ─── Regular Fetch Functions ──────────────────────────────────────────────

export async function getCandidatesByCampaignId(campaignId: string) {
  const data = await fetchCandidatesByCampaignId(campaignId);
  if (!data) return [];

  return data.map((app: any) => ({
    id: app.id,
    campaign_id: app.campaign_id,
    name: `${app.candidates.first_name} ${app.candidates.last_name}`,
    email: app.candidates.email,
    phone: app.candidates.phone,
    current_title: app.parsed_data?.experience?.[0]?.title || null,
    current_company: app.parsed_data?.experience?.[0]?.company || null,
    stage: normalizeStage(app.status),
    screening_tier: app.screening_tier || null,
    scores: buildScoresArray(app),
    applied_at: app.created_at,
    resume_url: app.resume_url || "",
    resume_path: app.resume_url || "",
  })) as any[];
}

export async function getCandidateById(applicationId: string) {
  const data = await fetchCandidateById(applicationId);
  if (!data) return null;

  const candidateRecord = data.candidates as any;
  const parsed = data.parsed_data as any;

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
    stage: normalizeStage(data.status as string),
    screening_tier: (data as any).screening_tier || null,
    scores: buildScoresArray(data as any),
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
  } as any;
}

export async function updateCandidateStage(applicationId: string, stage: string) {
  uuidSchema.parse(applicationId);
  candidateStageSchema.parse(stage);
  await updateApplicationStage(applicationId, stage);
}

// ─── Resume Scoring ─────────────────────────────────────────────────────────

/**
 * Internal helper: score a candidate's resume and optionally auto-advance.
 * Used by both Gmail sync and manual scoring.
 */
async function scoreAndAdvanceCandidate(
  applicationId: string,
  campaignId: string,
  parsedResume: Record<string, unknown>
) {
  const config = await fetchCampaignScoringConfig(campaignId);
  if (!config || config.screening_criteria.length === 0) return;

  const result = await scoreResumeAgainstCriteria(
    parsedResume,
    config.screening_criteria,
    config.description
  );

  await saveResumeScore(
    applicationId,
    result.overall_score,
    result.tier,
    result.rationale,
    result.factors
  );

  if (config.automation_mode === "fully_auto") {
    if (result.overall_score >= config.screening_threshold) {
      await advanceApplicationStatus(applicationId, "screening");
    } else {
      await advanceApplicationStatus(applicationId, "rejected");
    }
  }
}

/**
 * Manually trigger resume scoring for an existing candidate.
 * Used when a candidate was imported before criteria were set up,
 * or to re-score after criteria changes.
 */
export async function scoreResume(applicationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  checkRateLimit(user.id, { name: "ai-generate", maxRequests: 10, windowMs: 5 * 60 * 1000 });

  // Fetch the application with parsed data
  const data = await fetchCandidateById(applicationId);
  if (!data) throw new Error("Application not found");

  const parsedResume = (data as any).parsed_data;
  if (!parsedResume) throw new Error("No parsed resume data available for scoring");

  await scoreAndAdvanceCandidate(applicationId, (data as any).campaign_id, parsedResume);

  revalidatePath(`/campaigns/${(data as any).campaign_id}`);
  return { success: true };
}
