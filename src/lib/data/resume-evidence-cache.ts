import { createClient } from "@/lib/supabase/server";
import type { SupabaseDb } from "@/lib/supabase/types";
import type { Json } from "@/types/database.types";
import {
  ResumeEvidenceResponseSchema,
  type ResumeEvidenceResponse,
} from "@/lib/resume-scoring";

/**
 * Cached evidence extraction — the expensive, non-deterministic half of resume
 * screening.
 *
 * Only the model's *evidence* is cached, never the deterministic result. The
 * scoring is exact and costs nothing, so recomputing it on every read means a
 * cache hit and a cache miss run identical code paths, and a stored result can
 * never drift out of step with the rules that produced it.
 */
export interface CachedResumeEvidence {
  evidence: ResumeEvidenceResponse;
  rawOutput: string;
  model: string;
  promptVersion: string;
  systemFingerprint: string | null;
}

export async function fetchCachedResumeEvidence(
  cacheKey: string,
  db?: SupabaseDb,
): Promise<CachedResumeEvidence | null> {
  const supabase = db ?? (await createClient());

  const { data } = await supabase
    .from("resume_evidence_cache")
    .select("extracted_evidence, raw_model_output, model, prompt_version, system_fingerprint")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (!data) return null;

  // A cached row is still parsed before use. It was written by an older build
  // of this code, which makes it foreign input — trusting it because we wrote
  // it once is how a schema change turns into a runtime crash on read.
  const parsed = ResumeEvidenceResponseSchema.safeParse(data.extracted_evidence);
  if (!parsed.success) return null;

  return {
    evidence: parsed.data,
    rawOutput: data.raw_model_output,
    model: data.model,
    promptVersion: data.prompt_version,
    systemFingerprint: data.system_fingerprint,
  };
}

/**
 * Store one extraction against its key. Best-effort by design: a cache write
 * that fails must never fail the scoring run that produced the evidence, so
 * errors are logged and swallowed. `upsert` (rather than insert) makes a race
 * between two concurrent scorers of the same resume a no-op instead of a
 * duplicate-key error — both computed the same thing.
 */
export async function saveCachedResumeEvidence(
  args: {
    cacheKey: string;
    campaignId: string;
    resumeTextHash: string;
    model: string;
    promptVersion: string;
    rulesVersion: string;
    rubricVersion: number | null;
    systemFingerprint: string | null;
    rawOutput: string;
    evidence: ResumeEvidenceResponse;
  },
  db?: SupabaseDb,
): Promise<void> {
  const supabase = db ?? (await createClient());

  const { error } = await supabase.from("resume_evidence_cache").upsert(
    {
      cache_key: args.cacheKey,
      campaign_id: args.campaignId,
      resume_text_hash: args.resumeTextHash,
      model: args.model,
      prompt_version: args.promptVersion,
      rules_version: args.rulesVersion,
      rubric_version: args.rubricVersion,
      system_fingerprint: args.systemFingerprint,
      raw_model_output: args.rawOutput,
      extracted_evidence: args.evidence as unknown as Json,
    },
    { onConflict: "cache_key" },
  );

  if (error) {
    console.warn("saveCachedResumeEvidence: cache write failed (non-blocking):", error.message);
  }
}
