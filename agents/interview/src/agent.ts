/**
 * Screenr AI video-interview agent worker.
 *
 * A standalone LiveKit Agents process (NOT part of the Next.js app), forked
 * from the screening worker. The app opens a room per interview attempt
 * (`createInterviewRoomGrant`) carrying the application id in room metadata;
 * LiveKit dispatches this worker into the room, where it FETCHES its
 * résumé-grounded interviewer instructions from the app, runs the conversation
 * over OpenAI Realtime, and reports every transcript turn back to the app's
 * interview agent API route. The worker never touches application state — it
 * produces evidence (the transcript); the app's rules decide everything else.
 *
 * The instructions are fetched rather than read off the room because LiveKit
 * delivers room metadata to every participant: while they rode in metadata, the
 * candidate's own browser received the condensed copy of their résumé and the
 * campaign's interviewing stance on join. Metadata now carries the application
 * id alone.
 *
 * The candidate publishes camera + mic. This worker drives the spoken
 * conversation off the audio track; the camera feed is present in the room for
 * recording + proctoring, which are handled in later phases (frame sampling +
 * vision analysis) rather than here.
 *
 * Env (see .env.example): LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
 * (read by the agents CLI), OPENAI_API_KEY (Realtime), SCREENR_APP_ORIGIN +
 * AGENT_API_SECRET (fetching instructions and reporting transcript, proctoring
 * and snapshots — the worker cannot run an interview without them any more,
 * where before they only cost it the evidence).
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
import {
  startVisionProctoring,
  type VisionObservation,
  type VisionSnapshot,
} from "./vision.js";

/** Mirrors `InterviewTranscriptTurn` in the app (src/lib/data/interview-sessions.ts). */
interface TranscriptTurn {
  role: "agent" | "candidate";
  text: string;
  at: string;
}

/**
 * Mirrors `InterviewRoomMetadata` in the app (src/lib/services/livekit.ts).
 *
 * `instructions` is the LEGACY field: the app stopped publishing it on
 * 2026-08-24 because room metadata is candidate-visible. It is still read as a
 * fallback so this worker runs against an app deployed either side of that
 * change — which is what makes "restart the workers first" a safe rollout. Once
 * the app is deployed, this field is dead and can be deleted.
 */
interface InterviewRoomMetadata {
  application_id: string;
  instructions?: string;
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
    if (typeof data.application_id !== "string") return null;
    return {
      application_id: data.application_id,
      instructions:
        typeof data.instructions === "string" ? data.instructions : undefined,
    };
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
/**
 * POST one report to the app's agent API.
 *
 * Every report this worker makes — transcript, proctoring readings, evidence
 * stills — crosses the same boundary with the same shared secret and the same
 * best-effort contract, so the boundary lives in one place. Losing a report
 * costs a recruiter some evidence; it must never cost the candidate their
 * interview, so nothing here throws.
 */
async function postToApp(path: string, label: string, body: unknown): Promise<void> {
  const origin = process.env.SCREENR_APP_ORIGIN;
  const secret = process.env.AGENT_API_SECRET;
  if (!origin || !secret) {
    console.error(
      `SCREENR_APP_ORIGIN / AGENT_API_SECRET not configured; cannot send ${label}`,
    );
    return;
  }

  try {
    const res = await fetch(`${origin}/api/agent/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`${label} failed (${res.status})`);
    }
  } catch (err) {
    console.error(`${label} failed:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Fetch this interview's instructions from the app.
 *
 * Deliberately NOT routed through `postToApp`: everything there is a
 * best-effort report whose loss costs a recruiter some evidence, and nothing in
 * it throws. This is the opposite — without instructions there is no interview
 * to run, so the caller fails loudly rather than improvising questions against
 * a rubric nobody chose.
 */
async function fetchInstructions(applicationId: string): Promise<string | null> {
  const origin = process.env.SCREENR_APP_ORIGIN;
  const secret = process.env.AGENT_API_SECRET;
  if (!origin || !secret) {
    console.error(
      "SCREENR_APP_ORIGIN / AGENT_API_SECRET not configured; cannot fetch instructions",
    );
    return null;
  }

  try {
    const url = `${origin}/api/agent/interview/instructions?application_id=${encodeURIComponent(applicationId)}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${secret}` } });
    if (!res.ok) {
      console.error(`instructions fetch failed (${res.status}) for ${applicationId}`);
      return null;
    }
    const data = (await res.json()) as { instructions?: unknown };
    return typeof data.instructions === "string" && data.instructions.length > 0
      ? data.instructions
      : null;
  } catch (err) {
    console.error("instructions fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function reportTranscript(applicationId: string, turns: TranscriptTurn[]): Promise<void> {
  if (turns.length === 0) return;
  await postToApp("interview/transcript", "transcript report", {
    application_id: applicationId,
    transcript: turns,
  });
}

/**
 * Upload one evidence still for a flagged frame.
 *
 * The image goes through the app rather than straight to storage on purpose:
 * the worker already holds `AGENT_API_SECRET` and nothing more, so it never
 * needs storage credentials, and the app stays the single place that decides
 * where a candidate's image may be written.
 *
 * Sends the raw counts, not a named finding — the app's rule layer owns what a
 * set of counts means, so the label is derived on receipt rather than agreed
 * across a package boundary.
 */
async function reportSnapshot(
  applicationId: string,
  snapshot: VisionSnapshot,
): Promise<void> {
  await postToApp("interview/snapshot", "snapshot upload", {
    application_id: applicationId,
    at: snapshot.at,
    person_count: snapshot.person_count,
    phone_count: snapshot.phone_count,
    image_base64: snapshot.jpeg.toString("base64"),
  });
}

/**
 * Report the vision-proctoring samples so far (Phase C2), same idempotent
 * overwrite as the transcript.
 */
async function reportVisionObservations(
  applicationId: string,
  observations: VisionObservation[],
): Promise<void> {
  if (observations.length === 0) return;
  await postToApp("interview/proctoring", "proctoring report", {
    application_id: applicationId,
    observations,
  });
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();

    // Only run in rooms the app created for an interview; metadata carries the
    // application id, and is set server-side only.
    const meta = parseMetadata(ctx.room.metadata);
    if (!meta || !ctx.room.name?.startsWith("interview-")) {
      console.warn(`not an interview room (${ctx.room.name}); leaving`);
      return;
    }

    // Fetch first, fall back to metadata for an app deployed before the
    // instructions moved off the room. Failing here is loud on purpose:
    // silence is the one outcome the candidate cannot recover from on their own.
    const instructions =
      (await fetchInstructions(meta.application_id)) ?? meta.instructions ?? null;
    if (!instructions) {
      console.error(
        `no interviewer instructions for ${meta.application_id} — the candidate would hear ` +
          `silence. Check SCREENR_APP_ORIGIN / AGENT_API_SECRET.`,
      );
      throw new Error(`no instructions for application ${meta.application_id}`);
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

    // Watch the camera for proctoring evidence (Phase C2). Entirely separate
    // from the conversation above: the interviewer never sees these readings, so
    // it can't react to them mid-interview. Serialized like the transcript so
    // two reports can't overwrite each other out of order.
    let visionReporting: Promise<void> = Promise.resolve();
    const vision = startVisionProctoring(
      ctx,
      (observations) => {
        visionReporting = visionReporting.then(() =>
          reportVisionObservations(meta.application_id, observations),
        );
      },
      (snapshot) => {
        // Evidence stills ride the same serialized chain, so an upload can't
        // race the observation report that gives it meaning.
        visionReporting = visionReporting.then(() =>
          reportSnapshot(meta.application_id, snapshot),
        );
      },
    );

    // Final flush when the job winds down (candidate left / room closed).
    ctx.addShutdownCallback(async () => {
      vision.stop();
      await reporting;
      await reportTranscript(meta.application_id, [...turns]);
      await visionReporting;
      await reportVisionObservations(meta.application_id, vision.observations());
    });

    const agent = new voice.Agent({ instructions });

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

/**
 * Named worker => EXPLICIT dispatch: LiveKit only sends this worker jobs that
 * ask for it by name (the app's `createInterviewRoomGrant` requests it on the
 * candidate's join token). Without a name, this worker and the screening worker
 * both sit in the same automatic-dispatch pool, and LiveKit hands each new room
 * to whichever it picks — so roughly half of all interviews went to the
 * screening worker, which saw the `interview-` prefix, left, and stranded the
 * candidate with "the interviewer didn't join".
 *
 * Must stay in sync with INTERVIEW_AGENT_NAME in src/lib/services/livekit.ts.
 */
export const INTERVIEW_AGENT_NAME = "screenr-interview";

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: INTERVIEW_AGENT_NAME,
  }),
);
