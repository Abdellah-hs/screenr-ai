-- ============================================================================
-- Candidates: add `github_url`
-- ============================================================================
-- A candidate is a person, stable across campaigns, and per CLAUDE.md they
-- hold identity data only — name, email, phone, and links. Two of the three
-- links had a column here (`linkedin_url`, `portfolio_url`) and the third did
-- not, so a GitHub profile lived only in one application's `parsed_data`.
--
-- That asymmetry is not cosmetic. It means the same person's GitHub link is a
-- fact about the campaign they happened to apply to rather than about them:
-- apply to a second campaign and it is re-derived from scratch, and a page
-- that reads identity from the candidate row cannot see it at all. Every other
-- contact field on the candidate file renders as `parsed_data ?? candidate
-- row`; GitHub was the one with no row to fall back to.
--
-- Nullable with no default and no backfill. The links already sitting in
-- `applications.parsed_data` are the reading that produced them, and the
-- candidate detail page still prefers `parsed_data` over this column — so an
-- existing candidate loses nothing by this being null, and a backfill would
-- copy one application's reading onto a person who may have several.

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS github_url TEXT;

COMMENT ON COLUMN public.candidates.github_url IS
  'GitHub profile URL. Peer of linkedin_url / portfolio_url — identity data on the person, not on any one application.';
