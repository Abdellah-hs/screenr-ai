/**
 * Screenr AI video-interview agent worker.
 *
 * A standalone LiveKit Agents process (NOT part of the Next.js app), forked
 * from the screening worker. The app opens a room per interview attempt
 * (`createInterviewRoomGrant`) with the résumé-grounded interviewer
 * instructions in the room metadata; LiveKit dispatches this worker into the
 * room, where it runs the conversation over OpenAI Realtime and reports every
 * transcript turn back to the app's interview agent API route. The worker never
 * touches application state — it produces evidence (the transcript); the app's
 * rules decide everything else.
 *
 * The candidate publishes camera + mic. This worker drives the spoken
 * conversation off the audio track; the camera feed is present in the room for
 * recording + proctoring, which are handled in later phases (frame sampling +
 * vision analysis) rather than here.
 *
 * Env (see .env.example): LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
 * (read by the agents CLI), OPENAI_API_KEY (Realtime), SCREENR_APP_ORIGIN +
 * AGENT_API_SECRET (transcript reporting).
 *
 * Run: `pnpm dev` (hot-reload against LiveKit Cloud) or `pnpm start`.
 */
import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
} from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import { fileURLToPath } from "node:url";
import "dotenv/config";

/** Mirrors `InterviewTranscriptTurn` in the app (src/lib/data/interview-sessions.ts). */
interface TranscriptTurn {
  role: "agent" | "candidate";
  text: string;
  at: string;
}

/** Mirrors `InterviewRoomMetadata` in the app (src/lib/services/livekit.ts). */
interface InterviewRoomMetadata {
  application_id: string;
  instructions: string;
}

// Must be a Realtime model the OPENAI_API_KEY can actually access. This account
// only has the GA `gpt-realtime*` family — verify with `GET /v1/models` before
// changing. A model the key can't reach fails the session the instant it opens,
// leaving the candidate in a silent room.
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";

function parseMetadata(raw: string | undefined): InterviewRoomMetadata | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<InterviewRoomMetadata>;
    if (typeof data.application_id !== "string" || typeof data.instructions !== "string") {
      return null;
    }
    return { application_id: data.application_id, instructions: data.instructions };
  } catch {
    return null;
  }
}

/**
 * Report the full transcript so far to the app (idempotent overwrite of the
 * draft). Called after every new turn rather than once at the end, so a crashed
 * worker or dropped call loses at most the final turn — and so the draft is
 * already complete when the candidate reaches the review step.
 */
async function reportTranscript(applicationId: string, turns: TranscriptTurn[]): Promise<void> {
  const origin = process.env.SCREENR_APP_ORIGIN;
  const secret = process.env.AGENT_API_SECRET;
  if (!origin || !secret) {
    console.error("SCREENR_APP_ORIGIN / AGENT_API_SECRET not configured; cannot report transcript");
    return;
  }
  if (turns.length === 0) return;

  try {
    const res = await fetch(`${origin}/api/agent/interview/transcript`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ application_id: applicationId, transcript: turns }),
    });
    if (!res.ok) {
      console.error(`transcript report failed (${res.status}) for ${applicationId}`);
    }
  } catch (err) {
    console.error("transcript report failed:", err instanceof Error ? err.message : err);
  }
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();

    // Only run in rooms the app created for an interview; metadata carries the
    // application id + interviewer instructions and is set server-side only.
    const meta = parseMetadata(ctx.room.metadata);
    if (!meta || !ctx.room.name?.startsWith("interview-")) {
      console.warn(`not an interview room (${ctx.room.name}); leaving`);
      return;
    }

    // Print the model in use so a stale worker is obvious: `dev` mode does NOT
    // hot-reload, so an old process keeps its old model until fully restarted.
    console.info(
      `video interview starting — model=${REALTIME_MODEL} voice=${REALTIME_VOICE} app=${meta.application_id}`,
    );

    const turns: TranscriptTurn[] = [];
    // Serializes reports so a fast exchange can't interleave two overwrites
    // out of order.
    let reporting: Promise<void> = Promise.resolve();
    const queueReport = () => {
      const snapshot = [...turns];
      reporting = reporting.then(() => reportTranscript(meta.application_id, snapshot));
    };

    const session = new voice.AgentSession({
      // Speech-to-speech: OpenAI Realtime handles STT, the conversation, VAD
      // and TTS in one model.
      llm: new openai.realtime.RealtimeModel({
        model: REALTIME_MODEL,
        voice: REALTIME_VOICE,
      }),
    });

    // Every finalized conversation item (agent or candidate) becomes one
    // transcript turn, stamped server-side — the browser never supplies these.
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const item = ev.item;
      if (!("role" in item)) return;
      const text = item.textContent?.trim();
      if (!text) return;
      turns.push({
        role: item.role === "assistant" ? "agent" : "candidate",
        text,
        at: new Date().toISOString(),
      });
      queueReport();
    });

    // Final flush when the job winds down (candidate left / room closed).
    ctx.addShutdownCallback(async () => {
      await reporting;
      await reportTranscript(meta.application_id, [...turns]);
    });

    const agent = new voice.Agent({ instructions: meta.instructions });

    // If the Realtime session can't open (e.g. a model the key can't access),
    // the candidate would otherwise just sit in a silent room. Fail loudly here
    // with the model name so the cause is obvious in the worker logs.
    try {
      await session.start({ agent, room: ctx.room });

      // Kick off the greeting so the candidate hears the interviewer first.
      await session.generateReply({
        instructions:
          "Briefly greet the candidate by name if you know it, confirm you can see and hear each other, explain this is a short interview, and ask your first question.",
      });
    } catch (err) {
      console.error(
        `Realtime session failed to start (model=${REALTIME_MODEL}, voice=${REALTIME_VOICE}) — ` +
          `the candidate will hear silence. Verify the model is accessible to OPENAI_API_KEY.`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
