import { createClient } from "@/lib/supabase/server";

export interface ApplicationForScreeningSend {
  application_id: string;
  campaign_id: string;
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
  applicationId: string
): Promise<ApplicationForScreeningSend | null> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("applications")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select(`
      id,
      campaign_id,
      campaigns!inner ( id, title, user_id ),
      candidates!inner ( first_name, last_name, email )
    ` as any)
    .eq("id", applicationId)
    .single();

  if (error || !data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  if (row.campaigns?.user_id !== user.id) return null;
  if (!row.candidates?.email) return null;

  return {
    application_id: row.id,
    campaign_id: row.campaign_id,
    campaign_title: row.campaigns.title,
    candidate_name:
      `${row.candidates.first_name ?? ""} ${row.candidates.last_name ?? ""}`.trim() ||
      row.candidates.email,
    candidate_email: row.candidates.email,
  };
}

/**
 * All applications in a campaign that are ready to receive screening
 * questions: they've been resume-scored, they're still in an early stage,
 * and the candidate has an email. Used by the bulk-send button.
 */
export async function fetchApplicationsReadyForScreeningSend(
  campaignId: string
): Promise<ApplicationForScreeningSend[]> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // Ownership check
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, title")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .single();
  if (!campaign) return [];

  const { data, error } = await supabase
    .from("applications")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select(`
      id,
      campaign_id,
      status,
      resume_score,
      candidates!inner ( first_name, last_name, email )
    ` as any)
    .eq("campaign_id", campaignId)
    .in("status", ["new", "screening"])
    .not("resume_score", "is", null);

  if (error || !data) return [];

  const results: ApplicationForScreeningSend[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of data as any[]) {
    if (!row.candidates?.email) continue;
    results.push({
      application_id: row.id,
      campaign_id: row.campaign_id,
      campaign_title: campaign.title,
      candidate_name:
        `${row.candidates.first_name ?? ""} ${row.candidates.last_name ?? ""}`.trim() ||
        row.candidates.email,
      candidate_email: row.candidates.email,
    });
  }
  return results;
}

export interface ScreeningQuestionRow {
  id: string;
  campaign_id: string;
  prompt: string;
  is_required: boolean;
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
}

export interface ScreeningResponseRow {
  id: string;
  application_id: string;
  status: "pending" | "sent" | "responded" | "scored" | "expired";
  answers: ScoredAnswerRow[];
  overall_score: number | null;
  overall_rationale: string | null;
  sent_at: string | null;
  responded_at: string | null;
  scored_at: string | null;
  expires_at: string | null;
}

export async function fetchScreeningQuestionsByCampaignId(
  campaignId: string
): Promise<ScreeningQuestionRow[]> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("screening_questions")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Error fetching screening questions:", error);
    return [];
  }
  return (data || []) as unknown as ScreeningQuestionRow[];
}

export async function replaceScreeningQuestions(
  campaignId: string,
  questions: { prompt: string; is_required: boolean }[]
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
  if (deleteErr) throw deleteErr;

  if (questions.length === 0) return [];

  const rows = questions.map((q, i) => ({
    campaign_id: campaignId,
    prompt: q.prompt,
    is_required: q.is_required,
    sort_order: i,
  }));

  const { data, error } = await db
    .from("screening_questions")
    .insert(rows)
    .select();

  if (error) throw error;
  return (data || []) as unknown as ScreeningQuestionRow[];
}

export async function fetchScreeningResponseByApplicationId(
  applicationId: string
): Promise<ScreeningResponseRow | null> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("screening_question_responses")
    .select("*")
    .eq("application_id", applicationId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching screening response:", error);
    return null;
  }
  return (data || null) as unknown as ScreeningResponseRow | null;
}

export async function fetchScreeningResponsesByCampaignId(
  campaignId: string
): Promise<Record<string, ScreeningResponseRow>> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("screening_question_responses")
    .select("*, applications!inner(campaign_id)")
    .eq("applications.campaign_id", campaignId);

  if (error || !data) {
    console.error("Error fetching screening responses:", error);
    return {};
  }

  const byApplicationId: Record<string, ScreeningResponseRow> = {};
  for (const row of data as unknown as ScreeningResponseRow[]) {
    byApplicationId[row.application_id] = row;
  }
  return byApplicationId;
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

  if (error || !data) throw error || new Error("Failed to upsert screening response");
  return data as unknown as ScreeningResponseRow;
}

export async function saveCandidateAnswers(
  applicationId: string,
  answers: { question_id: string; prompt: string; answer_text: string }[]
): Promise<void> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const normalized = answers.map((a) => ({
    question_id: a.question_id,
    prompt: a.prompt,
    answer_text: a.answer_text,
    score: null,
    rationale: null,
  }));

  const { error } = await db
    .from("screening_question_responses")
    .update({
      status: "responded",
      answers: normalized,
      responded_at: new Date().toISOString(),
    })
    .eq("application_id", applicationId);

  if (error) throw error;
}

export async function saveAnswerScores(
  applicationId: string,
  overall: { score: number; rationale: string },
  perAnswer: { question_id: string; score: number; rationale: string }[]
): Promise<void> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const existing = await fetchScreeningResponseByApplicationId(applicationId);
  if (!existing) throw new Error("Screening response not found");

  const scoreById = new Map(perAnswer.map((a) => [a.question_id, a]));
  const mergedAnswers = existing.answers.map((a) => {
    const s = scoreById.get(a.question_id);
    return s
      ? { ...a, score: s.score, rationale: s.rationale }
      : a;
  });

  const { error } = await db
    .from("screening_question_responses")
    .update({
      status: "scored",
      overall_score: overall.score,
      overall_rationale: overall.rationale,
      answers: mergedAnswers,
      scored_at: new Date().toISOString(),
    })
    .eq("application_id", applicationId);

  if (error) throw error;
}
