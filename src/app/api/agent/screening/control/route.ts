import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyScreeningControlEvent } from "@/lib/screening/topic-control";
import { buildInterviewControlBlock } from "@/lib/services/realtime";
import { uuidSchema } from "@/lib/validations";
import { requireBearerSecret } from "@/lib/auth/guards";

// Service-role read/write driven by a machine caller — always run on the
// server, never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Agent-control endpoint: the screening agent worker (agents/screening/) reports
 * what just happened on a live call, and is told what the interviewer should do
 * next.
 *
 * This is the third of the app→worker channels, and the only one that is a
 * conversation rather than a report. It exists because coverage cannot be
 * enforced from inside the worker: the topic ledger has to survive a
 * reconnect, has to be auditable afterwards, and has to be the same code the
 * tests exercise — all of which mean it lives in the app.
 *
 * Auth mirrors the other agent routes: `Authorization: Bearer ${AGENT_API_SECRET}`,
 * failing closed when the secret is unset.
 *
 * A 404 means "there is nothing to control here" (unknown application, or a
 * campaign with no screening questions) and the worker carries on unmanaged —
 * exactly the behaviour that existed before this route. It is deliberately NOT
 * fatal, unlike the instructions route: an interviewer with no instructions has
 * nothing to say, whereas an interviewer with no ledger still has its topic
 * guide.
 */
/** One id bound, so the eight events cannot end up with eight different ones. */
const eventId = z.string().min(1).max(200);

/**
 * An event that carries nothing but its own name.
 *
 * Five of the eight are this. Spelled out, they were five copies of one object
 * differing in a string literal — and the id bound written out eight times is
 * eight chances for the ninth to be written differently.
 */
const bare = <T extends string>(type: T) => z.object({ type: z.literal(type), event_id: eventId });

const bodySchema = z.object({
  application_id: uuidSchema,
  event: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("session_started"),
      event_id: eventId,
      started_at: z.iso.datetime(),
    }),
    z.object({
      type: z.literal("topic_started"),
      event_id: eventId,
      // Optional: an older worker does not send it, and its absence reads as
      // "the interviewer asked for this through `next_topic`" — the reading
      // that withholds a correction rather than inventing one.
      stamped: z.boolean().optional(),
    }),
    z.object({
      type: z.literal("turn_completed"),
      event_id: eventId,
      // Bounded because it is a single spoken turn, and because it reaches a
      // model: an unbounded body is an unbounded prompt.
      candidate_text: z.string().min(1).max(8000),
      interviewer_text: z.string().max(8000).nullable(),
    }),
    bare("answer_started"),
    // `close_requested` is the pull protocol's, kept because workers deploy
    // before the app and an older one still sends it. `follow_up_asked` was
    // dropped with follow-ups themselves (2026-08-27): there is no count left
    // for it to increment, so accepting it would mean keeping the whole budget
    // alive to service an event nothing sends.
    bare("answer_timeout"),
    // Our own failure, reported by the only party that can see it: the
    // candidate answered and the transcription sidecar returned nothing. It
    // carries no topic, deliberately — the worker only learns an answer was
    // lost once the call has moved on, so any topic it named would be the
    // wrong one.
    bare("answer_unheard"),
    bare("wrap_up_due"),
    bare("close_requested"),
  ]),
});

export async function POST(request: Request) {
  const denied = requireBearerSecret(request, "AGENT_API_SECRET", "agent control");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const result = await applyScreeningControlEvent({
    applicationId: parsed.data.application_id,
    event: toEvent(parsed.data.event),
    db: createAdminClient(),
    now: new Date(),
  });

  if (!result) {
    return NextResponse.json({ error: "No screening to control" }, { status: 404 });
  }

  return NextResponse.json({
    directive: result.directive,
    close_allowed: result.closeAllowed,
    control_block: buildInterviewControlBlock(result.directive),
    wrap_up_in_ms: result.wrapUpInMs,
    answer_due_in_ms: result.answerDueInMs,
    answer_running: result.answerRunning,
    deadline_at: result.deadlineAt,
  });
}

/** Wire shape (snake_case) → pipeline shape (camelCase). */
function toEvent(event: z.infer<typeof bodySchema>["event"]) {
  switch (event.type) {
    case "session_started":
      return {
        type: "session_started" as const,
        eventId: event.event_id,
        startedAt: event.started_at,
      };
    case "turn_completed":
      return {
        type: "turn_completed" as const,
        eventId: event.event_id,
        candidateText: event.candidate_text,
        interviewerText: event.interviewer_text,
      };
    case "topic_started":
      return {
        type: "topic_started" as const,
        eventId: event.event_id,
        stamped: event.stamped === true,
      };
    default:
      return { type: event.type, eventId: event.event_id };
  }
}
