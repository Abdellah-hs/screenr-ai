-- ============================================================================
-- Unify resume scoring on the `resume` evaluation rubric (issue #65)
--
-- The resume stage had two parallel "how to score a CV" configs:
--   - screening_criteria  (flat: label, weight, is_mandatory)        ← scored
--   - the `resume` evaluation_rubric (versioned, with min_score)     ← decorative
--
-- This migration makes the resume rubric the single source of truth:
--   1. Backfill — for every campaign that has screening_criteria but no active
--      `resume` rubric, create one (v1, active) from its criteria. A mandatory
--      criterion's per-dimension fail line (min_score) is seeded to 30 to
--      preserve the prior hard-coded knockout line (issue #64); non-mandatory
--      criteria get 0. max_score is 100 to match the rubric editor.
--   2. Retire the screening_criteria table and the legacy campaigns jsonb column.
-- ============================================================================

-- 1. Backfill resume rubrics from existing screening_criteria ----------------
DO $$
DECLARE
  c RECORD;
  new_rubric_id uuid;
BEGIN
  FOR c IN
    SELECT DISTINCT sc.campaign_id
    FROM screening_criteria sc
    WHERE sc.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM evaluation_rubrics er
        WHERE er.campaign_id = sc.campaign_id
          AND er.stage = 'resume'
          AND er.is_active = true
      )
  LOOP
    INSERT INTO evaluation_rubrics (campaign_id, stage, version, is_active)
    VALUES (c.campaign_id, 'resume', 1, true)
    RETURNING id INTO new_rubric_id;

    INSERT INTO rubric_dimensions
      (rubric_id, name, weight, is_mandatory, min_score, max_score, sort_order)
    SELECT
      new_rubric_id,
      sc.label,
      sc.weight,
      sc.is_mandatory,
      CASE WHEN sc.is_mandatory THEN 30 ELSE 0 END,
      100,
      sc.sort_order
    FROM screening_criteria sc
    WHERE sc.campaign_id = c.campaign_id
      AND sc.deleted_at IS NULL
    ORDER BY sc.sort_order;
  END LOOP;
END $$;

-- 2. Retire the legacy config ------------------------------------------------
DROP TABLE IF EXISTS screening_criteria;
ALTER TABLE campaigns DROP COLUMN IF EXISTS screening_criteria;
