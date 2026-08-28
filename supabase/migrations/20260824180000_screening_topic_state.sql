-- Runtime topic coverage for the voice screening call.
--
-- Until now, "cover every topic" was a sentence in the interviewer's prompt and
-- nothing else: the model was handed a confidential numbered guide and told to
-- raise all of it, and nothing observed whether it did. That matters more than a
-- missed question usually would, because the screening overall is the weighted
-- mean over EVERY rubric dimension and a dimension with no evidence scores 0. A
-- topic the interviewer skipped cost the candidate exactly what refusing to
-- answer it would have — for a decision nobody made and nobody could see.
--
-- This column holds the application-owned ledger of what was actually asked:
-- one entry per screening question with its status (pending / in_progress /
-- complete / insufficient), when it was raised, how many follow-ups it drew, and
-- a one-line note on what the candidate evidenced. It is written by the guarded
-- agent control route while the call is live, and is read afterwards purely as
-- an audit record.
--
-- Nullable with no default, on purpose, in the manner of `dimension_scores`:
-- NULL means the call predates runtime topic coverage (or never started), and
-- history is not back-filled — a coverage record should show what was actually
-- observed, not what today's code would have observed.
--
-- It does NOT participate in scoring. `src/lib/screening-scoring/` still reads
-- the WHOLE transcript per rubric dimension and never sees this column;
-- narrowing evidence to "the answer given to that topic" would recreate the
-- per-question bug retired on 2026-08-22, where a candidate who evidenced a
-- competency while answering some other question got no credit for it.

ALTER TABLE screening_question_responses
  ADD COLUMN IF NOT EXISTS topic_state jsonb;

COMMENT ON COLUMN screening_question_responses.topic_state IS
  'Runtime topic-coverage ledger for the voice call: per-topic status, askedAt, follow-ups used and a short evidence note, plus phase/deadline and an optimistic-concurrency version. Audit only — never an input to scoring. NULL for calls that predate runtime topic coverage.';
