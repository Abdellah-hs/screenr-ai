import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";
import type { ParsedResumeData } from "@/lib/services/openai";
import type { Database, Json } from "@/types/database.types";
import type { SupabaseDb } from "@/lib/supabase/types";
import { transitionApplication } from "@/lib/data/transitions";
import { verifyCampaignOwnership } from "@/lib/data/campaigns";
import { AUTO_ARCHIVABLE_STATES } from "@/lib/rules/auto-archive";
import type { DeterministicResumeScoreResult } from "@/lib/resume-scoring";
import type {
  ApplicationState,
  AutomationMode,
  CampaignStatus,
  Disposition,
  InterviewPersona,
} from "@/lib/constants";
import {
  findCandidateByEmail,
  findCandidateByPhone,
  flagDuplicateCandidate,
  type MatchSignals,
} from "@/lib/data/duplicate-flags";

type CandidateStageEnum = Database["public"]["Enums"]["candidate_stage_enum"];

export async function uploadResumeToStorage(campaignId: string, filename: string, fileBuffer: Buffer, db?: SupabaseDb): Promise<string> {
  const supabase = db ?? (await createClient());
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

/** The private bucket holding proctoring evidence stills. */
const SNAPSHOT_BUCKET = "proctoring-snapshots";


/**
 * Upload one proctoring evidence still and return its object key.
 *
 * Key layout `<campaign>/<application>/<epoch>.jpg` puts the campaign id in the
 * first path segment, which is what the bucket's owner-scoped RLS keys off —
 * the same convention as `resumes`. Uploaded with the admin client from the
 * agent route, so it bypasses RLS on write; the recruiter read path is what the
 * policies govern.
 */
export async function uploadProctoringSnapshot(
  args: {
    campaignId: string;
    applicationId: string;
    at: string;
    image: Buffer;
  },
  db: SupabaseDb,
): Promise<string> {
  const stamp = Number.isNaN(Date.parse(args.at)) ? Date.now() : Date.parse(args.at);
  const key = `${args.campaignId}/${args.applicationId}/${stamp}.jpg`;

  const { error } = await db.storage
    .from(SNAPSHOT_BUCKET)
    .upload(key, args.image, { contentType: "image/jpeg", upsert: true });

  if (error) throw error;
  return key;
}

/**
 * Delete evidence stills by key. Used to prune snapshots that didn't land inside
 * a confirmed incident — the images behind the detector's own false positives.
 * Best-effort at the call site; a failure here leaves an unreferenced object,
 * never a broken report.
 */
export async function deleteProctoringSnapshots(
  keys: string[],
  db: SupabaseDb,
): Promise<void> {
  if (keys.length === 0) return;
  const { error } = await db.storage.from(SNAPSHOT_BUCKET).remove(keys);
  if (error) throw error;
}

/**
 * Time-limited signed URLs for evidence stills, keyed by object key.
 *
 * Batched because a report can carry several findings and the recruiter's page
 * needs them all at once: `createSignedUrls` is one request for the set, where
 * mapping the single-key helper over them would be one Supabase client and one
 * round trip each. Keys that fail to sign are simply absent from the result —
 * an incident without a picture still renders.
 */
export async function getProctoringSnapshotSignedUrls(
  keys: string[],
): Promise<Record<string, string>> {
  const wanted = keys.filter(Boolean);
  if (wanted.length === 0) return {};

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(SNAPSHOT_BUCKET)
    .createSignedUrls(wanted, 3600);

  if (error || !data) return {};

  return Object.fromEntries(
    data
      .filter((entry) => entry.signedUrl && entry.path)
      .map((entry) => [entry.path as string, entry.signedUrl]),
  );
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
  db?: SupabaseDb,
): Promise<string> {
  const supabase = db ?? (await createClient());

  const [matchedByEmail, matchedByPhone] = await Promise.all([
    findCandidateByEmail(structuredData.email, db),
    structuredData.phone ? findCandidateByPhone(structuredData.phone, db) : Promise.resolve(null),
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
    }, db);
  }

  return candidateId;
}

export async function createApplicationIfNotExists(
  candidateId: string,
  campaignId: string,
  resumeUrl: string,
  structuredData: ParsedResumeData,
  db?: SupabaseDb
): Promise<string> {
  const supabase = db ?? (await createClient());

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
}, db?: SupabaseDb) {
  const supabase = db ?? (await createClient());

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
  /** OpenAI backend fingerprint, when the API returned one. */
  systemFingerprint?: string | null;
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
  /** The deterministic evaluation — the whole auditable result. */
  result: DeterministicResumeScoreResult;
  rationale: string;
  rubricVersion: number | null;
  audit: ResumeScoreAuditFields;
}, db?: SupabaseDb) {
  const supabase = db ?? (await createClient());

  const { error: updateError, data: updateData } = await supabase
    .from("applications")
    .update({
      // Null for an ineligible candidate: there is no ranking score to record,
      // and writing a low number would let a failed gate be read as a near
      // miss. `scored_at` is what says scoring has run.
      resume_score: args.result.ranking_score,
      resume_eligible: args.result.eligible,
      resume_evaluation: args.result as unknown as Json,
      screening_tier: args.result.tier,
      score_rationale: args.rationale,
      // The legacy weighted-factor breakdown is superseded by
      // `resume_evaluation`. Cleared rather than left behind, so a re-scored
      // application cannot render last run's weights next to this run's
      // verdict.
      score_factors: null,
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
    parsed_score: args.result.ranking_score,
    rationale: args.rationale,
    action_taken: args.result.eligible ? "scored_eligible" : "scored_ineligible",
  });

  if (auditError) {
    throw new Error(
      `Resume scored but audit log write failed (compliance gap): ${auditError.message}`,
    );
  }
}

/**
 * Minimal read for callers that only need an application's owning campaign —
 * revalidating cache paths, or building a campaign-scoped storage key.
 *
 * Takes an optional `db` so the session-less agent routes can pass the admin
 * client; without it the cookie client's RLS returns nothing on a candidate-path
 * request.
 */
export async function fetchApplicationCampaignId(
  applicationId: string,
  db?: SupabaseDb
): Promise<string | null> {
  const supabase = db ?? (await createClient());
  const { data } = await supabase
    .from("applications")
    .select("campaign_id")
    .eq("id", applicationId)
    .maybeSingle();
  return data?.campaign_id ?? null;
}

/**
 * Unauthenticated read used by the public candidate-response page. Looks up
 * an application + its owning campaign's title without any user scoping — the
 * caller must have already verified a signed token, since RLS alone is not
 * enough to gate this join.
 *
 * Takes an injected `db` for the same reason the interview reads below do:
 * `applications` and `campaigns` are owner-only RLS, so on the cookie client an
 * anonymous candidate reads NOTHING and a valid link looks like a missing
 * application. Candidate-facing callers pass the admin client after verifying
 * the token; the default keeps recruiter-session callers unchanged.
 */
export interface ApplicationForResponse {
  application_id: string;
  campaign_id: string;
  campaign_title: string;
  campaign_status: CampaignStatus;
}

export async function fetchApplicationForResponse(
  applicationId: string,
  db?: SupabaseDb
): Promise<ApplicationForResponse | null> {
  const supabase = db ?? (await createClient());
  const { data } = await supabase
    .from("applications")
    .select("id, campaign_id, campaigns!inner(id, title, status)")
    .eq("id", applicationId)
    .single<{
      id: string;
      campaign_id: string;
      campaigns: { id: string; title: string; status: CampaignStatus };
    }>();

  if (!data) return null;
  return {
    application_id: data.id,
    campaign_id: data.campaign_id,
    campaign_title: data.campaigns.title,
    campaign_status: data.campaigns.status,
  };
}

/**
 * Session-less read for the AI interview flow: campaign framing + the
 * candidate's parsed résumé, so the interview agent's instructions can be
 * grounded in the candidate's real background. Does no user scoping — the
 * caller has already verified a signed interview token.
 *
 * Takes an injected `db` because the candidate has no account: `applications`
 * and `candidates` are owner-only RLS, so the cookie client reads NOTHING on a
 * real candidate request. The interview actions pass the admin client after the
 * token check (see `createAdminClient`).
 */
export interface InterviewCandidateContext {
  application_id: string;
  campaign_id: string;
  campaign_title: string;
  campaign_status: CampaignStatus;
  candidate_first_name: string | null;
  candidate_last_name: string | null;
  /** The candidate's parsed résumé (null if never ingested). */
  resume: ParsedResumeData | null;
  /** The campaign's configured interviewing stance (PRD 3.5.8). */
  interview_persona: InterviewPersona;
}

export async function fetchInterviewContextByApplicationId(
  applicationId: string,
  db?: SupabaseDb,
): Promise<InterviewCandidateContext | null> {
  const supabase = db ?? (await createClient());
  // The parsed résumé lives on the APPLICATION — `candidates` holds identity
  // only (CLAUDE.md → Entities). Selecting `parsed_data` off the candidate join
  // makes PostgREST reject the whole query, which reads as "no such application".
  const select =
    "id, campaign_id, parsed_data, campaigns!inner(id, title, status, interview_persona), candidates!inner(first_name, last_name)";
  const { data, error } = await supabase
    .from("applications")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select(select as any)
    .eq("id", applicationId)
    .single();

  if (error) {
    console.error("Error fetching interview context:", JSON.stringify(error, null, 2));
    return null;
  }
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;

  return {
    application_id: row.id,
    campaign_id: row.campaign_id,
    campaign_title: row.campaigns?.title ?? "the role",
    campaign_status: row.campaigns?.status,
    candidate_first_name: row.candidates?.first_name ?? null,
    candidate_last_name: row.candidates?.last_name ?? null,
    resume: (row.parsed_data ?? null) as ParsedResumeData | null,
    // Falls back to the column default rather than throwing: a missing stance
    // should run a neutral interview, not deny the candidate their link.
    interview_persona: (row.campaigns?.interview_persona ?? "neutral") as InterviewPersona,
  };
}

/**
 * Session-less context for auto-scoring a completed interview: the job
 * description to score against, the owning recruiter (for attribution), the
 * candidate id, and a short résumé summary for the scorer. Accepts an injected
 * `db` because the auto-score fires in the candidate's session-less submit
 * request — the caller passes the admin client so RLS doesn't blank the read.
 */
export interface InterviewScoringContext {
  campaign_id: string;
  candidate_id: string;
  owner_user_id: string;
  description: string | null;
  resume_summary: string | null;
  /** Recorded as scoring evidence — which stance produced this transcript. */
  interview_persona: InterviewPersona;
  /** Drives whether a scored interview advances to `manager_review` on its own. */
  automation_mode: AutomationMode;
}

export async function fetchInterviewScoringContext(
  applicationId: string,
  db?: SupabaseDb,
): Promise<InterviewScoringContext | null> {
  const supabase = db ?? (await createClient());
  // `parsed_data` is an APPLICATION column (see above) — not a candidate one.
  const select =
    "candidate_id, campaign_id, parsed_data, campaigns!inner(user_id, description, interview_persona, automation_mode)";
  const { data, error } = await supabase
    .from("applications")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select(select as any)
    .eq("id", applicationId)
    .single();

  if (error || !data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  const campaign = row.campaigns;
  if (!campaign?.user_id) return null;

  return {
    campaign_id: row.campaign_id,
    candidate_id: row.candidate_id,
    owner_user_id: campaign.user_id,
    description: campaign.description ?? null,
    resume_summary: buildResumeSummary(row.parsed_data ?? null),
    interview_persona: (campaign.interview_persona ?? "neutral") as InterviewPersona,
    // Falls back to the cautious mode: a missing setting should leave the
    // application for a human, never auto-advance it.
    automation_mode: (campaign.automation_mode ?? "human_in_loop") as AutomationMode,
  };
}

/** Compact one-paragraph résumé summary to give the interview scorer context. */
function buildResumeSummary(parsed: ParsedResumeData | null): string | null {
  if (!parsed) return null;
  const parts = [
    parsed.headline,
    parsed.summary,
    parsed.skills?.length ? `Skills: ${parsed.skills.slice(0, 15).join(", ")}` : null,
  ].filter((p): p is string => Boolean(p && p.trim()));
  const summary = parts.join(". ").trim();
  return summary.length > 0 ? summary.slice(0, 1500) : null;
}

/**
 * System-driven advancement (rule-based, e.g. resume scoring passes threshold).
 * Delegates to transitionApplication() so validation + audit log stay consistent.
 */
export async function advanceApplicationStatus(
  applicationId: string,
  newStatus: CandidateStageEnum,
  rationale?: string,
  disposition?: Disposition,
) {
  await transitionApplication({
    applicationId,
    toState: newStatus as ApplicationState,
    actor: "system",
    rationale,
    disposition,
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
  disposition?: Disposition,
) {
  await transitionApplication({
    applicationId,
    toState,
    actor: "recruiter",
    rationale,
    disposition,
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
  db?: SupabaseDb,
): Promise<ApplicationEmailContext | null> {
  const supabase = db ?? (await createClient());

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

/** An application sitting in a non-responsive failure state, with its window. */
export interface ArchivableApplication {
  application_id: string;
  status: string;
  entered_at: string | null;
  auto_archive_after_days: number | null;
}

/**
 * Applications in a non-responsive failure state whose campaign has opted into
 * auto-archiving. The window comparison itself is the rule layer's job
 * (`shouldAutoArchive`) — this only narrows to rows worth considering, and
 * excludes campaigns with a NULL window so an un-opted-in campaign never even
 * reaches the decision.
 *
 * `updated_at` stands in for "when it entered this state", matching how the SLA
 * timers already measure time-in-stage.
 */
export async function fetchArchivableApplications(
  db: SupabaseDb,
): Promise<ArchivableApplication[]> {
  const q = db as unknown as {
    from: (t: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select: (s: string) => any;
    };
  };

  const { data, error } = await q
    .from("applications")
    .select("id, status, updated_at, campaigns!inner(auto_archive_after_days, deleted_at)")
    .in("status", [...AUTO_ARCHIVABLE_STATES])
    .not("campaigns.auto_archive_after_days", "is", null)
    .is("campaigns.deleted_at", null);

  if (error) {
    throw new Error(
      `Failed to load archivable applications: ${error.message ?? JSON.stringify(error)}`,
    );
  }

  return ((data ?? []) as Array<{
    id: string;
    status: string;
    updated_at: string | null;
    campaigns: { auto_archive_after_days: number | null } | null;
  }>).map((r) => ({
    application_id: r.id,
    status: r.status,
    entered_at: r.updated_at,
    auto_archive_after_days: r.campaigns?.auto_archive_after_days ?? null,
  }));
}

/**
 * The state an application was in immediately before it was archived, read off
 * the transitions log. Un-archive restores exactly this — there is no
 * `previous_status` column, and adding one would duplicate a fact the immutable
 * log already records.
 */
export async function fetchPreArchiveState(
  applicationId: string,
  db?: SupabaseDb,
): Promise<string | null> {
  const supabase = db ?? (await createClient());
  const { data, error } = await supabase
    .from("application_transitions")
    .select("from_state, created_at")
    .eq("application_id", applicationId)
    .eq("to_state", "archived")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return (data[0] as { from_state: string | null }).from_state;
}
