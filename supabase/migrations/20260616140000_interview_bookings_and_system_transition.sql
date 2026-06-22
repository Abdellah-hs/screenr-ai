-- Migration: AI-interview bookings + a service-role system-transition RPC.
--
-- Candidate self-scheduling (PRD 3.5.6): a candidate books one slot, advancing
-- the application to interview_scheduled. Two pieces:
--   1. interview_bookings — one booking per application; one candidate per slot
--      (UNIQUE(campaign_id, scheduled_at)).
--   2. transition_application_system — lets a token-verified candidate action
--      (running with the service_role key) advance state WITHOUT a recruiter
--      session. The existing transition_application stays owner-gated; this
--      variant drops the auth.uid()=owner check, forces actor='system', and is
--      granted to service_role ONLY (anon/authenticated cannot call it).

BEGIN;

-- 1. Interview bookings.
CREATE TABLE IF NOT EXISTS public.interview_bookings (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL UNIQUE REFERENCES public.applications(id) ON DELETE CASCADE,
    campaign_id   uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    scheduled_at  timestamptz NOT NULL,
    slot_minutes  integer NOT NULL,
    timezone      text NOT NULL,
    status        text NOT NULL DEFAULT 'booked',
    created_at    timestamptz NOT NULL DEFAULT now(),
    -- One candidate per slot for a campaign.
    UNIQUE (campaign_id, scheduled_at)
);

CREATE INDEX IF NOT EXISTS idx_interview_bookings_campaign_id
    ON public.interview_bookings(campaign_id);

ALTER TABLE public.interview_bookings ENABLE ROW LEVEL SECURITY;

-- Recruiters can read bookings tied to their campaigns. Candidate inserts run
-- through the service_role key (bypasses RLS) after a verified token, so no
-- candidate-facing write policy is defined.
CREATE POLICY "Users can view bookings for their campaigns"
  ON public.interview_bookings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE campaigns.id = interview_bookings.campaign_id
      AND campaigns.user_id = auth.uid()
  ));

-- 2. System transition RPC (service_role only). Same atomic update+log as
--    transition_application, minus the owner check, actor pinned to 'system'.
CREATE FUNCTION public.transition_application_system(
    p_application_id UUID,
    p_to_state candidate_stage_enum,
    p_rationale TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_from_state candidate_stage_enum;
    v_rows INTEGER;
BEGIN
    SELECT status
      INTO v_from_state
      FROM public.applications
     WHERE id = p_application_id
     FOR UPDATE;

    IF v_from_state IS NULL THEN
        RAISE EXCEPTION 'Application % not found', p_application_id;
    END IF;

    -- Idempotency: transitioning to the current state is a no-op.
    IF v_from_state = p_to_state THEN
        RETURN;
    END IF;

    UPDATE public.applications
       SET status = p_to_state
     WHERE id = p_application_id AND status = v_from_state;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RAISE EXCEPTION 'Concurrent state change on application %', p_application_id;
    END IF;

    INSERT INTO public.application_transitions
        (application_id, from_state, to_state, actor, rationale)
    VALUES
        (p_application_id, v_from_state, p_to_state, 'system', p_rationale);
END;
$$;

-- Privileged: callable only by the service_role key (used server-side after a
-- candidate's signed token is verified), never by anon/authenticated clients.
REVOKE ALL ON FUNCTION public.transition_application_system(UUID, candidate_stage_enum, TEXT) FROM PUBLIC;
GRANT EXECUTE
    ON FUNCTION public.transition_application_system(UUID, candidate_stage_enum, TEXT)
    TO service_role;

COMMIT;
