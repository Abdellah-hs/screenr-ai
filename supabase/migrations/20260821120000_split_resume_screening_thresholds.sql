-- Split the one threshold into two: resume and screening.
--
-- `screening_threshold` was read by BOTH scoring rules — the resume rule
-- (evaluateResumeScoringOutcome) and the voice-screening rule
-- (evaluateScreeningScoringOutcome) — while the UI showed a single box. One
-- number therefore set the auto-reject line on two stages whose scores are not
-- the same kind of number: a resume score ranks a pile of CVs against a rubric,
-- a screening score grades spoken answers. They have different distributions,
-- so a recruiter raising the bar to stop weak CVs was silently also raising the
-- bar on candidates who had already answered well.
--
-- After this migration each rule reads its own column and `screening_threshold`
-- finally means only what its name says.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS resume_threshold integer NOT NULL DEFAULT 70;

-- Every existing campaign keeps exactly today's behaviour: both stages continue
-- to gate on the number the recruiter already set. Splitting the column must not
-- move anybody's reject line on deploy — the recruiter opts into a different
-- resume bar by editing it, not by us guessing one.
UPDATE public.campaigns
  SET resume_threshold = screening_threshold;

COMMENT ON COLUMN public.campaigns.resume_threshold IS
  'Resume score (0-100) an application must reach to pass the CV stage. In fully_auto, below this is auto-rejected with disposition LOW_SCORE; in human_in_loop it only sorts the review queue.';

COMMENT ON COLUMN public.campaigns.screening_threshold IS
  'Voice-screening score (0-100) an application must reach to be invited to the AI interview. In fully_auto, below this is auto-rejected with disposition LOW_SCORE; in human_in_loop it only sorts the review queue. Applies to the screening stage ONLY — the resume stage reads resume_threshold.';

-- The DB default was 50 while the campaign wizard has always sent 70, so a
-- campaign created through the form and one created any other way rejected at
-- different bars. 70 wins because it is what every campaign built through the UI
-- already carries, and it is the fallback parseCampaignFormData applies.
ALTER TABLE public.campaigns
  ALTER COLUMN screening_threshold SET DEFAULT 70;

-- Both columns are percentages. Nothing enforced the range in the database —
-- only the Zod schema did, which leaves any writer that isn't the form free to
-- store a threshold no score can ever reach.
ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_resume_threshold_range;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_resume_threshold_range
  CHECK (resume_threshold BETWEEN 0 AND 100);

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_screening_threshold_range;

-- NOT VALID: existing rows are not re-checked, so the migration cannot fail on
-- historical data that predates any range enforcement. New and updated rows are
-- checked from here on.
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_screening_threshold_range
  CHECK (screening_threshold BETWEEN 0 AND 100) NOT VALID;
