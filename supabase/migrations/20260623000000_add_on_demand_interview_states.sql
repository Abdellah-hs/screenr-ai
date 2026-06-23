-- Migration: add on-demand AI interview states (interview_invited, interview_expired).
--
-- Decision 2026-06-23 (PRD 3.5.6): the AI interview is on-demand, not slot-
-- scheduled. `interview_invited` is the "candidate has the on-demand link,
-- awaiting them" state that replaces the scheduling/scheduled pair;
-- `interview_expired` is the deadline-missed failure state (mirrors
-- screening_expired).
--
-- Additive only — `interview_scheduling` / `interview_scheduled` remain valid
-- until a later cleanup migration retires them (after the invite flow ships and
-- any existing rows are migrated to interview_invited).
--
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot reference the newly-added value inside
-- the same transaction. Each statement runs on its own — do NOT wrap in
-- BEGIN/COMMIT.

ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'interview_invited' AFTER 'screening_scored';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'interview_expired' AFTER 'interview_no_show';
