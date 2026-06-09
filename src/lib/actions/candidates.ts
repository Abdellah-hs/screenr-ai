"use server";

import type { gmail_v1 } from "googleapis";
import { revalidatePath } from "next/cache";
import {
  uuidSchema,
  applicationStateSchema,
  stageChangeRationaleSchema,
  hitlReviewDecisionSchema,
} from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/auth/guards";
import { transitionApplication } from "@/lib/data/transitions";
import { sendTransitionNotification } from "./transition-notifications";
import { sendScreeningQuestionsToCandidate } from "./screening-questions";

// Services
import {
  fetchUnreadGmailResumes,
  getGmailMessage,
  getGmailAttachmentBuffer,
  markGmailMessageAsRead,
  isSupportedResumeMimeType,
  createGmailClient,
} from "@/lib/services/gmail";
import { fetchGmailConnection } from "@/lib/data/integrations";
import { extractMarkdownWithMarker } from "@/lib/services/marker";
import {
  extractResumeData,
  scoreResumeAgainstCriteria,
  type ParsedResumeData,
} from "@/lib/services/openai";

// Data Access
import {
  uploadResumeToStorage,
  upsertCandidate,
  createApplicationIfNotExists,
  logAiAudit,
  fetchCandidatesByCampaignId,
  fetchCandidateById,
  updateApplicationStage,
  advanceApplicationStatus,
  getResumeSignedUrl,
  saveResumeScore,
  fetchApplicationCampaignId,
} from "@/lib/data/candidates";
import { fetchCampaignScoringConfig, fetchActiveRubricVersion } from "@/lib/data/campaigns";

// Rules
import {
  evaluateResumeScoringOutcome,
  type CampaignScoringConfig,
  type ResumeScoreResult,
} from "@/lib/rules/resume-scoring";
import { toCandidateStage } from "@/lib/constants";
import type { ApplicationState, Candidate, CandidateScore, ScoreFactor, ScreeningTier } from "@/lib/constants";
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
    const userId = await requireUserId();

    // Rate limit: 5 Gmail syncs per 10 minutes per user
    checkRateLimit(userId, { name: "gmail-sync", maxRequests: 5, windowMs: 10 * 60 * 1000 });

    // Resolve the recruiter's connected inbox. No connection → nothing to sync;
    // return a friendly message pointing them at Settings rather than throwing.
    const connection = await fetchGmailConnection(userId);
    if (!connection) {
      return {
        success: false,
        count: 0,
        message: "No Gmail connected. Connect an inbox in Settings to sync resumes.",
      };
    }

    const gmail = createGmailClient(connection.refresh_token);

    // Find up to 5 recent unread emails with supported attachment types
    const messages = await fetchUnreadGmailResumes(gmail, 5);

    if (messages.length === 0) {
      return { success: true, count: 0, message: "No new unread resumes found in Gmail." };
    }

    let processedCount = 0;

    for (const msg of messages) {
      if (!msg.id) continue;

      // Get the full message
      const msgData = await getGmailMessage(gmail, msg.id);
      const parts: gmail_v1.Schema$MessagePart[] = msgData.payload?.parts || [];
      const resumeParts = parts.filter(
        (p) => p.mimeType && isSupportedResumeMimeType(p.mimeType) && p.filename
      );

      for (const part of resumeParts) {
        if (!part.body?.attachmentId) continue;

        // Fetch attachment data
        const fileBuffer = await getGmailAttachmentBuffer(gmail, msg.id, part.body.attachmentId);
        if (!fileBuffer) continue;

        // 1. Upload to Supabase Storage
        const resumeUrl = await uploadResumeToStorage(campaignId, part.filename || "resume.pdf", fileBuffer);

        // 2. Extract markdown via Datalab Marker (layout-aware OCR; one provider
        //    handles both PDF and DOCX). Marker failures (unreachable, status
        //    failed, timeout) are non-blocking: warn and skip this attachment so
        //    the sync never bubbles a 500. The message is marked read by the
        //    outer loop, retiring it.
        let textContent: string;
        try {
          textContent = (await extractMarkdownWithMarker(fileBuffer, part.mimeType || "")).markdown;
        } catch (markerErr) {
          console.warn(
            `syncResumesFromGmail: Marker extraction failed for ${part.filename ?? "(unnamed attachment)"} — skipping.`,
            markerErr,
          );
          continue;
        }

        // 3. Extract structured data + classify the document using OpenAI.
        const structuredData = await extractResumeData(textContent);

        // Skip non-CV documents (e.g. a motivation letter sent in the same
        // thread). We only ingest CVs. Marked read at the end of the outer loop.
        if (structuredData.document_type !== "cv") {
          console.warn(
            `syncResumesFromGmail: skipping ${part.filename ?? "(unnamed attachment)"} — document_type=${structuredData.document_type}.`,
          );
          continue;
        }

        // Skip resumes the AI could not extract an email from — the candidates
        // table requires email NOT NULL, and inventing one would violate the
        // "AI must not fabricate evidence" rule. The message is marked read at
        // the end of the outer loop so we don't loop on it next sync.
        if (structuredData.email == null) {
          console.warn(
            `syncResumesFromGmail: skipping ${part.filename ?? "(unnamed attachment)"} — no email extracted.`,
          );
          continue;
        }

        // 4. Insert or Update Candidate Record
        const candidateId = await upsertCandidate({ ...structuredData, email: structuredData.email });

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
          const scored = await scoreApplicationResume(applicationId, campaignId, candidateId, userId, structuredData);
          if (scored) {
            const decision = evaluateResumeScoringOutcome(scored.result, scored.config);
            await advanceApplicationStatus(applicationId, decision.toState as CandidateStageEnum, decision.rationale);
            await sendTransitionNotification(applicationId, decision.toState, userId);
          }
        } catch (scoreErr) {
          console.error("Resume scoring failed (non-blocking):", scoreErr);
        }

        processedCount++;
      }

      // Mark the email as READ so we don't process it again
      await markGmailMessageAsRead(gmail, msg.id);
    }

    revalidatePath(`/campaigns/${campaignId}`);
    return { success: true, count: processedCount, message: `Successfully synced ${processedCount} resume(s) from Gmail.` };

  } catch (error) {
    console.error("Gmail Sync Error:", error);
    throw new Error(error instanceof Error ? error.message : "Failed to sync resumes from Gmail");
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildScoresArray(
  row: Pick<ApplicationRow, "resume_score" | "screening_tier" | "score_rationale" | "score_factors" | "scored_at" | "created_at" | "rubric_version">,
  currentResumeRubricVersion: number | null,
): CandidateScore[] {
  if (row.resume_score == null) return [];
  return [{
    stage: "resume",
    overall: Number(row.resume_score),
    tier: (row.screening_tier as ScreeningTier | null) || undefined,
    ai_summary: row.score_rationale || "Scored by AI",
    factors: (row.score_factors as ScoreFactor[] | null) || [],
    scored_at: row.scored_at || row.created_at,
    rubric_version: row.rubric_version,
    current_rubric_version: currentResumeRubricVersion,
  }];
}

// ─── Regular Fetch Functions ──────────────────────────────────────────────

export async function getCandidatesByCampaignId(campaignId: string): Promise<Candidate[]> {
  const userId = await requireUserId();
  const [data, currentResumeRubricVersion] = await Promise.all([
    fetchCandidatesByCampaignId(campaignId, userId),
    fetchActiveRubricVersion(campaignId, "resume"),
  ]);
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
      stage: toCandidateStage(app.status),
      awaiting_human_review: app.status === "screening_review_pending",
      scores: buildScoresArray(app, currentResumeRubricVersion),
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
  const userId = await requireUserId();
  const data = (await fetchCandidateById(applicationId, userId)) as ApplicationWithCandidate | null;
  if (!data) return null;

  const candidateRecord = data.candidates;
  const parsed = data.parsed_data as ParsedResumeData | null;

  // Generate signed URL for resume if path exists, and look up the
  // currently-active resume rubric version so the UI can flag scores
  // produced under a stale rubric.
  const [resumeSignedUrl, currentResumeRubricVersion] = await Promise.all([
    data.resume_url ? getResumeSignedUrl(data.resume_url) : Promise.resolve(null),
    fetchActiveRubricVersion(data.campaign_id, "resume"),
  ]);

  return {
    id: data.id,
    campaign_id: data.campaign_id,
    name: `${candidateRecord.first_name} ${candidateRecord.last_name}`,
    email: candidateRecord.email,
    phone: candidateRecord.phone,
    current_title: parsed?.experience?.[0]?.title || null,
    current_company: parsed?.experience?.[0]?.company || null,
    stage: toCandidateStage(data.status),
    // Raw canonical pipeline state — drives the StageChanger, which offers
    // legal next-states from APPLICATION_STATE_TRANSITIONS. `stage` above is
    // the coarse label kept for other UI; the two are intentionally distinct.
    status: data.status as ApplicationState,
    awaiting_human_review: data.status === "screening_review_pending",
    screening_tier: data.screening_tier || null,
    scores: buildScoresArray(data, currentResumeRubricVersion),
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
  toState: string,
  rationale: string,
) {
  const userId = await requireUserId();
  uuidSchema.parse(applicationId);
  const validState = applicationStateSchema.parse(toState);
  const validRationale = stageChangeRationaleSchema.parse(rationale);

  // Fetch campaign_id before updating so we can revalidate the right paths
  const campaignId = await fetchApplicationCampaignId(applicationId);

  await updateApplicationStage(applicationId, validState, validRationale);

  await sendTransitionNotification(applicationId, validState, userId);

  if (campaignId) {
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath(`/campaigns/${campaignId}/candidates/${applicationId}`);
  }
}

// ─── Resume Scoring ─────────────────────────────────────────────────────────
// Scoring and transition are intentionally split: the AI layer only produces
// evidence; the rule layer (src/lib/rules/resume-scoring.ts) reads that
// evidence and decides whether to transition. See CLAUDE.md → ATS State
// Machine Rules.

/**
 * AI layer — produces and persists resume-score evidence. Never transitions.
 * Returns the score + scoring config so the rule layer can decide; returns
 * null if the campaign has no screening criteria configured.
 */
async function scoreApplicationResume(
  applicationId: string,
  campaignId: string,
  candidateId: string,
  userId: string,
  parsedResume: ParsedResumeData | Record<string, unknown>,
): Promise<{ result: ResumeScoreResult; config: CampaignScoringConfig } | null> {
  const config = await fetchCampaignScoringConfig(campaignId, userId);
  if (!config || config.screening_criteria.length === 0) return null;

  const [evidence, rubricVersion] = await Promise.all([
    scoreResumeAgainstCriteria(
      parsedResume,
      config.screening_criteria,
      config.description,
    ),
    fetchActiveRubricVersion(campaignId, "resume"),
  ]);

  await saveResumeScore({
    applicationId,
    campaignId,
    candidateId,
    score: evidence.result.overall_score,
    tier: evidence.result.tier as Database["public"]["Enums"]["screening_tier_enum"],
    rationale: evidence.result.rationale,
    factors: evidence.result.factors,
    rubricVersion,
    audit: {
      model: evidence.model,
      promptVersion: evidence.promptVersion,
      rawOutput: evidence.rawOutput,
      inputSnapshot: {
        criteria_count: config.screening_criteria.length,
        criteria_labels: config.screening_criteria.map((c) => c.label),
        job_description_length: config.description.length,
      },
    },
  });

  return { result: evidence.result, config };
}

// ─── HITL Screening Review ──────────────────────────────────────────────────
// When automation_mode = human_in_loop, the resume-scoring rule routes
// applications to `screening_review_pending` instead of approving/rejecting
// automatically. This action is the recruiter's decision point. It is a
// recruiter-actor transition, so a written rationale is mandatory.

export async function decideHitlReview(input: {
  applicationId: string;
  decision: "approve" | "reject";
  rationale: string;
}) {
  const userId = await requireUserId();

  // Validate shape, length, decision enum, and uuid format up-front.
  const parsed = hitlReviewDecisionSchema.parse(input);

  checkRateLimit(userId, { name: "hitl-review", maxRequests: 30, windowMs: 5 * 60 * 1000 });

  // Ownership check + preflight: only proceed if this application is actually
  // in `screening_review_pending`. Without this guard a recruiter could press
  // approve/reject on a stale page and try to drive an illegal transition.
  const data = (await fetchCandidateById(parsed.applicationId, userId)) as ApplicationWithCandidate | null;
  if (!data) throw new Error("Application not found");

  if (data.status !== "screening_review_pending") {
    throw new Error("Application is no longer awaiting review");
  }

  const toState: ApplicationState =
    parsed.decision === "approve" ? "screening_approved" : "rejected";

  await transitionApplication({
    applicationId: parsed.applicationId,
    toState,
    actor: "recruiter",
    rationale: parsed.rationale,
  });

  await sendTransitionNotification(parsed.applicationId, toState, userId);

  // On approval, email the candidate their screening questions immediately so
  // the recruiter doesn't have to remember a separate "send" step. The send
  // re-checks ownership + eligibility and advances screening_approved →
  // screening_sent on success. Degrade gracefully: a campaign with no
  // questions configured (or any send failure) must NOT undo the approval —
  // the candidate stays approved and the recruiter can send manually. The
  // returned warning explains why no email went out.
  let screeningEmailSent = false;
  let screeningWarning: string | undefined;
  if (parsed.decision === "approve") {
    try {
      await sendScreeningQuestionsToCandidate(parsed.applicationId);
      screeningEmailSent = true;
    } catch (err) {
      screeningWarning =
        err instanceof Error
          ? err.message
          : "Approved, but the screening questions could not be sent automatically.";
    }
  }

  revalidatePath(`/campaigns/${data.campaign_id}`);
  revalidatePath(`/campaigns/${data.campaign_id}/candidates/${parsed.applicationId}`);

  return {
    success: true,
    decision: parsed.decision,
    screeningEmailSent,
    screeningWarning,
  };
}

/**
 * Manually trigger resume scoring for an existing candidate.
 * Used when a candidate was imported before criteria were set up,
 * or to re-score after criteria changes.
 */
export async function scoreResume(applicationId: string) {
  try {
    const userId = await requireUserId();

    checkRateLimit(userId, { name: "ai-generate", maxRequests: 10, windowMs: 5 * 60 * 1000 });

    const data = (await fetchCandidateById(applicationId, userId)) as ApplicationWithCandidate | null;
    if (!data) throw new Error("Application not found");

    const parsedResume = data.parsed_data as ParsedResumeData | null;
    if (!parsedResume) throw new Error("No parsed resume data available for scoring");

    const scored = await scoreApplicationResume(applicationId, data.campaign_id, data.candidates.id, userId, parsedResume);
    if (scored) {
      const decision = evaluateResumeScoringOutcome(scored.result, scored.config);
      await advanceApplicationStatus(applicationId, decision.toState as CandidateStageEnum, decision.rationale);
      await sendTransitionNotification(applicationId, decision.toState, userId);
    }

    revalidatePath(`/campaigns/${data.campaign_id}`);
    revalidatePath(`/campaigns/${data.campaign_id}/candidates/${applicationId}`);
    return { success: true };
  } catch (err) {
    console.error("scoreResume failed:", err);
    if (err instanceof Error) throw err;
    throw new Error(typeof err === "string" ? err : "Resume scoring failed");
  }
}
