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
