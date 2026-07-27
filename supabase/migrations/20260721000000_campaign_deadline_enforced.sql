-- ============================================================================
-- Campaign deadline enforcement toggle
-- ============================================================================
-- A campaign's `deadline` has been informational only. This adds a per-campaign
-- switch the recruiter sets at create/edit time: when `deadline_enforced` is
-- true, the public apply page stops accepting new applications once the deadline
-- day has passed; when false (the default), the deadline is displayed but never
-- gates applications.
--
-- Defaults to false so every existing campaign keeps today's behaviour (deadline
-- ignored). NOT NULL because the app always reads a concrete boolean.

ALTER TABLE campaigns
  ADD COLUMN deadline_enforced boolean NOT NULL DEFAULT false;
