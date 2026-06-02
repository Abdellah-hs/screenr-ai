-- ============================================================================
-- Two-decision rubric model (issue #77)
--
-- Recruiters express a dimension's weighting as High / Medium / Low importance;
-- the system derives the numeric `weight` from it. Persist that intent as a
-- first-class enum so the editor can re-render the recruiter's choice without
-- reverse-mapping a normalized weight.
--
-- Existing dimensions default to 'medium'; their stored weight is left intact
-- and will be recomputed from importance on the next save.
-- ============================================================================

CREATE TYPE dimension_importance_enum AS ENUM ('high', 'medium', 'low');

ALTER TABLE rubric_dimensions
  ADD COLUMN importance dimension_importance_enum NOT NULL DEFAULT 'medium';
