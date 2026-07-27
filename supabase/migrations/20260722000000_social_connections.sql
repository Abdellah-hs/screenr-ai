-- ============================================================================
-- Social Connections — per-recruiter OAuth connection for social publishing
-- ============================================================================
-- Mirrors gmail_connections. Stores the access token for a social channel the
-- recruiter connects in Settings (LinkedIn today) so the app can publish
-- "we're hiring" posts to their feed. One row per (user_id, provider) so a
-- reconnect overwrites in place, and a recruiter can connect several providers.
--
-- SECURITY: access_token is a secret. Owner-only RLS, read server-side only,
-- never returned to the browser. Encryption at rest (pgcrypto / Supabase Vault)
-- is a follow-up, same as gmail_connections.

CREATE TABLE social_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider         text NOT NULL,
  access_token     text NOT NULL,
  token_expires_at timestamptz,
  account_id       text,
  account_name     text,
  scope            text,
  connected_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX idx_social_connections_user_id ON social_connections(user_id);

ALTER TABLE social_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own social connections"
  ON social_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own social connections"
  ON social_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own social connections"
  ON social_connections FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own social connections"
  ON social_connections FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER set_social_connections_updated_at
  BEFORE UPDATE ON social_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
