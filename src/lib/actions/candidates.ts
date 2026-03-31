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
  getResumeSignedUrl
} from "@/lib/data/candidates";

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
        await createApplicationIfNotExists(candidateId, campaignId, resumeUrl, structuredData);

        // 6. Log to AI Audit Log
        await logAiAudit(campaignId, candidateId, textContent, part.filename || "resume.pdf", structuredData);

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

// ─── Regular Fetch Functions ──────────────────────────────────────────────

export async function getCandidatesByCampaignId(campaignId: string) {
  const data = await fetchCandidatesByCampaignId(campaignId);
  if (!data) return [];

  return data.map((app: any) => ({
    id: app.id, // we map application ID as candidate trace ID here
    campaign_id: app.campaign_id,
    name: `${app.candidates.first_name} ${app.candidates.last_name}`,
    email: app.candidates.email,
    phone: app.candidates.phone,
    current_title: app.parsed_data?.experience?.[0]?.title || null,
    current_company: app.parsed_data?.experience?.[0]?.company || null,
    stage: app.status === "new" ? "applied" : app.status,
    scores: [
      // Mocking or mapping CandidateScore objects
      ...(app.resume_score ? [{
        stage: "resume",
        overall: Number(app.resume_score),
        ai_summary: "Parsed from resume",
        factors: [],
        scored_at: app.created_at
      }] : [])
    ] as any[],
    applied_at: app.created_at,
    resume_url: app.resume_url || "",
    resume_path: app.resume_url || "" // storage path for signed URL generation
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
    stage: data.status === "new" ? "applied" : data.status,
    scores: [
      ...(data.resume_score ? [{
        stage: "resume",
        overall: Number(data.resume_score),
        ai_summary: "Parsed from resume",
        factors: [],
        scored_at: data.created_at
      }] : [])
    ],
    applied_at: data.created_at,
    resume_url: resumeSignedUrl || "",
    // Add missing resume object for UI
    resume: {
      skills: parsed?.skills || [],
      experience_years: parsed?.experience?.length || 0,
      education: parsed?.education?.[0]?.institution || "Unknown"
    },
    parsed_data: parsed,
    linkedin_url: candidateRecord.linkedin_url,
    portfolio_url: candidateRecord.portfolio_url
  } as any;
}

export async function updateCandidateStage(applicationId: string, stage: string) {
  uuidSchema.parse(applicationId);
  candidateStageSchema.parse(stage);
  await updateApplicationStage(applicationId, stage);
}
