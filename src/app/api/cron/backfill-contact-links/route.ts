import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireBearerSecret } from "@/lib/auth/guards";
import {
  backfillContactLinks,
  BACKFILL_DEFAULT_LIMIT,
} from "@/lib/resume-ingest/contact-link-backfill";

// Service-role writes and a paid third-party call: never static, never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Marker is submit-then-poll (~50s worst case per document), so a run of any
// size needs more than the default serverless budget.
export const maxDuration = 300;

/**
 * One-shot repair of profile links on CVs ingested before the deterministic
 * harvest — see `backfillContactLinks` for what it will and will not touch.
 *
 * Guarded like every other session-less endpoint (`Authorization: Bearer
 * ${CRON_SECRET}`, failing closed if the secret is unset), but deliberately
 * **not** listed in `vercel.json`: this is not a schedule. It re-reads each
 * document through Marker, which costs money per CV, so it is invoked by hand
 * and defaults to a small batch.
 *
 *   # free — counts the work without calling Marker or writing anything
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "$ORIGIN/api/cron/backfill-contact-links?dryRun=1"
 *
 *   # paid — one Marker call per CV, capped by `limit`
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "$ORIGIN/api/cron/backfill-contact-links?limit=25"
 *
 * Re-running is safe: a link that has already been recovered is no longer a
 * gap, so the second run skips it before it can cost anything.
 */
export async function GET(request: Request) {
  const denied = requireBearerSecret(request, "CRON_SECRET", "the backfill");
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dryRun") === "1" || params.get("dryRun") === "true";

  // A garbled `limit` falls back to the default rather than to Infinity: the
  // cap is the thing standing between a typo and a bill.
  const requested = Number.parseInt(params.get("limit") ?? "", 10);
  const limit =
    Number.isInteger(requested) && requested > 0 && requested <= 200
      ? requested
      : BACKFILL_DEFAULT_LIMIT;

  const result = await backfillContactLinks({
    db: createAdminClient(),
    limit,
    dryRun,
  });

  return NextResponse.json({ ok: true, limit, ...result });
}
