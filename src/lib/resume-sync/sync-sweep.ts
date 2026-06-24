import type { gmail_v1 } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseDb } from "@/lib/supabase/types";
import type { Database } from "@/types/database.types";
import {
  fetchActiveCampaignsForResumeSync,
  fetchCampaignScoringConfig,
  fetchActiveRubricVersion,
} from "@/lib/data/campaigns";
import { fetchGmailConnection } from "@/lib/data/integrations";
import {
  uploadResumeToStorage,
  upsertCandidate,
  createApplicationIfNotExists,
  logAiAudit,
  saveResumeScore,
} from "@/lib/data/candidates";
import {
  createGmailClient,
  fetchUnreadGmailResumes,
  getGmailMessage,
  getGmailAttachmentBuffer,
  isSupportedResumeMimeType,
  markGmailMessageAsRead,
} from "@/lib/services/gmail";
import { extractMarkdownWithMarker } from "@/lib/services/marker";
import {
  extractResumeData,
  scoreResumeAgainstCriteria,
  type ParsedResumeData,
} from "@/lib/services/openai";
import { evaluateResumeScoringOutcome } from "@/lib/rules/resume-scoring";
import { transitionApplicationAsSystem } from "@/lib/data/transitions";

type ScreeningTierEnum = Database["public"]["Enums"]["screening_tier_enum"];

const MAX_MESSAGES_PER_CAMPAIGN = 5;

export interface ResumeSyncSweepResult {
  /** Active campaigns (with an application alias) the sweep looked at. */
  campaignsScanned: number;
  /** How many CVs were ingested into the pipeline. */
  ingested: number;
  /** How many campaigns failed mid-flight (logged, not thrown). */
  failed: number;
}

/**
 * Scheduled, session-less counterpart to the recruiter's "Sync from Gmail"
 * button: pulls new CVs into every **Active** campaign automatically, so the
 * recruiter doesn't have to press anything. Mirrors `syncResumesFromGmail` but
 * runs with the service-role client (no session) and resolves each campaign's
 * owner to build their Gmail client.
 *
 * Only Active campaigns are touched (the freeze rule — draft/paused/closed never
 * ingest). Each campaign is handled independently: a failure is logged and the
 * sweep continues, so one bad inbox can't strand the rest. Intended to be
 * invoked on a schedule via `/api/cron/sync-resumes`.
 */
export async function sweepResumeSync(): Promise<ResumeSyncSweepResult> {
  const db = createAdminClient();
  const campaigns = await fetchActiveCampaignsForResumeSync();

  let ingested = 0;
  let failed = 0;

  for (const campaign of campaigns) {
    try {
      ingested += await syncCampaign(db, campaign);
    } catch (err) {
      failed += 1;
      console.error(
        `Resume-sync sweep failed for campaign ${campaign.campaign_id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { campaignsScanned: campaigns.length, ingested, failed };
}

async function syncCampaign(
  db: SupabaseDb,
  campaign: { campaign_id: string; user_id: string; application_email: string },
): Promise<number> {
  // Resolve the owner's connected inbox. No connection → nothing to pull; skip
  // quietly (the recruiter just hasn't connected Gmail yet).
  const connection = await fetchGmailConnection(campaign.user_id, db);
  if (!connection) return 0;

  const gmail = createGmailClient(connection.refresh_token);
  const messages = await fetchUnreadGmailResumes(
    gmail,
    MAX_MESSAGES_PER_CAMPAIGN,
    campaign.application_email,
  );

  let ingested = 0;
  for (const msg of messages) {
    if (!msg.id) continue;
    try {
      ingested += await ingestMessage(db, gmail, campaign.campaign_id, campaign.user_id, msg.id);
    } finally {
      // Mark read regardless of outcome so a poison message doesn't loop forever.
      await markGmailMessageAsRead(gmail, msg.id).catch(() => {});
    }
  }
  return ingested;
}

async function ingestMessage(
  db: SupabaseDb,
  gmail: gmail_v1.Gmail,
  campaignId: string,
  ownerUserId: string,
  messageId: string,
): Promise<number> {
  const msgData = await getGmailMessage(gmail, messageId);
  const parts: gmail_v1.Schema$MessagePart[] = msgData.payload?.parts ?? [];
  const resumeParts = parts.filter(
    (p) => p.mimeType && isSupportedResumeMimeType(p.mimeType) && p.filename,
  );

  let ingested = 0;
  for (const part of resumeParts) {
    if (!part.body?.attachmentId) continue;

    const fileBuffer = await getGmailAttachmentBuffer(gmail, messageId, part.body.attachmentId);
    if (!fileBuffer) continue;

    const filename = part.filename || "resume.pdf";
    const resumeUrl = await uploadResumeToStorage(campaignId, filename, fileBuffer, db);

    let markdown: string;
    try {
      markdown = (await extractMarkdownWithMarker(fileBuffer, part.mimeType || "")).markdown;
    } catch (markerErr) {
      console.warn(
        `Resume-sync sweep: Marker extraction failed for ${filename} — skipping.`,
        markerErr,
      );
      continue;
    }

    const structured = await extractResumeData(markdown);
    if (structured.document_type !== "cv") continue;
    if (structured.email == null) continue;

    const candidateId = await upsertCandidate({ ...structured, email: structured.email }, db);
    const applicationId = await createApplicationIfNotExists(
      candidateId,
      campaignId,
      resumeUrl,
      structured,
      db,
    );
    await logAiAudit(
      { campaignId, candidateId, textContent: markdown, filename, structuredData: structured },
      db,
    );

    // Score + rule-driven advance (Control > AI > Data). Failures here are
    // non-blocking: the application still landed in `new`.
    try {
      await scoreIngestedResume(db, {
        applicationId,
        campaignId,
        candidateId,
        ownerUserId,
        parsed: structured,
      });
    } catch (scoreErr) {
      console.error("Resume-sync sweep: scoring failed (non-blocking):", scoreErr);
    }

    ingested += 1;
  }
  return ingested;
}

async function scoreIngestedResume(
  db: SupabaseDb,
  args: {
    applicationId: string;
    campaignId: string;
    candidateId: string;
    ownerUserId: string;
    parsed: ParsedResumeData;
  },
): Promise<void> {
  const config = await fetchCampaignScoringConfig(args.campaignId, args.ownerUserId, db);
  // No active criteria → nothing to score against; the application stays `new`.
  if (!config || config.screening_criteria.length === 0) return;

  const [evidence, rubricVersion] = await Promise.all([
    scoreResumeAgainstCriteria(args.parsed, config.screening_criteria, config.description),
    fetchActiveRubricVersion(args.campaignId, "resume", db),
  ]);

  await saveResumeScore(
    {
      applicationId: args.applicationId,
      campaignId: args.campaignId,
      candidateId: args.candidateId,
      score: evidence.result.overall_score,
      tier: evidence.result.tier as ScreeningTierEnum,
      rationale: evidence.result.rationale,
      factors: evidence.result.factors,
      rubricVersion,
      audit: {
        model: evidence.model,
        promptVersion: evidence.promptVersion,
        rawOutput: evidence.rawOutput,
        inputSnapshot: {
          criteria_count: config.screening_criteria.length,
          source: "scheduled_sync",
        },
      },
    },
    db,
  );

  const decision = evaluateResumeScoringOutcome(evidence.result, config);
  await transitionApplicationAsSystem(args.applicationId, decision.toState, decision.rationale);
}
