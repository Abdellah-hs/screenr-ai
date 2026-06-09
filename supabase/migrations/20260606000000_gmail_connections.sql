-- ============================================================================
-- Gmail Connections — per-recruiter OAuth inbox connection
-- ============================================================================
-- Stores the Google OAuth refresh token for the inbox a recruiter connects in
-- Settings. Resume sync (syncResumesFromGmail) reads the token server-side to
-- pull CVs from that account. One connection per recruiter (UNIQUE user_id).
--
-- SECURITY: refresh_token is a secret. It is protected by owner-only RLS and is
-- only ever read server-side — never returned to the browser. Encryption at
-- rest (pgcrypto / Supabase Vault) is a follow-up; see CLAUDE.md.

CREATE TABLE gmail_connections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text NOT NULL,
  refresh_token text NOT NULL,
  scope         text,
  connected_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_gmail_connections_user_id ON gmail_connections(user_id);

ALTER TABLE gmail_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own gmail connection"
  ON gmail_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own gmail connection"
  ON gmail_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own gmail connection"
  ON gmail_connections FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own gmail connection"
  ON gmail_connections FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER set_gmail_connections_updated_at
  BEFORE UPDATE ON gmail_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
