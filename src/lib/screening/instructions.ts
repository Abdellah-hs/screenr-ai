/**
 * Compose the voice-screening interviewer's instructions for one application.
 *
 * This exists because the instructions are no longer published in LiveKit room
 * metadata. Metadata is delivered to EVERY participant — it arrives in the JOIN
 * response and is exposed as `room.metadata` on the client SDK — so a candidate
 * with the network tab open could read the whole topic guide before being asked
 * anything, which defeats "questions never shown in advance"
 * (docs/voice-screening.md, mitigation #2). The room now carries the
 * application id alone, and the agent worker fetches this over the
 * `AGENT_API_SECRET`-guarded route.
 *
 * It is orchestration, not a rule: it reads (data layer) and composes
 * (service layer) on an injected `db`, because its only caller is a route
 * handler with no recruiter session. It performs NO auth — the route's shared
 * secret is the gate — and it decides nothing about application state.
 *
 * Returns `null` when the application is unknown or the campaign has no
 * screening questions, so the caller can answer 404 rather than hand a worker
 * an interviewer with nothing to ask.
 */
import { fetchApplicationForResponse } from "@/lib/data/candidates";
import { fetchScreeningQuestionsByCampaignId } from "@/lib/data/screening-questions";
import {
  buildScreeningInstructions,
  buildScreeningTopicFallback,
} from "@/lib/services/realtime";
import { summarizeResumeForInterview } from "@/lib/services/interview";
import type { SupabaseDb } from "@/lib/supabase/types";

export interface ComposedScreeningInstructions {
  instructions: string;
  /**
   * The topic guide, for the worker to inject only if a control call fails.
   * Null when the instructions already carry the list inline (an older worker,
   * or one running with topic control switched off — either way it is driving
   * the call itself and needs the list in front of it).
   */
  topicFallback: string | null;
}

/**
 * @param withholdTopics the caller PUSHES each question to the interviewer as
 *   it is asked, so the list can be withheld from the prompt and handed over
 *   only as an emergency fallback. Defaults to false so a worker deployed
 *   before the push protocol still receives a complete, self-sufficient set of
 *   instructions — without this, rolling the app out first would hand an old
 *   worker an interviewer with nothing to ask.
 */
export async function composeScreeningInstructions(
  applicationId: string,
  db: SupabaseDb,
  withholdTopics = false,
): Promise<ComposedScreeningInstructions | null> {
  const app = await fetchApplicationForResponse(applicationId, db);
  if (!app) return null;

  const questions = await fetchScreeningQuestionsByCampaignId(app.campaign_id, db);
  if (questions.length === 0) return null;

  // Mapped field by field rather than passed whole: `ParsedResumeData` splits
  // the name in two and carries contact details the interviewer has no use for.
  const resumeSummary = app.resume
    ? summarizeResumeForInterview({
        headline: app.resume.headline,
        summary: app.resume.summary,
        skills: app.resume.skills,
        experience: app.resume.experience,
        education: app.resume.education,
      })
    : null;

  const forVoice = questions.map((q) => ({ prompt: q.prompt }));

  return {
    instructions: buildScreeningInstructions({
      jobTitle: app.campaign_title,
      questions: forVoice,
      candidateFirstName: app.candidate_first_name ?? undefined,
      resumeSummary: resumeSummary ?? undefined,
      withholdTopics,
    }),
    topicFallback: withholdTopics ? buildScreeningTopicFallback(forVoice) : null,
  };
}
