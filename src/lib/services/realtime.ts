/**
 * Voice-screening interview instructions.
 *
 * Since the LiveKit migration, the Realtime conversation itself runs in the
 * server-side agent worker (`agents/screening/`) — this module only composes
 * the interviewer instructions, which travel to the worker via LiveKit room
 * metadata (set server-side in `createScreeningRoomGrant`; the candidate can't
 * touch them). The old direct-to-OpenAI ephemeral-session minting was removed
 * with the migration.
 */

export interface ScreeningQuestionForVoice {
  prompt: string;
}

interface ScreeningInstructionContext {
  questions: ScreeningQuestionForVoice[];
  jobTitle?: string;
  /** A short candidate background summary, used to anchor one probe to their CV. */
  resumeSummary?: string;
}

/**
 * Compose the Realtime session instructions for a screening call (issue #82).
 *
 * The anti-gaming design lives here: the questions are given to the agent as
 * *internal goals*, with explicit orders to (a) never read them verbatim or as
 * a list, (b) ask 1–2 unscripted follow-up probes per answer drawn from what
 * the candidate actually said, and (c) anchor at least one question to their
 * CV. A prepared/ChatGPT answer survives the scripted question and collapses on
 * the follow-up. See docs/voice-screening.md. Pure + deterministic.
 */
export function buildScreeningInstructions(ctx: ScreeningInstructionContext): string {
  const { questions, jobTitle, resumeSummary } = ctx;
  const role = jobTitle ? ` for the ${jobTitle} role` : "";

  const topics = questions.length
    ? questions
        .map((q, i) => `  ${i + 1}. ${q.prompt}`)
        .join("\n")
    : "  (No preset topics — probe the candidate's background and motivation for the role.)";

  const resumeLine = resumeSummary
    ? `\n- Anchor at least one question to the candidate's actual background: ${resumeSummary}`
    : "";

  return [
    `You are a friendly, professional voice screening interviewer${role} for Screenr AI. This is a live spoken conversation — speak naturally and conversationally, never robotically.`,
    "",
    "Your internal topic guide (cover EVERY one of these — a topic you do not reach is scored as unanswered and counts against the candidate):",
    topics,
    "",
    "Rules of the conversation:",
    "- NEVER read the topics aloud verbatim or as a numbered list, and never dictate or spell them out. Weave each into natural conversation, one at a time.",
    "- After each answer, ask 1–2 SHORT, UNSCRIPTED follow-up questions based on what the candidate actually just said — push for specifics, concrete examples, decisions, and trade-offs. This is to confirm genuine, lived experience rather than rehearsed answers.",
    "- If an answer is vague, generic, or sounds read off a script, probe deeper with a pointed specific question before moving on." + resumeLine,
    "- Stay neutral: do not reveal scores, do not say whether an answer is right or wrong, and do not give feedback or hints.",
    "- One question at a time. Let them finish. If they go silent or ask you to repeat, briefly rephrase.",
    "- Keep the whole call focused (about 5 minutes). If time is short, cover the remaining topics briefly rather than dropping any — an unasked question scores zero, so skipping one penalises the candidate for your pacing.",
    "- When every topic is covered, thank them warmly and tell them the hiring team will follow up by email. Then end.",
    "",
    "Begin by briefly greeting the candidate, confirming you can hear each other, and asking your first question.",
  ].join("\n");
}

