import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  appendProctoringSnapshot,
  fetchInterviewSessionByApplicationId,
} from "@/lib/data/interview-sessions";
import {
  deleteProctoringSnapshots,
  fetchInterviewContextByApplicationId,
  uploadProctoringSnapshot,
} from "@/lib/data/candidates";
import { uuidSchema, proctoringSnapshotSchema } from "@/lib/validations";

// Service-role write driven by a machine caller — always run on the server,
// never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Agent-report endpoint for proctoring evidence stills.
 *
 * When the worker's detector flags a frame — someone else in shot, nobody in
 * shot, a phone in view — it encodes that one frame as a small annotated JPEG
 * and posts it here. The image lands in a PRIVATE bucket and the session row
 * keeps only its object key.
 *
 * This is the one agent report that carries bytes rather than numbers, which is
 * why it is bounded harder than the others: a closed set of conditions, a
 * parseable timestamp, and a hard cap on the payload. It still accepts no
 * severity and no incident type — the worker says "this frame looked like X",
 * and the rule layer alone decides whether X ever amounted to anything.
 *
 * Routed through the app rather than uploading straight from the worker so the
 * worker never needs storage credentials: it holds `AGENT_API_SECRET` and
 * nothing more, and the app stays the single place that decides where a
 * candidate's image may be written.
 *
 * A still that doesn't end up inside a confirmed incident is DELETED at submit
 * (`attachSnapshots`), so the frames behind the detector's own false positives
 * are the ones that get thrown away rather than kept.
 */
const bodySchema = z
  .object({ application_id: uuidSchema })
  .and(proctoringSnapshotSchema);

export async function POST(request: Request) {
  const secret = process.env.AGENT_API_SECRET;
  if (!secret) {
    console.error("AGENT_API_SECRET is not configured; refusing agent report.");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const { application_id, at, condition, image_base64 } = parsed.data;
  const db = createAdminClient();

  // Check the session is open BEFORE spending an upload on it, so a replayed or
  // late report can't push images into the bucket for a finished interview.
  const session = await fetchInterviewSessionByApplicationId(application_id, db);
  if (!session || (session.status !== "invited" && session.status !== "in_progress")) {
    return NextResponse.json({ error: "Session is not open" }, { status: 409 });
  }

  // The campaign id is the first path segment the bucket's RLS scopes on, so it
  // comes from the application server-side — never from the caller.
  const ctx = await fetchInterviewContextByApplicationId(application_id, db);
  if (!ctx) {
    return NextResponse.json({ error: "Unknown application" }, { status: 404 });
  }

  const key = await uploadProctoringSnapshot(
    {
      campaignId: ctx.campaign_id,
      applicationId: application_id,
      at,
      image: Buffer.from(image_base64, "base64"),
    },
    db,
  );

  const recorded = await appendProctoringSnapshot(
    application_id,
    { at, condition, key },
    db,
  );

  // The session closed between the check above and the write. Don't leave the
  // object behind pointing at nothing — an unreferenced image of a candidate is
  // exactly what this feature is careful not to accumulate.
  if (!recorded) {
    try {
      await deleteProctoringSnapshots([key], db);
    } catch (err) {
      console.error(
        `Failed to clean up orphaned snapshot ${key}:`,
        err instanceof Error ? err.message : err,
      );
    }
    return NextResponse.json({ error: "Session is not open" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, key });
}
