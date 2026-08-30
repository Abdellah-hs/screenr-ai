/**
 * Compose the AI video interviewer's instructions for one application.
 *
 * The interview twin of `src/lib/screening/instructions.ts`, and it exists for
 * the same reason: LiveKit room metadata is delivered to every participant, so
 * anything published there is readable by the candidate. That matters more here
 * than at the screening stage — these instructions embed a condensed copy of
 * the candidate's own résumé plus the campaign's interviewing stance, and a
 * candidate who can read the persona knows exactly how hard they are about to
 * be pressed. The room now carries the application id alone and the agent
 * worker fetches this over the `AGENT_API_SECRET`-guarded route.
 *
 * Orchestration, not a rule: reads (data layer) and composes (service layer) on
 * an injected `db`, performs no auth, and decides nothing about application
 * state. Returns `null` for an unknown application.
 */
import { fetchInterviewContextByApplicationId } from "@/lib/data/candidates";
import type { InterviewCandidateContext } from "@/lib/data/candidates";
import {
  buildInterviewInstructions,
  type InterviewResume,
} from "@/lib/services/interview";
import type { SupabaseDb } from "@/lib/supabase/types";

/**
 * The candidate's identity lives on `candidates` and their résumé on the
 * application (CLAUDE.md → Entities), so the interviewer's one reference block
 * has to be stitched from both. The candidates row wins on the name: it is what
 * a recruiter has curated, where the résumé's is whatever the parser read.
 */
export function toInterviewResume(ctx: InterviewCandidateContext): InterviewResume | null {
  const fullName = [ctx.candidate_first_name, ctx.candidate_last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const r = ctx.resume;
  if (!r) return fullName ? { fullName } : null;

  const resumeName = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
  return {
    fullName: fullName || resumeName || undefined,
    headline: r.headline,
    summary: r.summary,
    skills: r.skills,
    experience: r.experience,
    education: r.education,
  };
}

export async function composeInterviewInstructions(
  applicationId: string,
  db: SupabaseDb,
): Promise<string | null> {
  const ctx = await fetchInterviewContextByApplicationId(applicationId, db);
  if (!ctx) return null;

  return buildInterviewInstructions({
    jobTitle: ctx.campaign_title,
    resume: toInterviewResume(ctx),
    persona: ctx.interview_persona,
  });
}
