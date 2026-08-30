-- ============================================================================
-- Screening questions: drop `is_required`
-- ============================================================================
-- The flag never gated anything. No rule read it, no submission was blocked by
-- it, and no transition depended on it — it labelled a question "Required" in
-- the UI and hinted the prompts. After the 2026-08-21 decision that screening
-- has no must-have gate, it labels a rule that does not exist, which is worse
-- than not labelling anything: a recruiter ticking "Required" reasonably
-- expects a weak answer there to cost the candidate more than a weak answer
-- elsewhere, and it does not.
--
-- It also worked against the new scoring. The voice agent's instructions said
-- optional topics were "if time allows", so the agent could legitimately skip
-- one — but the overall score is the mean over EVERY question, so a skipped
-- question scores 0 and drags the candidate down. The flag was quietly telling
-- the interviewer it was fine to cost someone points.
--
-- Dropped rather than left in place. A column nothing reads is a column the
-- next person has to prove is dead before they can touch anything near it, and
-- the data it holds is a recruiter's answer to a question we no longer ask.

ALTER TABLE public.screening_questions
  DROP COLUMN IF EXISTS is_required;
