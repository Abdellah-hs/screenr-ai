-- ============================================================================
-- Talent pool entries — the curated "silver medalist" layer (PRD 3.11, #141)
-- ============================================================================
-- `/candidates` already lists every person who ever applied. That is a
-- directory, and it is genuinely useful, but it is not what the PRD calls a
-- talent pool: an OPT-IN set of people a recruiter deliberately marked as worth
-- revisiting, carrying tags and a note. A directory answers "who applied"; this
-- table answers "who would I call first when the next role opens".
--
-- One row per (recruiter, candidate). A person pooled twice from two different
-- campaigns is still one person worth revisiting, and duplicate rows would make
-- the pool count lie about how many people are in it. `source_*` records where
-- the decision was made, which is history, not identity.

CREATE TABLE IF NOT EXISTS public.talent_pool_entries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  -- Where the recruiter was standing when they pooled this person. Nullable and
  -- SET NULL on delete on purpose: the pool has to outlive the campaign that
  -- filled it, otherwise closing a role would quietly empty the pool it fed.
  source_application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  source_campaign_id    uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  tags                  text[] NOT NULL DEFAULT '{}',
  notes                 text,
  added_by              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at              timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (added_by, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_talent_pool_entries_added_by
  ON public.talent_pool_entries(added_by, added_at DESC);

CREATE INDEX IF NOT EXISTS idx_talent_pool_entries_candidate
  ON public.talent_pool_entries(candidate_id);

-- Tag filtering is a containment query (`tags @> '{react}'`); GIN is the index
-- that makes that not a sequential scan once a pool has real size.
CREATE INDEX IF NOT EXISTS idx_talent_pool_entries_tags
  ON public.talent_pool_entries USING GIN (tags);

COMMENT ON TABLE public.talent_pool_entries IS
  'Opt-in silver-medalist pool (PRD 3.11). One row per (recruiter, candidate); the directory at /candidates is a separate, automatic view of everyone who applied.';

ALTER TABLE public.talent_pool_entries ENABLE ROW LEVEL SECURITY;

-- The pool is the recruiter's own curation, so `added_by` is the scope. Reads
-- and writes both check it; there is no shared-pool concept yet, and inventing
-- one here would pre-empt the team-access decision still open on #132.
CREATE POLICY "Users can view their own talent pool entries"
  ON public.talent_pool_entries FOR SELECT
  USING (auth.uid() = added_by);

-- INSERT additionally requires that the recruiter can actually see the
-- candidate. Without the EXISTS, `added_by = auth.uid()` alone would let a
-- crafted request pool ANY candidate_id in the database — the row would be
-- theirs, but the person in it would not be, and the join would then leak a
-- name and email they were never entitled to.
CREATE POLICY "Users can add candidates they can see to their talent pool"
  ON public.talent_pool_entries FOR INSERT
  WITH CHECK (
    auth.uid() = added_by
    AND EXISTS (
      SELECT 1 FROM public.applications a
      JOIN public.campaigns c ON c.id = a.campaign_id
      WHERE a.candidate_id = talent_pool_entries.candidate_id
        AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own talent pool entries"
  ON public.talent_pool_entries FOR UPDATE
  USING (auth.uid() = added_by)
  WITH CHECK (auth.uid() = added_by);

CREATE POLICY "Users can remove their own talent pool entries"
  ON public.talent_pool_entries FOR DELETE
  USING (auth.uid() = added_by);

CREATE TRIGGER set_talent_pool_entries_updated_at
  BEFORE UPDATE ON public.talent_pool_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
