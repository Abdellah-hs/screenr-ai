-- Migration: Failure states for the application state machine.
-- Explicit terminal states for the three silent-failure paths CLAUDE.md
-- flagged: screening link expired without response, candidate no-show for
-- interview, and irrecoverable processing errors (resume parse/score).
--
-- Additive only — existing rows are unaffected. ALTER TYPE ADD VALUE cannot
-- be wrapped in a transaction with references to the new value, so each
-- statement stands alone (matches the 20260418 pattern).

ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'screening_expired';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'interview_no_show';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'processing_failed';
