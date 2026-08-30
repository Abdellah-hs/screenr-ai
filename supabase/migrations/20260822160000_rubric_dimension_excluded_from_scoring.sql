-- ============================================================================
-- A rubric dimension the recruiter has taken out of scoring
-- ============================================================================
-- Screening scores are the weighted mean over EVERY rubric dimension, covered
-- by a question or not. That is right for a dimension a candidate was asked
-- about and said nothing useful on — 0 is the honest score. It is wrong for a
-- dimension no question probes: the candidate is docked for something nobody
-- asked them.
--
-- Concretely, with Kafka/SQL at High and Collaboration/Model Validation at
-- Medium, and questions covering only the first two, a candidate who answers
-- both strongly scores:
--
--     80×0.3 + 80×0.3 + 0×0.2 + 0×0.2  =  48
--
-- and is auto-rejected at a threshold of 70, having answered everything they
-- were actually asked.
--
-- This column is the recruiter's answer to that: a dimension marked excluded
-- stays in the rubric (it still describes what the role needs) but takes no
-- part in the score, so it never enters the denominator.
--
-- Deliberately a RECRUITER decision rather than an automatic one. Coverage is
-- judged by a model, and a model that wrongly calls a dimension uncovered would
-- otherwise silently shrink the rubric a candidate is judged on. The AI check
-- advises; this column records what a person decided.
--
-- DEFAULT false, so every existing rubric keeps scoring exactly as it does
-- today. Nothing about a stored score changes meaning until a recruiter acts.
--
-- Only the SCREENING stage reads this. The resume stage's must-have gate and
-- the interview rubric are untouched — excluding a resume criterion would move
-- an eligibility line, which is a different decision than "nobody asked about
-- this", and is not what this column means.

ALTER TABLE public.rubric_dimensions
  ADD COLUMN IF NOT EXISTS excluded_from_scoring boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.rubric_dimensions.excluded_from_scoring IS
  'Recruiter has taken this dimension out of the screening score — normally because no question probes it, so scoring it would penalise every candidate for something they were never asked. Excluded dimensions leave the weighted mean entirely (they are not scored 0; they are not counted). Read by the screening stage ONLY: the resume must-have gate and the interview rubric ignore it.';
