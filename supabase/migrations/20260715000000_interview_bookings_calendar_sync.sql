-- Migration: live sync of recruiter calendar edits back into bookings.
--
-- When a recruiter moves an already-booked final interview in their own Google
-- Calendar, Google's push notifications tell us, and we send the candidate back
-- to re-pick a time. Two pieces:
--   1. interview_bookings gains google_event_id (which Google event a booking
--      maps to) and updated_at (audit + the mutex/status-change surface). The
--      status column already exists (plain text, no CHECK); this adds the new
--      literal value 'pending_reschedule' by convention, not by constraint.
--   2. calendar_watch_channels — one Google events.watch channel per recruiter,
--      plus the incremental sync token and a best-effort reconciliation mutex
--      (reconciling_since). All writes are system-driven (booking flow, webhook,
--      renewal cron) via the service_role key, so RLS is SELECT-only for owners,
--      mirroring interview_bookings rather than the full-CRUD gmail_connections.

BEGIN;

-- 1. Booking columns for calendar linkage + change tracking.
ALTER TABLE public.interview_bookings
    ADD COLUMN IF NOT EXISTS google_event_id text,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Reconciliation looks a booking up by its Google event id on every webhook.
CREATE INDEX IF NOT EXISTS idx_interview_bookings_google_event_id
    ON public.interview_bookings(google_event_id);

CREATE TRIGGER set_interview_bookings_updated_at
  BEFORE UPDATE ON public.interview_bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 2. Per-recruiter Google Calendar watch channel.
CREATE TABLE IF NOT EXISTS public.calendar_watch_channels (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id    uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Our channel identifiers (we generate id + token; Google returns resource_id).
    channel_id       text NOT NULL,
    resource_id      text NOT NULL,
    channel_token    text NOT NULL,
    -- Incremental-sync cursor; null forces a bounded full sync on next reconcile.
    sync_token       text,
    -- When Google's channel lapses and must be renewed.
    expiration       timestamptz,
    -- Best-effort per-recruiter reconciliation mutex; a stale value self-heals.
    reconciling_since timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_watch_channels_channel_id
    ON public.calendar_watch_channels(channel_id);

ALTER TABLE public.calendar_watch_channels ENABLE ROW LEVEL SECURITY;

-- Owners may read their own channel; all writes go through the service_role key
-- (bypasses RLS), so no insert/update/delete policy is defined.
CREATE POLICY "Users can view their own calendar watch channel"
  ON public.calendar_watch_channels FOR SELECT
  USING (auth.uid() = owner_user_id);

CREATE TRIGGER set_calendar_watch_channels_updated_at
  BEFORE UPDATE ON public.calendar_watch_channels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMIT;
