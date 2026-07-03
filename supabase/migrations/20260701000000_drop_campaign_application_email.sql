-- ============================================================================
-- Drop campaign application_email — Gmail inbound CV sync retired
-- ============================================================================
-- Candidates now submit CVs exclusively through the public apply page
-- (`/apply/<slug>`), so the per-campaign inbox alias that the Gmail resume
-- sweep filtered on is obsolete. Removing the column and its unique index.
--
-- Outbound candidate email (screening/interview links) is unaffected — it uses
-- the recruiter's Gmail connection (`gmail_connections`), not this column.

DROP INDEX IF EXISTS idx_campaigns_application_email_per_user;

ALTER TABLE campaigns DROP COLUMN IF EXISTS application_email;
