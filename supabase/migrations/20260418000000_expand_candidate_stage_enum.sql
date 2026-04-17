-- Migration: Expand candidate_stage_enum to the canonical ATS state set.
--
-- See CLAUDE.md → ATS State Machine Rules for the canonical list. This
-- migration is additive: legacy values ('screening', 'screening_q') remain
-- valid so existing rows keep working. A future cleanup migration can
-- rename or retire legacy values once all callers are on canonical names.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot reference the newly-added value
-- inside the same transaction. Each statement below is intentionally run
-- on its own — do NOT wrap this file in BEGIN/COMMIT.

ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'screening_review_pending';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'screening_approved';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'screening_sent';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'screening_completed';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'screening_scored';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'interview_scheduling';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'interview_scheduled';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'interview_completed';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'interview_scored';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'reference_check';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'final_interview_scheduling';
ALTER TYPE candidate_stage_enum ADD VALUE IF NOT EXISTS 'archived';
