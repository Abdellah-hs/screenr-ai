-- Migration: Per-campaign AI-interview availability configuration.
--
-- Adds the recruiter-facing config for when AI interviews can be booked
-- (PRD 3.5.6). Candidates will later self-select a slot generated from these
-- weekly rules. Model: per-weekday time ranges (one row per rule) + campaign-
-- level slot length, timezone, and booking horizon. One candidate per slot
-- (no concurrency in V1). Mirrors the sla_timers child-collection pattern.

BEGIN;

-- 1. Campaign-level scalar config.
ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS interview_slot_minutes INTEGER,
    ADD COLUMN IF NOT EXISTS interview_timezone TEXT,
    ADD COLUMN IF NOT EXISTS interview_booking_horizon_days INTEGER NOT NULL DEFAULT 14;

-- 2. Weekly recurring availability rules (one row per weekday time range).
--    Times are minutes-from-midnight (0-1440) interpreted in the campaign's
--    interview_timezone, which keeps downstream slot math trivial.
CREATE TABLE IF NOT EXISTS public.interview_availability_rules (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id  uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    weekday      smallint NOT NULL,          -- 0=Sunday .. 6=Saturday (JS getDay)
    start_minute smallint NOT NULL,
    end_minute   smallint NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (weekday BETWEEN 0 AND 6),
    CHECK (start_minute BETWEEN 0 AND 1439),
    CHECK (end_minute BETWEEN 1 AND 1440),
    CHECK (end_minute > start_minute)
);

CREATE INDEX IF NOT EXISTS idx_interview_availability_rules_campaign_id
    ON public.interview_availability_rules(campaign_id);

ALTER TABLE public.interview_availability_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view availability rules for their campaigns"
  ON public.interview_availability_rules FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE campaigns.id = interview_availability_rules.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert availability rules for their campaigns"
  ON public.interview_availability_rules FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE campaigns.id = interview_availability_rules.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can update availability rules for their campaigns"
  ON public.interview_availability_rules FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE campaigns.id = interview_availability_rules.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete availability rules for their campaigns"
  ON public.interview_availability_rules FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE campaigns.id = interview_availability_rules.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

CREATE TRIGGER set_interview_availability_rules_updated_at
  BEFORE UPDATE ON public.interview_availability_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMIT;
