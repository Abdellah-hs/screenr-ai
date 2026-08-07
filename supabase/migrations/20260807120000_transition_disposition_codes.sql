-- Migration: structured disposition codes on terminal transitions.
--
-- CLAUDE.md has always required that closing an application records a
-- structured `{code, description}`, but nothing implemented it: the reason a
-- candidate was rejected lived only in free-text `rationale`. That made the
-- reasons uncountable — the automatic paths wrote "below threshold", the
-- expiry sweep wrote its own phrasing, and a recruiter wrote whatever they
-- liked, so "how many rejections were score-driven this quarter?" could only
-- be answered by reading every row by hand.
--
-- Two columns, a vocabulary constraint, and a rule that a rejection cannot be
-- written without a code. The description stays free text and keeps the
-- specifics.

BEGIN;

-- 1. The columns. `text` + CHECK rather than a new enum type, matching the
--    `actor` column on this same table — adding a code later is then a
--    constraint swap, not an ALTER TYPE that has to be coordinated with a
--    deploy.
ALTER TABLE public.application_transitions
    ADD COLUMN IF NOT EXISTS disposition_code TEXT,
    ADD COLUMN IF NOT EXISTS disposition_description TEXT;

-- 2. Vocabulary. NULL stays legal — most transitions are mid-pipeline and
--    have no disposition at all.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'application_transitions_disposition_code_check'
          AND conrelid = 'public.application_transitions'::regclass
    ) THEN
        ALTER TABLE public.application_transitions
            ADD CONSTRAINT application_transitions_disposition_code_check
            CHECK (disposition_code IS NULL OR disposition_code IN (
                'LOW_SCORE',
                'FAILED_INTERVIEW',
                'NO_SHOW',
                'EXPIRED',
                'OVERRIDE_REJECTED'
            ));
    END IF;
END $$;

-- 3. The actual rule: closing an application requires saying why.
--
--    Scoped to `rejected` / `archived` — the states that close without
--    explaining themselves. `screening_expired` and friends are excluded
--    because the state name already is the reason, and `hired` because its
--    "why" is the outcome itself.
--
--    NOT VALID on purpose. Every transition logged before this migration has
--    a NULL code, and those rows are an immutable audit trail — back-filling
--    them would mean inventing reasons for decisions nobody recorded. NOT
--    VALID leaves history untouched while enforcing the rule on every new
--    write, which is the half that matters. Do not run VALIDATE CONSTRAINT
--    on this without back-filling first; it will fail.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'application_transitions_terminal_disposition_check'
          AND conrelid = 'public.application_transitions'::regclass
    ) THEN
        ALTER TABLE public.application_transitions
            ADD CONSTRAINT application_transitions_terminal_disposition_check
            CHECK (
                to_state NOT IN ('rejected', 'archived')
                OR disposition_code IS NOT NULL
            ) NOT VALID;
    END IF;
END $$;

-- 4. Partial index — the point of the codes is aggregate queries ("count
--    rejections by reason"), and only a small fraction of transition rows
--    carry one, so indexing the NULLs would be dead weight.
CREATE INDEX IF NOT EXISTS idx_application_transitions_disposition_code
    ON public.application_transitions(disposition_code)
    WHERE disposition_code IS NOT NULL;

-- 5. Both RPCs learn the two new arguments.
--
--    Dropped and recreated rather than CREATE OR REPLACE: adding parameters
--    changes the signature, so a replace would leave the 4-arg version in
--    place as an overload and every existing named-argument call would become
--    ambiguous rather than picking up the new behaviour. Dropping also drops
--    the grants, so they are reissued below.

DROP FUNCTION IF EXISTS public.transition_application(UUID, candidate_stage_enum, TEXT, TEXT);

CREATE FUNCTION public.transition_application(
    p_application_id UUID,
    p_to_state candidate_stage_enum,
    p_actor TEXT,
    p_rationale TEXT DEFAULT NULL,
    p_disposition_code TEXT DEFAULT NULL,
    p_disposition_description TEXT DEFAULT NULL
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

    -- Fail with a readable message rather than letting the table constraint
    -- surface as a raw check violation.
    IF p_to_state IN ('rejected', 'archived') AND p_disposition_code IS NULL THEN
        RAISE EXCEPTION 'Transition to % requires a disposition code', p_to_state;
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
        (application_id, from_state, to_state, actor, rationale,
         disposition_code, disposition_description)
    VALUES
        (p_application_id, v_from_state, p_to_state, p_actor, p_rationale,
         p_disposition_code, p_disposition_description);
END;
$$;

GRANT EXECUTE
    ON FUNCTION public.transition_application(UUID, candidate_stage_enum, TEXT, TEXT, TEXT, TEXT)
    TO authenticated;

DROP FUNCTION IF EXISTS public.transition_application_system(UUID, candidate_stage_enum, TEXT);

CREATE FUNCTION public.transition_application_system(
    p_application_id UUID,
    p_to_state candidate_stage_enum,
    p_rationale TEXT DEFAULT NULL,
    p_disposition_code TEXT DEFAULT NULL,
    p_disposition_description TEXT DEFAULT NULL
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
    IF p_to_state IN ('rejected', 'archived') AND p_disposition_code IS NULL THEN
        RAISE EXCEPTION 'Transition to % requires a disposition code', p_to_state;
    END IF;

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
        (application_id, from_state, to_state, actor, rationale,
         disposition_code, disposition_description)
    VALUES
        (p_application_id, v_from_state, p_to_state, 'system', p_rationale,
         p_disposition_code, p_disposition_description);
END;
$$;

REVOKE ALL ON FUNCTION public.transition_application_system(UUID, candidate_stage_enum, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE
    ON FUNCTION public.transition_application_system(UUID, candidate_stage_enum, TEXT, TEXT, TEXT)
    TO service_role;

COMMIT;
