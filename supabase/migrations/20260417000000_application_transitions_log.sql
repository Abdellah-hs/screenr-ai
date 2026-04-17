-- Migration: Append-only application state transition log + atomic transition RPC.
-- Enforces the ATS state-machine rules: every status change on applications
-- must go through transition_application(), which validates the transition,
-- flips applications.status, and appends an immutable audit row in one DB txn.

BEGIN;

-- 1. Append-only transition log
CREATE TABLE IF NOT EXISTS public.application_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
    from_state candidate_stage_enum,
    to_state candidate_stage_enum NOT NULL,
    actor TEXT NOT NULL CHECK (actor IN ('system', 'ai', 'recruiter')),
    rationale TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_application_transitions_application_id
    ON public.application_transitions(application_id);
CREATE INDEX IF NOT EXISTS idx_application_transitions_created_at
    ON public.application_transitions(created_at DESC);

-- 2. Row-level security — read is scoped to campaign owners; writes only via RPC.
ALTER TABLE public.application_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view transitions in their campaigns"
    ON public.application_transitions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.applications a
            JOIN public.campaigns c ON c.id = a.campaign_id
            WHERE a.id = application_transitions.application_id
              AND c.user_id = auth.uid()
        )
    );

-- No INSERT/UPDATE/DELETE policies — append-only, and only the SECURITY DEFINER
-- function below is allowed to write (it runs with elevated privileges).

-- 3. Atomic transition RPC
--    Locks the application row, validates from_state, updates status, and
--    appends the log row — all inside one transaction. Any failure rolls back.
CREATE OR REPLACE FUNCTION public.transition_application(
    p_application_id UUID,
    p_to_state candidate_stage_enum,
    p_actor TEXT,
    p_rationale TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_from_state candidate_stage_enum;
    v_campaign_id UUID;
    v_owner UUID;
    v_rows INTEGER;
BEGIN
    IF p_actor NOT IN ('system', 'ai', 'recruiter') THEN
        RAISE EXCEPTION 'Invalid actor: %', p_actor;
    END IF;

    -- Lock the application row and grab current state + campaign
    SELECT status, campaign_id
      INTO v_from_state, v_campaign_id
      FROM public.applications
     WHERE id = p_application_id
     FOR UPDATE;

    IF v_from_state IS NULL THEN
        RAISE EXCEPTION 'Application % not found', p_application_id;
    END IF;

    -- Enforce ownership (the invoker must own the campaign)
    SELECT user_id INTO v_owner FROM public.campaigns WHERE id = v_campaign_id;
    IF v_owner IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Access denied for application %', p_application_id;
    END IF;

    -- Idempotency: transitioning to the current state is a no-op
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
        (p_application_id, v_from_state, p_to_state, p_actor, p_rationale);
END;
$$;

GRANT EXECUTE
    ON FUNCTION public.transition_application(UUID, candidate_stage_enum, TEXT, TEXT)
    TO authenticated;

COMMIT;
