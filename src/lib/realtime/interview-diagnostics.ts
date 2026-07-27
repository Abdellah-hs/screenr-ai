/**
 * Shared failure diagnosis for the realtime candidate flows (voice screening +
 * video interview). Both join a LiveKit room and wait for a server-side agent
 * worker to join and start speaking. When that doesn't happen the room would
 * otherwise sit silent with no explanation — the recurring "nothing happens"
 * symptom. These helpers turn that silence into a precise, actionable cause:
 * a friendly candidate-facing message plus a stable reason code for the console
 * trace, so during QA the exact failing stage is obvious (worker not running vs
 * agent joined-but-mute) instead of requiring a dig through worker logs.
 *
 * Pure + framework-free so it's unit-tested and shared, not duplicated per
 * component.
 */

/**
 * How long to wait after the room connects for the interviewer (agent) to join
 * and produce audio before declaring a failure. Generous: in practice the agent
 * joins within a few seconds and its audio track lands shortly after, so this
 * only fires on a genuine stall (e.g. no worker running).
 */
export const AGENT_JOIN_TIMEOUT_MS = 18_000;

export interface AgentSilenceContext {
  /** A remote (agent) participant actually connected to the room. */
  agentPresent: boolean;
  /** The agent's audio track was received and attached. */
  agentAudio: boolean;
}

export type AgentSilenceReason = "no_agent" | "agent_no_audio";

export interface AgentSilenceDiagnosis {
  /** Stable code for the console trace / telemetry — pinpoints the stage. */
  reason: AgentSilenceReason;
  /** Candidate-facing message (never leaks internal infra detail). */
  message: string;
  /** Developer-facing hint appended to the console trace during QA. */
  devHint: string;
}

/**
 * Decide why the interviewer is silent, given how far the connection got.
 *
 * - No agent participant ever joined → the interview service (agent worker)
 *   isn't running or wasn't dispatched to the room. This is the #1 cause during
 *   local dev: the app is up but the `agents/*` worker terminal isn't.
 * - Agent joined but never produced audio → the agent is in the room but its
 *   realtime session didn't start speaking (e.g. the OpenAI Realtime model is
 *   unreachable for the configured key).
 */
export function diagnoseAgentSilence(ctx: AgentSilenceContext): AgentSilenceDiagnosis {
  if (!ctx.agentPresent) {
    return {
      reason: "no_agent",
      message:
        "The interviewer didn't join. The interview service may be starting up or temporarily unavailable — please wait a moment and try again. If it keeps happening, contact the hiring team.",
      devHint:
        "No agent participant joined the room. In dev, confirm the agent worker is running (e.g. `cd agents/screening && pnpm dev`) and that its LiveKit project matches the app's.",
    };
  }
  return {
    reason: "agent_no_audio",
    message:
      "The interviewer joined but didn't start speaking. This is usually a brief hiccup — please try again. If it persists, contact the hiring team.",
    devHint:
      "The agent joined but never published audio. Check the worker log for a Realtime session error (e.g. the OPENAI_API_KEY can't reach the `gpt-realtime` model).",
  };
}

/** Consistent, greppable console trace so the exact failing stage is visible. */
export function realtimeTrace(scope: string, event: string, detail?: unknown): void {
  if (detail !== undefined) {
    console.info(`[${scope}] ${event}`, detail);
  } else {
    console.info(`[${scope}] ${event}`);
  }
}
