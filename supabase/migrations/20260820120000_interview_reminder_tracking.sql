-- Migration: reminder tracking + a durable join link for booked final interviews.
--
-- #72 wires the 24h / 1h reminder emails to a scheduled sweep. Two things were
-- missing to make that safe:
--
--   1. Double-send protection. The sweep must be able to CLAIM a reminder
--      atomically, so two overlapping cron runs (or a retry) can send at most
--      one copy. Two nullable timestamps give that: an UPDATE ... WHERE col IS
--      NULL matches for exactly one caller, the same conditional-update trick
--      already used by markBookingPendingReschedule.
--
--   2. The Meet link. It was only ever known in-memory at booking time and
--      passed straight into the confirmation email, so a reminder had no way to
--      say "join here" — which is the single most useful line in a reminder
--      sent an hour before the call. Storing it makes the reminder as useful as
--      the confirmation.
--
-- A reschedule must clear both stamps (the candidate now has a different time
-- to be reminded about); that reset lives in updateBooking, not in a trigger,
-- so the reset is visible where the new time is written.

BEGIN;

ALTER TABLE public.interview_bookings
    ADD COLUMN IF NOT EXISTS meet_url text,
    ADD COLUMN IF NOT EXISTS reminder_24h_sent_at timestamptz,
    ADD COLUMN IF NOT EXISTS reminder_1h_sent_at timestamptz;

-- The sweep asks one question: which booked interviews start inside the next
-- day? A partial index keeps that cheap as booking history grows, since
-- everything already past or rescheduled is dead weight for this query.
CREATE INDEX IF NOT EXISTS idx_interview_bookings_reminder_window
    ON public.interview_bookings(scheduled_at)
    WHERE status = 'booked';

COMMIT;
