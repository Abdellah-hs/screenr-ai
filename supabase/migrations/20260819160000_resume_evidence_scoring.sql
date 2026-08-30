-- ============================================================================
-- Evidence-based resume screening — must-have gates, nice-to-have ranking
-- ============================================================================
-- Resume screening used to ask the model for a 0-100 number per criterion and
-- combine them with recruiter weights. Two problems, and the second is the
-- serious one:
--
--   1. The numbers were not reproducible. "Is this a 68 or a 74?" has no stable
--      answer, so the same CV could score differently on consecutive runs.
--   2. A weighted total lets a surplus on one criterion pay for a shortfall on
--      another. Applied to a non-negotiable requirement, that turns "must" into
--      "mostly" — silently, and in the candidate's favour or against them
--      depending on which way the weights happened to fall.
--
-- The replacement: the model reports an evidence LEVEL plus verbatim quotes,
-- and every number is derived from that level by a fixed table in
-- src/lib/resume-scoring/. Must-haves are checked one at a time and all must
-- pass; only then is a ranking score computed, from nice-to-haves alone.

-- ─── Tier ───────────────────────────────────────────────────────────────────
-- "strong"/"moderate"/"weak"/"no_match" describe a point on a scale, which is
-- exactly the framing that lets a failed must-have read as "well, they were
-- moderate". Eligibility is not a point on a scale. The old values stay in the
-- enum because historical rows still carry them and rewriting scored history
-- would be worse than living with two vocabularies.
--
-- Safe inside a transaction on PG12+: the new labels are added here and first
-- USED by application code in a later transaction.
ALTER TYPE screening_tier_enum ADD VALUE IF NOT EXISTS 'eligible';
ALTER TYPE screening_tier_enum ADD VALUE IF NOT EXISTS 'ineligible';

-- ─── Application columns ────────────────────────────────────────────────────
ALTER TABLE public.applications
  -- Queryable eligibility, separate from `resume_score` because the two answer
  -- different questions and only one of them is always answerable.
  ADD COLUMN IF NOT EXISTS resume_eligible boolean,
  -- The full auditable result: per-criterion evidence level, score, verified
  -- quotes, every failed must-have, and the validation warnings raised while
  -- checking the model's output.
  ADD COLUMN IF NOT EXISTS resume_evaluation jsonb;

COMMENT ON COLUMN public.applications.resume_eligible IS
  'True when every must-have criterion passed. Null for resumes scored before evidence-based screening.';

COMMENT ON COLUMN public.applications.resume_evaluation IS
  'Full DeterministicResumeScoreResult: scored criteria with verified quotes, failed must-haves, validation warnings.';

-- `resume_score` now holds the NICE-TO-HAVE RANKING SCORE, and is null for an
-- ineligible candidate — ranking the ineligible would invite someone to read
-- down the list and argue with a gate. `scored_at` (not `resume_score`) is
-- therefore the marker for "this application has been evaluated".
COMMENT ON COLUMN public.applications.resume_score IS
  'Nice-to-have ranking score (0-100) for an eligible candidate; NULL when ineligible. Use scored_at to test whether scoring has run.';

CREATE INDEX IF NOT EXISTS idx_applications_resume_eligible
  ON public.applications(campaign_id, resume_eligible);

-- ─── Extraction cache ───────────────────────────────────────────────────────
-- Keyed by everything that can change the answer: the resume document, the
-- criteria and their priorities in order, the rubric version, the prompt
-- version, the model, and the deterministic rules version. Any of those moving
-- produces a different key, so a stale result can never be served — invalidation
-- is structural rather than something a caller has to remember to do.
CREATE TABLE IF NOT EXISTS public.resume_evidence_cache (
  cache_key           text PRIMARY KEY,
  campaign_id         uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  resume_text_hash    text NOT NULL,
  model               text NOT NULL,
  prompt_version      text NOT NULL,
  rules_version       text NOT NULL,
  rubric_version      integer,
  system_fingerprint  text,
  raw_model_output    text NOT NULL,
  extracted_evidence  jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resume_evidence_cache_campaign
  ON public.resume_evidence_cache(campaign_id, created_at DESC);

COMMENT ON TABLE public.resume_evidence_cache IS
  'Cached LLM evidence extractions keyed by resume + criteria + versions. Deterministic scoring is recomputed from the cached evidence, never cached itself.';

ALTER TABLE public.resume_evidence_cache ENABLE ROW LEVEL SECURITY;

-- Scoped through the owning campaign, like every other candidate-derived row.
-- The session-less ingest pipeline writes with the service-role client and
-- bypasses RLS; these policies are what keep the recruiter-session paths
-- (re-score, campaign re-scoring sweep) from reading another tenant's cache.
CREATE POLICY "Users can view cached evidence for their campaigns"
  ON public.resume_evidence_cache FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = resume_evidence_cache.campaign_id
        AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can cache evidence for their campaigns"
  ON public.resume_evidence_cache FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = resume_evidence_cache.campaign_id
        AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete cached evidence for their campaigns"
  ON public.resume_evidence_cache FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = resume_evidence_cache.campaign_id
        AND c.user_id = auth.uid()
    )
  );

-- ─── Resume rubric fail line ────────────────────────────────────────────────
-- Resume must-haves are gated at MUST_HAVE_MINIMUM_SCORE (60), not the generic
-- MANDATORY_FAIL_LINE (30) the other two stages use. Bring stored rows in line
-- so the row states the gate that is actually applied. Nice-to-haves have no
-- fail line at all — they cannot knock anyone out.
UPDATE public.rubric_dimensions d
SET min_score = CASE WHEN d.is_mandatory THEN 60 ELSE 0 END
FROM public.evaluation_rubrics r
WHERE d.rubric_id = r.id
  AND r.stage = 'resume';
