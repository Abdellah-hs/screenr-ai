-- ============================================================================
-- Screening scores move from per-question to per-rubric-dimension
-- ============================================================================
-- The recruiter has always been able to edit a "Screening questions" rubric,
-- and nothing ever read it. The voice score was the unweighted mean of a score
-- per question, so the rubric's dimensions — the competencies the recruiter
-- actually decided the role needs, with their importance — changed nothing.
--
-- Evidence is now extracted per rubric dimension and the overall is the
-- weighted mean over the rubric. Two consequences the column below serves:
--
--   1. A score is no longer a set of per-question numbers, so it needs
--      somewhere to live that is not the `answers` array. `answers` keeps
--      holding the candidate's answers; scores about competencies do not
--      belong inside a list of questions.
--   2. Old scored responses stay per-question and must keep rendering as they
--      were scored. Adding a column rather than reshaping `answers` is what
--      makes that possible: history is not retconned into a rubric it was never
--      graded against.
--
-- Nullable with no default on purpose. NULL means "scored per question" (every
-- response taken before this migration, plus the legacy typed-answer path);
-- a populated array means "scored per rubric dimension". An empty-array default
-- would erase that distinction on every historical row.

ALTER TABLE public.screening_question_responses
  ADD COLUMN IF NOT EXISTS dimension_scores jsonb;

COMMENT ON COLUMN public.screening_question_responses.dimension_scores IS
  'Per-rubric-dimension screening scores: [{dimension_id, name, weight, evidence_level, reported_evidence_level, score, evidence_items, notes}]. NULL means this response was scored per question (pre-2026-08-22, or the legacy text path) — read `answers[].score` for those. The overall is the weight-weighted mean of `score` across this array.';
