-- Migration: Create duplicate_review_queue table for HR deduplication review.
--
-- When a candidate intake matches an existing candidate by email or phone,
-- instead of auto-merging we insert a row here and let HR decide.
--
-- This requires dropping the UNIQUE constraint on candidates.email so two
-- records with the same email can coexist while a flag is open. HR resolves
-- the flag by approving (mergeCandidatesTx re-points applications and soft
-- deletes the source) or rejecting (keep both records separate).

ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_email_key;

CREATE TABLE IF NOT EXISTS duplicate_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  matched_candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  match_signals JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected')),
  reviewer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Index for fast lookups of open flags per candidate
CREATE INDEX IF NOT EXISTS idx_duplicate_review_queue_candidate_id ON duplicate_review_queue(candidate_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_review_queue_matched_candidate_id ON duplicate_review_queue(matched_candidate_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_review_queue_status ON duplicate_review_queue(status);

-- Enable RLS
ALTER TABLE duplicate_review_queue ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can view all duplicate flags (HR review queue).
-- In a multi-tenant setup this may later be scoped to campaign owners.
CREATE POLICY "Allow authenticated read on duplicate_review_queue"
  ON duplicate_review_queue
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: authenticated users can insert flags (system / intake actions).
CREATE POLICY "Allow authenticated insert on duplicate_review_queue"
  ON duplicate_review_queue
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: authenticated users can update flags (approve / reject).
CREATE POLICY "Allow authenticated update on duplicate_review_queue"
  ON duplicate_review_queue
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_duplicate_review_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_duplicate_review_queue_updated_at ON duplicate_review_queue;
CREATE TRIGGER trg_duplicate_review_queue_updated_at
  BEFORE UPDATE ON duplicate_review_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_duplicate_review_queue_updated_at();
