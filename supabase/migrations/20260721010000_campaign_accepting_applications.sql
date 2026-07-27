-- ============================================================================
-- Campaign application-intake switch
-- ============================================================================
-- Splits the recruiter-facing "Active" state into two: an active campaign whose
-- public apply page is OPEN vs one that keeps processing existing candidates but
-- is CLOSED to new applications. `status` stays a clean 4-value lifecycle
-- (draft/active/paused/closed); this orthogonal boolean carries the intake
-- intent, so the form's status dropdown can offer:
--   Active — accepting applications      (status=active, accepting=true)
--   Active — not accepting new apps       (status=active, accepting=false)
--
-- Only meaningful while active — the status gate already refuses draft/paused/
-- closed. Defaults to true so every existing campaign keeps accepting.

ALTER TABLE campaigns
  ADD COLUMN accepting_applications boolean NOT NULL DEFAULT true;
