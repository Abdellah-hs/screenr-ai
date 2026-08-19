import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TransitionRow } from "@/lib/rules/transition-timeline";
import {
  APPLICATION_STATE_TRANSITIONS,
  requiresDisposition,
  type ApplicationState,
  type Disposition,
  type TransitionActor,
} from "@/lib/constants";

export interface TransitionParams {
  applicationId: string;
  toState: ApplicationState;
  actor: TransitionActor;
  rationale?: string;
  /**
   * Why the application closed. Required when `toState` closes it —
   * see `requiresDisposition`.
   */
  disposition?: Disposition;
}

/**
 * Shared by both transition variants: a closing state must carry a structured
 * reason, not just prose.
 *
 * Enforced here rather than left to each caller for the same reason the
 * recruiter-rationale rule is — this function is the only door, so a check at
 * the door cannot be forgotten by the next caller someone writes. The RPC and
 * a table constraint repeat it, because an app-layer rule protects only the
 * paths that go through the app.
 */
function assertDisposition(
  toState: ApplicationState,
  disposition: Disposition | undefined,
): void {
  if (!requiresDisposition(toState)) return;

  if (!disposition || disposition.description.trim().length === 0) {
    throw new Error(
      `Transition to ${toState} requires a disposition { code, description }`,
    );
  }
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
  const { applicationId, toState, actor, rationale, disposition } = params;

  if (actor === "recruiter" && (!rationale || rationale.trim().length === 0)) {
    throw new Error("Manual overrides require a written rationale");
  }

  assertDisposition(toState, disposition);

  const supabase = await createClient();

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
    p_disposition_code: disposition?.code ?? null,
    p_disposition_description: disposition?.description ?? null,
  });

  if (error) {
    console.error("transition_application RPC failed:", error);
    throw new Error(`Transition failed: ${error.message}`);
  }
}

/**
 * System transition for token-verified candidate actions that run WITHOUT a
 * recruiter session (e.g. interview booking). Uses the service-role client +
 * the `transition_application_system` RPC, which skips the owner check that
 * `transition_application` enforces. The caller MUST have verified the
 * candidate's signed token first. Actor is always `system`.
 *
 * Enforces the same legality check as `transitionApplication` before the RPC.
 */
export async function transitionApplicationAsSystem(
  applicationId: string,
  toState: ApplicationState,
  rationale?: string,
  disposition?: Disposition,
): Promise<void> {
  assertDisposition(toState, disposition);

  const supabase = createAdminClient();

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

  const { error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>
  )("transition_application_system", {
    p_application_id: applicationId,
    p_to_state: toState,
    p_rationale: rationale ?? null,
    p_disposition_code: disposition?.code ?? null,
    p_disposition_description: disposition?.description ?? null,
  });

  if (error) {
    console.error("transition_application_system RPC failed:", error);
    throw new Error(`Transition failed: ${error.message}`);
  }
}

/**
 * The full append-only history for one application, oldest-first.
 *
 * SELECT-only. RLS on `application_transitions` already scopes reads to the
 * owning recruiter (the policy joins through applications → campaigns), and the
 * action re-checks ownership before calling — the same belt-and-braces the rest
 * of the data layer uses.
 *
 * Ordered ascending because the timeline reads as a story and override
 * detection depends on the order: a recruiter action is only a reversal
 * relative to what came *before* it.
 */
export async function fetchApplicationTimeline(
  applicationId: string,
): Promise<TransitionRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("application_transitions")
    .select(
      "id, from_state, to_state, actor, rationale, disposition_code, disposition_description, created_at",
    )
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("fetchApplicationTimeline failed:", error);
    throw new Error(`Failed to load candidate history: ${error.message}`);
  }

  return (data ?? []) as unknown as TransitionRow[];
}
