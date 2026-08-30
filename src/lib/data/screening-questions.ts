import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseDb } from "@/lib/supabase/types";
import type { EvidenceLevel } from "@/lib/scoring/evidence-levels";
import type { ScoredScreeningDimension } from "@/lib/screening-scoring";
import type { ApplicationState } from "@/lib/constants";
import type { Json } from "@/types/database.types";
import type { ProctoringReport } from "@/lib/proctoring/incidents";
import type { ScreeningTopicLedger } from "@/lib/screening/topic-ledger";

export interface ApplicationForScreeningSend {
  application_id: string;
  campaign_id: string;
  candidate_id: string;
  status: ApplicationState;
  campaign_title: string;
  candidate_name: string;
  candidate_email: string;
}

/**
 * Minimal join used by the "send screening questions" flow. Returns
 * everything needed to write a response row, sign a token, and compose
 * the candidate email — or null if the application doesn't belong to
 * a campaign owned by the current user.
 */
export async function fetchApplicationForScreeningSend(
  applicationId: string,
  userId: string
): Promise<ApplicationForScreeningSend | null> {
  const supabase = await createClient();

  const selectWithCampaignAndCandidate = `
    id,
    campaign_id,
    candidate_id,
    status,
    campaigns!inner ( id, title, user_id ),
    candidates!inner ( id, first_name, last_name, email )
  `;
  const { data, error } = await supabase
    .from("applications")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select(selectWithCampaignAndCandidate as any)
    .eq("id", applicationId)
    .single();

  if (error || !data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  if (row.campaigns?.user_id !== userId) return null;
  if (!row.candidates?.email) return null;

  return {
    application_id: row.id,
    campaign_id: row.campaign_id,
    candidate_id: row.candidate_id,
    status: row.status as ApplicationState,
    campaign_title: row.campaigns.title,
    candidate_name:
      `${row.candidates.first_name ?? ""} ${row.candidates.last_name ?? ""}`.trim() ||
      row.candidates.email,
    candidate_email: row.candidates.email,
  };
}

export interface ScreeningScoringContext {
  campaign_id: string;
  candidate_id: string;
  owner_user_id: string;
  description: string | null;
  automation_mode: "fully_auto" | "human_in_loop";
  screening_threshold: number;
}

/**
 * Resolve everything the scorer needs from an `application_id` alone — the
 * campaign's scoring config plus its owner — WITHOUT a user-session scope.
 *
 * The voice auto-scoring path runs inside the candidate's token-verified
 * request, where there is no recruiter session; the verified screening token is
 * the authorization, so this read is intentionally unscoped (the data layer
 * carries no auth — that is the caller's job, per the layered contract). The
 * recruiter-triggered path still uses the user-scoped `fetchCampaignScoringConfig`.
 */
export async function fetchScoringContextByApplicationId(
  applicationId: string,
  db?: SupabaseDb
): Promise<ScreeningScoringContext | null> {
  const supabase = db ?? (await createClient());

  const selectWithCampaign = `
    candidate_id,
    campaign_id,
    campaigns!inner ( user_id, description, automation_mode, screening_threshold )
  `;
  const { data, error } = await supabase
    .from("applications")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select(selectWithCampaign as any)
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
    automation_mode: campaign.automation_mode,
    screening_threshold: campaign.screening_threshold,
  };
}

export interface ScreeningQuestionRow {
  id: string;
  campaign_id: string;
  prompt: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ScoredAnswerRow {
  question_id: string;
  prompt: string;
  answer_text: string;
  score: number | null;
  rationale: string | null;
  /**
   * The spoken words behind this score and the transcript turn they came from
   * (PRD 3.4.4). Optional: responses scored before #148 have neither, because
   * the scorer verified the quote and then dropped it.
   */
  evidence_quote?: string;
  evidence_turn_index?: number | null;
  /**
   * The evidence level this question's score was derived from, AFTER quote
   * verification. `score` is a consequence of this label and nothing else, so
   * storing only the number would leave a reader unable to tell a verified
   * "strong" from a downgraded one. Absent on responses scored before the
   * evidence model, and on the legacy typed-answer path.
   */
  evidence_level?: EvidenceLevel;
}

/** One spoken turn of a voice-screening call, in conversation order. */
export interface VoiceTranscriptTurn {
  role: "agent" | "candidate";
  text: string;
  /** ISO timestamp the turn was captured client-side. */
  at: string;
}

export interface ScreeningResponseRow {
  id: string;
  application_id: string;
  status: "pending" | "sent" | "responded" | "scored" | "expired";
  answers: ScoredAnswerRow[];
  /** Voice-screening transcript (#83) — the only response format since #161. */
  transcript: VoiceTranscriptTurn[];
  /** Optional recorded-audio pointer in Supabase Storage; null until wired. */
  audio_url: string | null;
  /** Browser proctoring report for the voice call; null when none was captured. */
  proctoring: ProctoringReport | null;
  /**
   * Per-rubric-dimension scores, and the evidence behind each.
   *
   * `null` means this response was scored per question — every response taken
   * before 2026-08-22, and anything scored down the legacy typed-answer path.
   * Those render from `answers[].score` instead. The distinction is kept rather
   * than back-filled: a score should show the unit it was actually graded in,
   * not the unit the product uses today.
   */
  dimension_scores: ScoredScreeningDimension[] | null;
  overall_score: number | null;
  overall_rationale: string | null;
  /**
   * The runtime coverage ledger for the call — what was actually asked, and
   * what the call failed to capture.
   *
   * `null` for every response taken before runtime topic coverage existed, and
   * for a campaign with nothing to control. Read here for one field only:
   * `unheardAnswers`, which is what lets the recruiter's screen tell a 0 the
   * candidate earned from a 0 our transcription lost.
   */
  topic_state: ScreeningTopicLedger | null;
  sent_at: string | null;
  responded_at: string | null;
  scored_at: string | null;
  expires_at: string | null;
}

export async function fetchScreeningQuestionsByCampaignId(
  campaignId: string,
  dbClient?: SupabaseDb
): Promise<ScreeningQuestionRow[]> {
  const supabase = dbClient ?? (await createClient());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("screening_questions")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error(
      "Error fetching screening questions:",
      JSON.stringify(error, null, 2)
    );
    return [];
  }
  return (data || []) as unknown as ScreeningQuestionRow[];
}

export async function replaceScreeningQuestions(
  campaignId: string,
  questions: { prompt: string }[]
): Promise<ScreeningQuestionRow[]> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Wipe existing, insert fresh. Simpler than diffing and correct for the
  // "regenerate" flow; for an "edit one" flow the UI sends the full set.
  const { error: deleteErr } = await db
    .from("screening_questions")
    .delete()
    .eq("campaign_id", campaignId);
  if (deleteErr) {
    throw new Error(
      `Failed to delete existing screening questions: ${deleteErr.message ?? JSON.stringify(deleteErr)}`
    );
  }

  if (questions.length === 0) return [];

  const rows = questions.map((q, i) => ({
    campaign_id: campaignId,
    prompt: q.prompt,
    sort_order: i,
  }));

  const { data, error } = await db
    .from("screening_questions")
    .insert(rows)
    .select();

  if (error) {
    throw new Error(
      `Failed to insert screening questions: ${error.message ?? JSON.stringify(error)}`
    );
  }
  return (data || []) as unknown as ScreeningQuestionRow[];
}

export async function fetchScreeningResponseByApplicationId(
  applicationId: string,
  dbClient?: SupabaseDb
): Promise<ScreeningResponseRow | null> {
  const supabase = dbClient ?? (await createClient());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("screening_question_responses")
    .select("*")
    .eq("application_id", applicationId)
    .maybeSingle();

  if (error) {
    console.error(
      "Error fetching screening response:",
      JSON.stringify(error, null, 2)
    );
    return null;
  }
  return (data || null) as unknown as ScreeningResponseRow | null;
}

export async function upsertPendingScreeningResponse(
  applicationId: string,
  initialAnswers: { question_id: string; prompt: string }[],
  expiresAt: Date
): Promise<ScreeningResponseRow> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const emptyAnswers = initialAnswers.map((q) => ({
    question_id: q.question_id,
    prompt: q.prompt,
    answer_text: "",
    score: null,
    rationale: null,
  }));

  const { data, error } = await db
    .from("screening_question_responses")
    .upsert(
      {
        application_id: applicationId,
        status: "sent",
        answers: emptyAnswers,
        sent_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "application_id" }
    )
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to upsert screening response: ${
        error?.message ?? (error ? JSON.stringify(error) : "no data returned")
      }`
    );
  }
  return data as unknown as ScreeningResponseRow;
}

/**
 * Persist a completed voice-screening call (#83): the captured transcript and
 * a `responded` status. Since #161 retired the text form this is the ONLY way a
 * candidate response is written — the recruiter's score action (#84) reads the
 * transcript.
 */
export async function saveVoiceTranscript(
  applicationId: string,
  transcript: VoiceTranscriptTurn[],
  dbClient?: SupabaseDb
): Promise<void> {
  const supabase = dbClient ?? (await createClient());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("screening_question_responses")
    .update({
      status: "responded",
      transcript,
      responded_at: new Date().toISOString(),
    })
    .eq("application_id", applicationId);

  if (error) {
    throw new Error(
      `Failed to save voice transcript: ${error.message ?? JSON.stringify(error)}`
    );
  }
}

/**
 * Persist the proctoring report for a completed voice screening.
 *
 * Guarded to `sent` — the status the response is still in when the candidate
 * submits — so a late or replayed report cannot attach evidence to a screening
 * that was already finalized, scored, or expired. Callers therefore write this
 * BEFORE `saveVoiceTranscript` flips the row to `responded`, mirroring the
 * interview's ordering.
 *
 * Runs on an injected `db` because it fires in the candidate's session-less
 * submit request.
 */
export async function saveScreeningProctoringReport(
  applicationId: string,
  report: ProctoringReport,
  db: SupabaseDb
): Promise<void> {
  const { error } = await db
    .from("screening_question_responses")
    .update({ proctoring: report as unknown as Json })
    .eq("application_id", applicationId)
    .eq("status", "sent");

  if (error) {
    throw new Error(
      `Failed to save screening proctoring report: ${error.message ?? JSON.stringify(error)}`
    );
  }
}

/**
 * Persist the agent-reported transcript of an in-progress voice call as a
 * DRAFT: the transcript column is updated but the response stays `sent`. The
 * candidate finalizes (or re-records, overwriting this) from the review step —
 * only their explicit submit flips the row to `responded` and advances the
 * application. Guarded to `sent` so a late-arriving agent report can never
 * rewrite the transcript of a response that was already finalized or expired.
 *
 * Called from the agent-facing API route, which has no user session — the
 * caller passes the admin client.
 */
export async function saveVoiceTranscriptDraft(
  applicationId: string,
  transcript: VoiceTranscriptTurn[],
  db: SupabaseDb
): Promise<void> {
  const { error } = await db
    .from("screening_question_responses")
    .update({ transcript: transcript as unknown as Json })
    .eq("application_id", applicationId)
    .eq("status", "sent");

  if (error) {
    throw new Error(
      `Failed to save voice transcript draft: ${error.message ?? JSON.stringify(error)}`
    );
  }
}

/**
 * Read the runtime topic ledger for an in-progress call.
 *
 * `null` means either no call has started yet or the response predates runtime
 * topic coverage — the caller builds a fresh ledger in both cases, so the two
 * do not need telling apart.
 */
export async function fetchScreeningTopicState(
  applicationId: string,
  db: SupabaseDb
): Promise<{ topicState: Json | null; status: string } | null> {
  const { data, error } = await db
    .from("screening_question_responses")
    .select("topic_state, status")
    .eq("application_id", applicationId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to fetch screening topic state: ${error.message ?? JSON.stringify(error)}`
    );
  }
  if (!data) return null;

  return { topicState: data.topic_state ?? null, status: data.status };
}

/**
 * Write the topic ledger, but only if nobody else has moved it since we read.
 *
 * Optimistic concurrency on the `version` inside the document: the interviewer
 * can produce two control events close enough together to overlap (a finalized
 * turn and a tool call land on separate requests), and a last-write-wins update
 * would silently drop whichever transition finished second — a spent follow-up
 * refunded, or a topic un-asked. Returns false when the write did not land so
 * the caller can re-read rather than guess.
 *
 * Guarded to `sent` for the same reason `saveVoiceTranscriptDraft` is: a late
 * control event must never touch a response the candidate has already
 * finalized.
 */
/**
 * Discard the topic ledger so a fresh attempt starts a fresh call.
 *
 * A candidate who re-records gets a new room and their draft transcript is
 * overwritten — but `topic_state` used to survive, so the second attempt
 * resumed a ledger describing the FIRST one. Topics stayed marked covered by a
 * transcript that had just been thrown away, the interviewer skipped straight
 * to whatever was left (or closed immediately, with `unasked=0`), and the
 * candidate was scored on evidence that no longer existed.
 *
 * Scoped to `sent` for the same reason every other write here is: once a
 * response has been submitted or scored, its coverage record is history and
 * must not be rewritten by anyone reopening a stale link.
 */
export async function clearScreeningTopicState(
  applicationId: string,
  db: SupabaseDb
): Promise<void> {
  const { error } = await db
    .from("screening_question_responses")
    .update({ topic_state: null })
    .eq("application_id", applicationId)
    .eq("status", "sent");

  if (error) {
    throw new Error(
      `Failed to clear screening topic state: ${error.message ?? JSON.stringify(error)}`
    );
  }
}

export async function saveScreeningTopicState(
  applicationId: string,
  topicState: Json,
  expectedVersion: number | null,
  db: SupabaseDb
): Promise<boolean> {
  let query = db
    .from("screening_question_responses")
    .update({ topic_state: topicState })
    .eq("application_id", applicationId)
    .eq("status", "sent");

  query =
    expectedVersion === null
      ? query.is("topic_state", null)
      : query.filter("topic_state->>version", "eq", String(expectedVersion));

  const { data, error } = await query.select("id");

  if (error) {
    throw new Error(
      `Failed to save screening topic state: ${error.message ?? JSON.stringify(error)}`
    );
  }

  return (data?.length ?? 0) > 0;
}

/**
 * Mark a screening response as `expired` (#83): the candidate never completed
 * the voice call before the deadline. The matching application transition to
 * `screening_expired` is the action's job — this only flips the response row.
 */
export async function markScreeningResponseExpired(
  applicationId: string,
  dbClient?: SupabaseDb
): Promise<void> {
  const supabase = dbClient ?? (await createClient());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("screening_question_responses")
    .update({ status: "expired" })
    .eq("application_id", applicationId);

  if (error) {
    throw new Error(
      `Failed to expire screening response: ${error.message ?? JSON.stringify(error)}`
    );
  }
}

/**
 * Application IDs whose screening link is still `sent` but past its deadline —
 * the work list for the proactive expiry sweep (the scheduled counterpart to
 * the lazy expiry in `startCandidateVoiceScreening`). Uses the service-role
 * admin client because the sweep runs from a cron with no recruiter session.
 *
 * Rows with a null `expires_at` never expire and are excluded.
 */
export async function fetchExpiredSentScreeningAppIds(
  now: Date
): Promise<string[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("screening_question_responses")
    .select("application_id")
    .eq("status", "sent")
    .not("expires_at", "is", null)
    .lt("expires_at", now.toISOString());

  if (error) {
    throw new Error(
      `Failed to load expired screening responses: ${error.message ?? JSON.stringify(error)}`
    );
  }

  return (data ?? []).map((row) => row.application_id);
}

/**
 * Service-role variant of `markScreeningResponseExpired` for the session-less
 * sweep. The application transition to `screening_expired` is the caller's job
 * (via `transitionApplicationAsSystem`) — this only flips the response row.
 */
export async function markScreeningResponseExpiredAsSystem(
  applicationId: string
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("screening_question_responses")
    .update({ status: "expired" })
    .eq("application_id", applicationId);

  if (error) {
    throw new Error(
      `Failed to expire screening response: ${error.message ?? JSON.stringify(error)}`
    );
  }
}

export interface ScreeningScoreAuditFields {
  model: string;
  promptVersion: string;
  rawOutput: string;
  inputSnapshot: Json;
}

/**
 * Persist screening answer scores AND their audit-log evidence.
 *
 * Mirrors the resume-score pattern from #26: per CLAUDE.md's "Mandatory AI
 * Output Persistence" rule, every AI score must have a matching
 * `ai_audit_log` row, so this function is the only sanctioned writer of
 * the pair.
 *
 * Write order: response update first, then audit insert. If the audit
 * insert fails the function throws — the score is already saved, so the
 * caller sees the failure and can decide whether to surface it.
 *
 * `rubricVersion` is the screening_q-stage `evaluation_rubrics.version`
 * that was active at score time. Stamped both on the response row and on
 * the audit row so the UI can flag scores produced against a stale rubric
 * (issue #36). Pass null when no active rubric exists for the campaign.
 */
export async function saveAnswerScores(args: {
  applicationId: string;
  campaignId: string;
  candidateId: string;
  overall: { score: number; rationale: string };
  /**
   * Per-question scores — the legacy typed-answer path only. Null on the voice
   * path, which grades rubric dimensions instead; see `perDimension`.
   */
  perAnswer:
    | {
        question_id: string;
        score: number;
        rationale: string;
        evidence_quote?: string;
        evidence_turn_index?: number | null;
        evidence_level?: EvidenceLevel;
      }[]
    | null;
  /**
   * Per-rubric-dimension scores — the voice path. Written to its own column
   * rather than merged into `answers`: a competency is not a property of a
   * question, and one dimension is routinely evidenced across several answers.
   */
  perDimension: ScoredScreeningDimension[] | null;
  rubricVersion: number | null;
  audit: ScreeningScoreAuditFields;
  /**
   * Injected for the candidate-side auto-score, which runs in a token-verified
   * request with no recruiter session. Defaults to the session client.
   */
  db?: SupabaseDb;
}): Promise<void> {
  const supabase = args.db ?? (await createClient());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const existing = await fetchScreeningResponseByApplicationId(
    args.applicationId,
    args.db
  );
  if (!existing) throw new Error("Screening response not found");

  const scoreById = new Map((args.perAnswer ?? []).map((a) => [a.question_id, a]));
  const mergedAnswers = existing.answers.map((a) => {
    const s = scoreById.get(a.question_id);
    if (!s) return a;

    // Evidence keys are added only when there IS evidence. Writing
    // `evidence_quote: undefined` / `evidence_turn_index: null` onto every
    // answer would put "we looked and found nothing" and "this predates
    // evidence capture" into the same shape, and the UI distinguishes them.
    return {
      ...a,
      score: s.score,
      rationale: s.rationale,
      ...(s.evidence_quote
        ? {
            evidence_quote: s.evidence_quote,
            evidence_turn_index: s.evidence_turn_index ?? null,
          }
        : {}),
      // Written even when no quote survived: "we read this and found nothing"
      // is exactly the case where the bare 0 is least self-explanatory.
      ...(s.evidence_level ? { evidence_level: s.evidence_level } : {}),
    };
  });

  const { error: updateError } = await db
    .from("screening_question_responses")
    .update({
      status: "scored",
      overall_score: args.overall.score,
      overall_rationale: args.overall.rationale,
      answers: mergedAnswers,
      // Only written when the run actually produced dimension scores. A
      // re-score down the legacy text path must not blank a column it has
      // nothing to say about — leaving the previous run's evidence in place is
      // better than replacing it with a null that reads as "never scored".
      ...(args.perDimension ? { dimension_scores: args.perDimension } : {}),
      rubric_version: args.rubricVersion,
      scored_at: new Date().toISOString(),
    })
    .eq("application_id", args.applicationId);

  if (updateError) {
    throw new Error(
      `Failed to save answer scores: ${updateError.message ?? JSON.stringify(updateError)}`
    );
  }

  const { error: auditError } = await supabase.from("ai_audit_log").insert({
    campaign_id: args.campaignId,
    candidate_id: args.candidateId,
    stage: "screening_scoring",
    model: args.audit.model,
    prompt_version: args.audit.promptVersion,
    rubric_version: args.rubricVersion != null ? String(args.rubricVersion) : null,
    input_snapshot: args.audit.inputSnapshot,
    raw_output: args.audit.rawOutput,
    parsed_score: args.overall.score,
    rationale: args.overall.rationale,
    action_taken: "scored",
  });

  if (auditError) {
    throw new Error(
      `Screening scored but audit log write failed (compliance gap): ${auditError.message}`,
    );
  }
}
