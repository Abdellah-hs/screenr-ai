-- ============================================================================
-- Campaign application email — per-campaign inbound routing
-- ============================================================================
-- Each campaign can declare the address applicants send their CV to (typically
-- a plus-alias of the recruiter's one connected inbox, e.g.
-- careers+eng@company.com). Gmail delivers every alias into the single
-- connected mailbox; the resume sync (syncResumesFromGmail) filters on this
-- address (Gmail `to:` query) so a campaign only ingests its own applicants
-- instead of the whole inbox.
--
-- Nullable: a campaign with no address set cannot sync (the action returns a
-- "set an application email" message rather than dumping the entire inbox).

ALTER TABLE campaigns ADD COLUMN application_email text;

-- One address routes to exactly one campaign per recruiter. Scoped to user_id
-- because the connected inbox is per-recruiter; case-insensitive because email
-- addresses are. Partial (NULLs excluded) so unset campaigns don't collide.
CREATE UNIQUE INDEX idx_campaigns_application_email_per_user
  ON campaigns (user_id, lower(application_email))
  WHERE application_email IS NOT NULL;
