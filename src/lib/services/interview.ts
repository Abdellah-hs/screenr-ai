/**
 * AI video-interview instructions (Phase A).
 *
 * The interview analogue of `buildScreeningInstructions` (src/lib/services/
 * realtime.ts). It composes the instructions the interview agent worker
 * (`agents/interview/`) runs, and — unlike screening — anchors the whole
 * conversation in the candidate's actual résumé so questions are grounded in
 * their real experience rather than a generic script. The instructions travel
 * to the worker via LiveKit room metadata (set server-side; the candidate can't
 * touch them).
 *
 * Pure + deterministic: given the same résumé + job title + format it returns
 * the same instruction string, so it's fully unit-testable.
 */
import {
  INTERVIEW_DURATION_MINUTES,
  INTERVIEW_TARGET_QUESTIONS,
  type InterviewPersona,
} from "@/lib/constants";

/**
 * Bump when the instruction wording changes materially — persisted as evidence.
 *
 * v2: interview shortened to a hard 10-minute cap, with explicit pacing (a
 * question budget rather than a time budget, since a realtime model has no
 * clock). Transcripts scored under v1 came from a longer, looser conversation
 * and aren't directly comparable.
 *
 * v3: the campaign's `interview_persona` now reaches the interviewer (it was
 * stored and displayed but never sent). A `neutral` interview is byte-identical
 * to v2 — the baseline stance always was neutral — so v2 and v3 neutral
 * transcripts remain comparable; the bump exists because a v3 row can no longer
 * be assumed neutral, and the audit row records which stance was actually run.
 */
export const INTERVIEW_PROMPT_VERSION = "iv-v3";

/**
 * Configurable interview shapes (PRD 3.5). Phase A ships `general` as the
 * default (a résumé-grounded mix of technical + behavioral); the others are
 * accepted now so the per-campaign format selector can land later without
 * touching this contract.
 */
export type InterviewFormat =
  | "general"
  | "technical_qa"
  | "behavioral"
  | "system_design"
  | "code_reading";

/** A trimmed view of the candidate's parsed résumé, enough to ground questions. */
export interface InterviewResume {
  fullName?: string;
  headline?: string | null;
  summary?: string | null;
  skills?: string[];
  experience?: {
    company?: string | null;
    title?: string | null;
    duration?: string | null;
    description?: string | null;
  }[];
  education?: {
    institution?: string | null;
    degree?: string | null;
    year_end?: string | null;
  }[];
}

export interface InterviewInstructionContext {
  jobTitle?: string;
  resume?: InterviewResume | null;
  /** Defaults to `general`. */
  format?: InterviewFormat;
  /** The campaign's configured interviewing stance. Defaults to `neutral`. */
  persona?: InterviewPersona;
}

/** How many résumé items to surface — enough to anchor questions, not a data dump. */
const MAX_SKILLS = 12;
const MAX_ROLES = 4;
const MAX_EDUCATION = 2;

function cleanList(items: (string | null | undefined)[]): string[] {
  return items.map((s) => (s ?? "").trim()).filter((s) => s.length > 0);
}

/**
 * Condense the résumé into one compact reference block the agent reads before
 * the call. Returns null when there is no usable signal (no name, skills, or
 * experience) so the caller can fall back to a general interview.
 */
export function summarizeResumeForInterview(
  resume: InterviewResume | null | undefined,
): string | null {
  if (!resume) return null;

  const name = (resume.fullName ?? "").trim();
  const headline = (resume.headline ?? "").trim();
  const summary = (resume.summary ?? "").trim();
  const skills = cleanList(resume.skills ?? []).slice(0, MAX_SKILLS);

  const roles = (resume.experience ?? [])
    .map((e) => {
      const title = (e.title ?? "").trim();
      const company = (e.company ?? "").trim();
      const duration = (e.duration ?? "").trim();
      const desc = (e.description ?? "").trim();
      const head = [title, company].filter(Boolean).join(" at ");
      if (!head && !desc) return "";
      const when = duration ? ` (${duration})` : "";
      const tail = desc ? ` — ${desc}` : "";
      return `${head}${when}${tail}`.trim();
    })
    .filter((s) => s.length > 0)
    .slice(0, MAX_ROLES);

  const education = (resume.education ?? [])
    .map((e) => {
      const degree = (e.degree ?? "").trim();
      const inst = (e.institution ?? "").trim();
      const year = (e.year_end ?? "").trim();
      const head = [degree, inst].filter(Boolean).join(", ");
      if (!head) return "";
      return year ? `${head} (${year})` : head;
    })
    .filter((s) => s.length > 0)
    .slice(0, MAX_EDUCATION);

  // No name/skills/roles/education at all → nothing to ground on.
  if (!name && skills.length === 0 && roles.length === 0 && education.length === 0) {
    return null;
  }

  const lines: string[] = [];
  if (name) lines.push(`Name: ${name}${headline ? ` — ${headline}` : ""}`);
  else if (headline) lines.push(`Headline: ${headline}`);
  if (summary) lines.push(`Profile: ${summary}`);
  if (skills.length) lines.push(`Skills: ${skills.join(", ")}`);
  if (roles.length) {
    lines.push("Experience:");
    for (const r of roles) lines.push(`  - ${r}`);
  }
  if (education.length) lines.push(`Education: ${education.join("; ")}`);

  return lines.join("\n");
}

const FORMAT_FOCUS: Record<InterviewFormat, string> = {
  general:
    "a balanced mix of technical depth and behavioral judgment, drawn from their real experience",
  technical_qa:
    "focused technical questions on the tools, languages, and systems they've actually used",
  behavioral:
    "behavioral questions about how they've worked, collaborated, and handled hard situations (ask for concrete past examples, not hypotheticals)",
  system_design:
    "a system-design discussion appropriate to their level, starting from a system they've actually built",
  code_reading:
    "reading and reasoning about code — walk through logic, spot issues, and explain trade-offs",
};

/**
 * How each persona changes the interviewer's stance (PRD 3.5.8).
 *
 * `neutral` is deliberately `null`, not prose: the base instructions already
 * describe a warm, professional, strictly neutral interviewer, so the default
 * campaign emits exactly the instruction string it did before personas existed.
 * That keeps every pre-persona transcript comparable with a neutral one instead
 * of splitting the corpus on a no-op reword.
 *
 * Each directive shifts HOW the interviewer probes, never WHAT it discloses —
 * the neutrality rules below (no scores, no feedback, no right/wrong) bind all
 * four stances, so a persona can't be used to leak an assessment.
 */
const PERSONA_DIRECTIVE: Record<InterviewPersona, string | null> = {
  neutral: null,
  pressure:
    "Your interviewing stance — PRESSURE: test composure. Press hard on every claim: ask for the specific numbers, the option they rejected and why, the part that went wrong. When an answer sounds comfortable or well-rehearsed, push back on it directly — ask what they would say to someone who argued the opposite, and follow a thread to its limit before moving on. Stay courteous throughout: challenge the reasoning, never the person, and never tell them an answer is wrong. Press until the reasoning either holds up or runs out.",
  collaborative:
    "Your interviewing stance — COLLABORATIVE: work the problem together. Treat each question as a shared discussion — think aloud with them, build on what they just said, and invite them to explore alternatives they didn't take. Keep the warmth high and the challenge conversational. This is not leniency: still probe for concrete specifics, but reach them by exploring alongside the candidate rather than interrogating.",
  socratic:
    "Your interviewing stance — SOCRATIC: lead with questions, never answers. Do not explain, do not confirm, and do not supply the term the candidate is reaching for — let them find it. When they assert something, ask what it rests on; when they reach a conclusion, ask what would have to be true for it to fail. Go one layer deeper with each follow-up, so the depth of their understanding shows through their own reasoning rather than your prompting.",
};

/**
 * Compose the interview agent's instructions.
 *
 * The anti-gaming design mirrors screening: the résumé is given as reference so
 * the agent can anchor every question to the candidate's real background, with
 * explicit orders to (a) open on something specific from their history, (b) ask
 * unscripted follow-ups that push for specifics only the real author would know,
 * and (c) stay neutral. A prepared answer survives the opener and collapses on
 * the probe.
 */
export function buildInterviewInstructions(
  ctx: InterviewInstructionContext,
): string {
  const { jobTitle, resume, format = "general", persona = "neutral" } = ctx;
  const role = jobTitle ? ` for the ${jobTitle} role` : "";
  const resumeSummary = summarizeResumeForInterview(resume);

  const resumeBlock = resumeSummary
    ? [
        "",
        "The candidate's résumé (your reference — read it before you begin):",
        resumeSummary,
        "",
      ].join("\n")
    : "\n(No résumé was available — open by asking the candidate to walk you through their background, then probe from there.)\n";

  const personaDirective = PERSONA_DIRECTIVE[persona];
  // `neutral` contributes no lines at all, so its output is byte-identical to
  // the pre-persona instructions.
  const personaBlock = personaDirective ? ["", personaDirective] : [];

  return [
    `You are a warm, professional AI interviewer${role} for Screenr AI, running a live video interview. Speak naturally and conversationally, never robotically. This is a real two-way conversation on camera.`,
    resumeBlock,
    `Focus of this interview: ${FORMAT_FOCUS[format]}.`,
    ...personaBlock,
    "",
    "How to run the interview:",
    "- Open by referencing something specific from their résumé (a role, a project, a skill) — show you've read it. Never say you're reading from a script.",
    "- Anchor your questions in their ACTUAL experience. Ask them to go deep on things they claim: decisions they made, trade-offs they weighed, what broke and how they fixed it.",
    "- After each answer, ask 1–2 SHORT, UNSCRIPTED follow-up questions based on what they just said. Push for specifics, concrete examples, and reasoning — the details only the real author of that work would know.",
    "- If an answer is vague, generic, or sounds rehearsed or AI-generated, probe deeper with a pointed, specific question before moving on.",
    "- One question at a time. Let them finish. If they go silent or ask you to repeat, briefly rephrase.",
    "- Stay strictly neutral: do not reveal scores, do not say whether an answer is right or wrong, and do not give feedback, hints, or coaching.",
    "",
    "Pacing — this interview is SHORT, so budget deliberately:",
    `- The call ends automatically after ${INTERVIEW_DURATION_MINUTES} minutes. Anything unasked by then is lost, so do not save your best question for the end.`,
    `- Plan for about ${INTERVIEW_TARGET_QUESTIONS} main questions total, each with its 1–2 follow-ups. Count them as you go — that is your budget, not the clock.`,
    "- Keep your own turns brief. Ask the question and stop talking; do not preface it with a summary of their answer or a paragraph of context. Their talking time is the point of this interview.",
    `- Once you have asked your ${INTERVIEW_TARGET_QUESTIONS} questions, wrap up immediately even if time seems to remain: thank them warmly, tell them the hiring team will follow up by email, and end. Do not pad the interview to fill time.`,
    "",
    "Begin by briefly greeting the candidate by name, confirming you can see and hear each other, and asking your first résumé-grounded question.",
  ].join("\n");
}
