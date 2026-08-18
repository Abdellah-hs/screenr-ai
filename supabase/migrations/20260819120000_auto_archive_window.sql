-- Auto-archive window for non-responsive candidates (PRD 3.12.4, issue #144).
--
-- Nullable and NULL by default, which means "never auto-archive". Existing
-- campaigns therefore keep exactly today's behaviour until a recruiter opts in
-- — a sweep that silently started archiving people the moment it deployed would
-- be the wrong kind of surprise for a pipeline state that removes candidates
-- from view.
--
-- One window covers every non-responsive failure state (screening_expired,
-- interview_expired, interview_no_show, processing_failed) rather than one
-- column per state: they are the same fact from the recruiter's side — the
-- candidate stopped responding — and per-state windows triple the config
-- surface for a distinction nobody has yet asked to make.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS auto_archive_after_days integer;

COMMENT ON COLUMN public.campaigns.auto_archive_after_days IS
  'Days a non-responsive application sits in a failure state before the auto-archive sweep moves it to `archived`. NULL disables auto-archiving for this campaign.';

-- A zero or negative window would archive on the same pass that expires the
-- candidate, collapsing two distinct pipeline states into one.
ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_auto_archive_after_days_positive;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_auto_archive_after_days_positive
  CHECK (auto_archive_after_days IS NULL OR auto_archive_after_days > 0);
