/**
 * OpenAI Realtime (speech-to-speech) session service.
 *
 * Mints a short-lived *ephemeral* client secret server-side using the secret
 * `OPENAI_API_KEY`. The browser uses that ephemeral key to open a WebRTC
 * connection directly to OpenAI — the secret key never reaches the client, and
 * the SDP exchange does not pass through our server. See docs/voice-screening.md.
 */

/** Realtime speech-to-speech model. Bound to the ephemeral session server-side.
 *  Override with OPENAI_REALTIME_MODEL if OpenAI bumps the id (e.g. gpt-realtime-2). */
export const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";

/** Default agent voice. */
export const REALTIME_VOICE = "alloy";

/** Spike (#81) instructions — a bare connectivity/mic check, no scoring. The
 *  real screening script (#82) replaces this with the campaign questions. */
const SPIKE_INSTRUCTIONS =
  "You are Screenr AI's voice assistant running a quick connection test. " +
  "Greet the candidate warmly, tell them this is a short microphone check for " +
  "the screening step, ask them to say hello back, and confirm you can hear " +
  "them. Keep it under 20 seconds and friendly.";

export interface ScreeningQuestionForVoice {
  prompt: string;
  is_required: boolean;
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
        .map((q, i) => `  ${i + 1}. ${q.prompt}${q.is_required ? "  [required]" : "  [optional]"}`)
        .join("\n")
    : "  (No preset topics — probe the candidate's background and motivation for the role.)";

  const resumeLine = resumeSummary
    ? `\n- Anchor at least one question to the candidate's actual background: ${resumeSummary}`
    : "";

  return [
    `You are a friendly, professional voice screening interviewer${role} for Screenr AI. This is a live spoken conversation — speak naturally and conversationally, never robotically.`,
    "",
    "Your internal topic guide (cover these — required ones are mandatory, optional ones if time allows):",
    topics,
    "",
    "Rules of the conversation:",
    "- NEVER read the topics aloud verbatim or as a numbered list, and never dictate or spell them out. Weave each into natural conversation, one at a time.",
    "- After each answer, ask 1–2 SHORT, UNSCRIPTED follow-up questions based on what the candidate actually just said — push for specifics, concrete examples, decisions, and trade-offs. This is to confirm genuine, lived experience rather than rehearsed answers.",
    "- If an answer is vague, generic, or sounds read off a script, probe deeper with a pointed specific question before moving on." + resumeLine,
    "- Stay neutral: do not reveal scores, do not say whether an answer is right or wrong, and do not give feedback or hints.",
    "- One question at a time. Let them finish. If they go silent or ask you to repeat, briefly rephrase.",
    "- Keep the whole call focused (about 5–8 minutes). When the required topics are covered, thank them warmly and tell them the hiring team will follow up by email. Then end.",
    "",
    "Begin by briefly greeting the candidate, confirming you can hear each other, and asking your first question.",
  ].join("\n");
}

export interface RealtimeSession {
  /** Ephemeral client secret the browser uses to authenticate the WebRTC call. */
  clientSecret: string;
  /** Unix seconds at which the ephemeral secret expires. */
  expiresAt: number;
  /** Model the browser must name in its SDP request. */
  model: string;
}

interface CreateSessionOptions {
  instructions?: string;
}

/**
 * Create an ephemeral Realtime session. Throws on missing key or a non-OK
 * response (explicit failure — never returns a half-built session).
 */
export async function createRealtimeSession(
  opts: CreateSessionOptions = {},
): Promise<RealtimeSession> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: REALTIME_MODEL,
        instructions: opts.instructions ?? SPIKE_INSTRUCTIONS,
        audio: { output: { voice: REALTIME_VOICE } },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `OpenAI Realtime session create failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  // GA client_secrets response: { value, expires_at, session: {...} }.
  const data = (await res.json()) as { value?: string; expires_at?: number };

  const value = data.value;
  if (!value) {
    throw new Error("OpenAI Realtime session response missing client secret value");
  }

  return { clientSecret: value, expiresAt: data.expires_at ?? 0, model: REALTIME_MODEL };
}
