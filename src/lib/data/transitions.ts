import { createClient } from "@/lib/supabase/server";
import {
  APPLICATION_STATE_TRANSITIONS,
  type ApplicationState,
  type TransitionActor,
} from "@/lib/constants";

export interface TransitionParams {
  applicationId: string;
  toState: ApplicationState;
  actor: TransitionActor;
  rationale?: string;
}

/**
 * The single entry point for mutating `applications.status`.
 *
 * Enforces the ATS state-machine rules (see CLAUDE.md → ATS State Machine Rules):
 *   1. The from_state → to_state transition must be legal per
 *      APPLICATION_STATE_TRANSITIONS.
 *   2. Recruiter actors must supply a written rationale (override logging).
 *   3. State change and audit-log insert happen atomically in the DB via
 *      the `transition_application` RPC — either both succeed or both fail.
 *
 * Never call `.update({ status: ... })` on applications outside this function.
 */
export async function transitionApplication(params: TransitionParams): Promise<void> {
  const { applicationId, toState, actor, rationale } = params;

  if (actor === "recruiter" && (!rationale || rationale.trim().length === 0)) {
    throw new Error("Manual overrides require a written rationale");
  }

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Pre-flight validation so we fail fast with a readable error before the RPC.
  // The RPC itself also enforces ownership + row-level concurrency.
  const { data: app, error: fetchError } = await supabase
    .from("applications")
    .select("status")
    .eq("id", applicationId)
    .single();

  if (fetchError || !app) throw new Error("Application not found");

  const fromState = app.status as ApplicationState;

  if (fromState === toState) return; // no-op

  const allowed = APPLICATION_STATE_TRANSITIONS[fromState] ?? [];
  if (!allowed.includes(toState)) {
    throw new Error(`Illegal transition: ${fromState} → ${toState}`);
  }

  // RPC not yet present in generated Database types — cast the rpc call.
  // Run `supabase gen types typescript` after migration to drop this.
  const { error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>
  )("transition_application", {
    p_application_id: applicationId,
    p_to_state: toState,
    p_actor: actor,
    p_rationale: rationale ?? null,
  });

  if (error) {
    console.error("transition_application RPC failed:", error);
    throw new Error(`Transition failed: ${error.message}`);
  }
}
