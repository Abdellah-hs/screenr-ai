-- Migration: Drop legacy values from candidate_stage_enum (issue #28).
--
-- Legacy values 'screening', 'screening_q', 'interview' predate the canonical
-- ATS state set (see CLAUDE.md -> ATS State Machine Rules). They bridged into
-- canonical states but created confusion and illegal-transition risk.
--
-- Postgres cannot DROP a value from an enum, so this migration:
--   1. Remaps every legacy-valued row to its canonical equivalent.
--   2. Recreates candidate_stage_enum without the legacy values. The three
--      failure states from 20260419000000 (screening_expired,
--      interview_no_show, processing_failed) are carried over so the
--      recreation preserves them instead of dropping them.
--   3. Converts the dependent columns and recreates transition_application().
--
-- Legacy -> canonical mapping (confirmed against existing code semantics):
--   screening    -> screening_approved   (approved into screening, not yet sent)
--   screening_q  -> screening_approved   (data layer already treats them as equal)
--   interview    -> interview_completed  (legacy `interview` advanced straight to
--                                         interview_scored, i.e. interview happened)
--
-- Safe inside one transaction: contains no ALTER TYPE ... ADD VALUE.

BEGIN;

-- 1. Remap existing rows while the legacy values still exist in the type.
UPDATE public.applications
   SET status = 'screening_approved'
 WHERE status IN ('screening', 'screening_q');

UPDATE public.applications
   SET status = 'interview_completed'
 WHERE status = 'interview';

UPDATE public.application_transitions
   SET from_state = 'screening_approved'
 WHERE from_state IN ('screening', 'screening_q');

UPDATE public.application_transitions
   SET from_state = 'interview_completed'
 WHERE from_state = 'interview';

UPDATE public.application_transitions
   SET to_state = 'screening_approved'
 WHERE to_state IN ('screening', 'screening_q');

UPDATE public.application_transitions
   SET to_state = 'interview_completed'
 WHERE to_state = 'interview';

-- 2. Drop the function that depends on the enum type (recreated in step 6).
DROP FUNCTION IF EXISTS public.transition_application(UUID, candidate_stage_enum, TEXT, TEXT);

-- 3. Swap the type: rename the old one aside, create the canonical-only one.
ALTER TYPE candidate_stage_enum RENAME TO candidate_stage_enum_legacy;

CREATE TYPE candidate_stage_enum AS ENUM (
    'new',
    'screening_review_pending',
    'screening_approved',
    'screening_sent',
    'screening_completed',
    'screening_scored',
    'interview_scheduling',
    'interview_scheduled',
    'interview_completed',
    'interview_scored',
    'reference_check',
    'manager_review',
    'final_interview_scheduling',
    'screening_expired',
    'interview_no_show',
    'processing_failed',
    'rejected',
    'hired',
    'withdrawn',
    'archived'
);

-- 4. Convert applications.status. The default must be dropped before the
--    cast (its 'new'::old_type expression can't survive the type change)
--    and restored afterwards.
ALTER TABLE public.applications
    ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.applications
    ALTER COLUMN status TYPE candidate_stage_enum
    USING status::text::candidate_stage_enum;
ALTER TABLE public.applications
    ALTER COLUMN status SET DEFAULT 'new';

-- 5. Convert the transition-log columns (no defaults to manage here).
ALTER TABLE public.application_transitions
    ALTER COLUMN from_state TYPE candidate_stage_enum
    USING from_state::text::candidate_stage_enum;
ALTER TABLE public.application_transitions
    ALTER COLUMN to_state TYPE candidate_stage_enum
    USING to_state::text::candidate_stage_enum;

-- 6. Drop the now-unreferenced legacy type and recreate the transition RPC
--    bound to the canonical type. The body is unchanged from the original
--    migration (20260417000000) -- only the enum underneath it changed.
DROP TYPE candidate_stage_enum_legacy;

CREATE FUNCTION public.transition_application(
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
