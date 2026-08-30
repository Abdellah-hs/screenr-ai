-- Migration: Drop 'reference_check' from candidate_stage_enum.
--
-- Product decision (2026-08-30): the optional AI reference-check stage is
-- retired and will not be built. PRD 3.19 is retired with it; see the
-- "3.13-3.19 - Retired" banner in docs/prd.md.
--
-- The value had to go rather than merely sitting unused. It was reachable:
-- STATUS_TRANSITIONS allowed interview_scored -> reference_check, so the stage
-- dropdown would move an application into a stage with no screen, no action
-- and no rule to move it on. A candidate parked there would sit until somebody
-- noticed by hand -- exactly the silent failure CLAUDE.md forbids.
--
-- Postgres cannot DROP a value from an enum, so this mirrors the rebuild in
-- 20260616120000_drop_withdrawn_state.sql:
--   1. Remap every 'reference_check' row while the value still exists.
--   2. Drop the two RPCs that depend on the type.
--   3. Recreate candidate_stage_enum without 'reference_check'.
--   4. Convert the three dependent columns.
--   5. Recreate both RPCs and reissue their grants.
--
-- Safe inside one transaction: contains no ALTER TYPE ... ADD VALUE.

BEGIN;

-- 1. Remap existing rows while 'reference_check' still exists in the type.
--
--    'manager_review' is the destination, not 'interview_scored'. Anyone in
--    this state has been interviewed and scored; what they are waiting for is
--    a person to decide. Sending them backwards to interview_scored would
--    re-open a stage they have already cleared, and manager_review is where
--    reference_check pointed anyway (it was its only non-terminal edge).
--
--    In practice this should match nothing -- the stage was never implemented,
--    so the only way in was a manual stage change.
UPDATE public.applications
   SET status = 'manager_review'
 WHERE status = 'reference_check';

-- Rewriting the transitions log is unavoidable: the value no longer exists in
-- the type, so a row naming it could not be cast. A log row that recorded
-- reference_check -> manager_review therefore becomes manager_review ->
-- manager_review. Harmless (nothing constrains the log to distinct states) and
-- honest about the fact that the stage it named is gone.
UPDATE public.application_transitions
   SET from_state = 'manager_review'
 WHERE from_state = 'reference_check';

UPDATE public.application_transitions
   SET to_state = 'manager_review'
 WHERE to_state = 'reference_check';

-- 2a. Drop the terminal-disposition CHECK before the type swap (re-added in
--     step 4a).
--
--     Not optional, and not present in the 20260616120000 precedent because
--     that migration predates the constraint. Its expression is
--     `to_state NOT IN ('rejected', 'archived') OR disposition_code IS NOT
--     NULL`, and those two literals were resolved to the enum type as it stood
--     when the constraint was created. After the rename below they are
--     candidate_stage_enum_legacy values, so re-checking the constraint against
--     the freshly converted column asks Postgres for
--     `candidate_stage_enum <> candidate_stage_enum_legacy` — an operator that
--     does not exist. The first attempt at this migration failed there and
--     rolled back.
ALTER TABLE public.application_transitions
    DROP CONSTRAINT IF EXISTS application_transitions_terminal_disposition_check;

-- 2b. Drop the functions that depend on the enum type (recreated in step 5).
--     Signatures are the 6-arg / 5-arg disposition-aware versions created in
--     20260807120000_transition_disposition_codes.sql.
DROP FUNCTION IF EXISTS public.transition_application(UUID, candidate_stage_enum, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.transition_application_system(UUID, candidate_stage_enum, TEXT, TEXT, TEXT);

-- 3. Swap the type: rename the old one aside, create the canonical-only one.
ALTER TYPE candidate_stage_enum RENAME TO candidate_stage_enum_legacy;

CREATE TYPE candidate_stage_enum AS ENUM (
    'new',
    'screening_review_pending',
    'screening_approved',
    'screening_sent',
    'screening_completed',
    'screening_scored',
    'interview_invited',
    'interview_scheduling',
    'interview_scheduled',
    'interview_completed',
    'interview_scored',
    'manager_review',
    'final_interview_scheduling',
    'screening_expired',
    'interview_no_show',
    'interview_expired',
    'processing_failed',
    'rejected',
    'hired',
    'archived'
);

-- 4. Convert applications.status. The default must be dropped before the cast
--    (its 'new'::old_type expression cannot survive the type change) and
--    restored afterwards.
ALTER TABLE public.applications
    ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.applications
    ALTER COLUMN status TYPE candidate_stage_enum
    USING status::text::candidate_stage_enum;
ALTER TABLE public.applications
    ALTER COLUMN status SET DEFAULT 'new';

-- Convert the transition-log columns (no defaults to manage here).
ALTER TABLE public.application_transitions
    ALTER COLUMN from_state TYPE candidate_stage_enum
    USING from_state::text::candidate_stage_enum;
ALTER TABLE public.application_transitions
    ALTER COLUMN to_state TYPE candidate_stage_enum
    USING to_state::text::candidate_stage_enum;

-- 4a. Re-add the terminal-disposition CHECK, its literals now bound to the
--     canonical type.
--
--     NOT VALID, exactly as 20260807120000 created it, and this matters: every
--     transition logged before that migration carries a NULL disposition_code,
--     and those rows are an immutable audit trail. Re-adding this as a VALIDATED
--     constraint would either fail outright or demand that reasons be invented
--     for decisions nobody recorded. NOT VALID enforces the rule on every new
--     write and leaves history alone — the half that matters. Do not run
--     VALIDATE CONSTRAINT on it without back-filling first.
ALTER TABLE public.application_transitions
    ADD CONSTRAINT application_transitions_terminal_disposition_check
    CHECK (
        to_state NOT IN ('rejected', 'archived')
        OR disposition_code IS NOT NULL
    ) NOT VALID;

DROP TYPE candidate_stage_enum_legacy;

-- 5. Recreate both RPCs bound to the canonical type. The bodies are unchanged
--    from 20260807120000 -- only the enum underneath them changed. Dropping
--    the functions dropped their grants, so those are reissued.

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
