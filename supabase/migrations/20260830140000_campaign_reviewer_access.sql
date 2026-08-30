-- Migration: make campaign_reviewers actually grant access (issue #132).
--
-- The table, the editor UI and `reviewer_role_enum` have existed since
-- 20260327000000, and **no policy anywhere referenced them**. Every campaign
-- scoped policy tested `campaigns.user_id = auth.uid()` — the single owner — so
-- assigning a teammate as a reviewer granted them the ability to read the row
-- saying they were a reviewer, and nothing else. PRD 3.6.3 (multiple reviewers)
-- and the RBAC line in 7.2 were both unmet while the UI implied otherwise.
--
-- Access model (product decision 2026-08-30, the `decision` half of #132):
--
--   owner     the campaign's creator. Unchanged, full control.
--   lead      everything a reviewer can do, plus managing campaign
--             configuration and the reviewer list itself.
--   reviewer  reads everything, and may decide — transition an application,
--             re-score, write audit rows.
--   observer  reads everything. Cannot write anything, anywhere.
--
-- The distinction is enforced in SQL, not only in the UI. An `observer` who
-- calls a server action directly is refused by the policy and by
-- `transition_application`, not merely by a hidden button — otherwise the enum
-- would name a rule that does not exist, which is the defect this codebase
-- removed from `is_required` and from the interview must-have control.

BEGIN;

-- ── 1. The predicate, defined once ───────────────────────────────────────────
--
-- SECURITY DEFINER on purpose, and it is load-bearing rather than convenience:
-- a policy ON `campaigns` that queries `campaigns` re-enters its own policy and
-- recurses. A definer function runs with the owner's rights, so the lookup does
-- not re-enter RLS. This is the standard Supabase pattern for exactly this.
--
-- They leak nothing: each answers only about `auth.uid()`, the caller's own
-- identity, and returns a role name or a boolean — never another user's row.
-- `SET search_path = public` pins resolution so a caller cannot shadow
-- `campaigns` with a temp table and lie to the function.

-- **`deleted_at` is deliberately NOT checked here**, and getting that wrong
-- would have been a silent data-loss bug rather than a permissions one.
--
-- The policy this replaces was a bare `auth.uid() = user_id`, with no soft
-- delete condition, and things depend on that. `fetchTalentPoolRows` selects
-- `campaigns.deleted_at` precisely so it can FLAG a removed campaign while
-- still listing the person — "a person whose only campaign has been
-- soft-removed must still" appear in the directory. Adding the filter here
-- would have made `can_view_campaign` false for that campaign, hiding its
-- applications, hiding the candidates scoped through them, and quietly
-- emptying the talent pool of everyone whose only campaign had been removed.
--
-- Soft-deleted campaigns are filtered by the QUERIES that should not show them,
-- which is where that decision has always lived. RLS answers "is this yours",
-- not "is this current".
CREATE OR REPLACE FUNCTION public.campaign_role(p_campaign_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT CASE
        WHEN EXISTS (
            SELECT 1 FROM public.campaigns c
             WHERE c.id = p_campaign_id AND c.user_id = auth.uid()
        ) THEN 'owner'
        ELSE (
            SELECT r.role::text
              FROM public.campaign_reviewers r
             WHERE r.campaign_id = p_campaign_id
               AND r.user_id = auth.uid()
             LIMIT 1
        )
    END;
$$;

-- Read. Every role, including observer.
CREATE OR REPLACE FUNCTION public.can_view_campaign(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.campaign_role(p_campaign_id) IS NOT NULL;
$$;

-- Decide: move an application, re-score, write an audit row. Not observer.
CREATE OR REPLACE FUNCTION public.can_decide_campaign(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.campaign_role(p_campaign_id) IN ('owner', 'lead', 'reviewer');
$$;

-- Configure: rubrics, criteria, questions, SLA, availability, the reviewer
-- list. Deciding about a candidate is not the same authority as changing the
-- rules everyone is judged by, so a plain reviewer does not get this.
CREATE OR REPLACE FUNCTION public.can_manage_campaign(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.campaign_role(p_campaign_id) IN ('owner', 'lead');
$$;

GRANT EXECUTE ON FUNCTION public.campaign_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_campaign(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_decide_campaign(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_campaign(UUID) TO authenticated;

-- ── 2. campaigns ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view their own campaigns" ON campaigns;
DROP POLICY IF EXISTS "Users can update their own campaigns" ON campaigns;
DROP POLICY IF EXISTS "Users can delete their own campaigns" ON campaigns;
-- INSERT is deliberately untouched: creating a campaign makes you its owner,
-- and no reviewer relationship can exist before the row does.

CREATE POLICY "Owner or reviewer can view campaign"
  ON campaigns FOR SELECT
  USING (public.can_view_campaign(campaigns.id));

CREATE POLICY "Owner or lead can update campaign"
  ON campaigns FOR UPDATE
  USING (public.can_manage_campaign(campaigns.id));

-- Deletion stays owner-only. A lead configures a campaign; destroying one is
-- the owner's alone.
CREATE POLICY "Owner can delete campaign"
  ON campaigns FOR DELETE
  USING (auth.uid() = campaigns.user_id);

-- ── 3. campaign_reviewers ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view reviewers for their campaigns" ON campaign_reviewers;
DROP POLICY IF EXISTS "Users can insert reviewers for their campaigns" ON campaign_reviewers;
DROP POLICY IF EXISTS "Users can update reviewers for their campaigns" ON campaign_reviewers;
DROP POLICY IF EXISTS "Users can delete reviewers for their campaigns" ON campaign_reviewers;

CREATE POLICY "Campaign members can view the reviewer list"
  ON campaign_reviewers FOR SELECT
  USING (
    public.can_view_campaign(campaign_reviewers.campaign_id)
    OR campaign_reviewers.user_id = auth.uid()
  );

CREATE POLICY "Owner or lead can add reviewers"
  ON campaign_reviewers FOR INSERT
  WITH CHECK (public.can_manage_campaign(campaign_reviewers.campaign_id));

CREATE POLICY "Owner or lead can update reviewers"
  ON campaign_reviewers FOR UPDATE
  USING (public.can_manage_campaign(campaign_reviewers.campaign_id));

CREATE POLICY "Owner or lead can remove reviewers"
  ON campaign_reviewers FOR DELETE
  USING (public.can_manage_campaign(campaign_reviewers.campaign_id));

-- ── 4. Campaign configuration: read for all, write for owner/lead ────────────
DROP POLICY IF EXISTS "Users can view rubrics for their campaigns" ON evaluation_rubrics;
DROP POLICY IF EXISTS "Users can insert rubrics for their campaigns" ON evaluation_rubrics;
DROP POLICY IF EXISTS "Users can update rubrics for their campaigns" ON evaluation_rubrics;

CREATE POLICY "Campaign members can view rubrics"
  ON evaluation_rubrics FOR SELECT
  USING (public.can_view_campaign(evaluation_rubrics.campaign_id));

CREATE POLICY "Owner or lead can insert rubrics"
  ON evaluation_rubrics FOR INSERT
  WITH CHECK (public.can_manage_campaign(evaluation_rubrics.campaign_id));

CREATE POLICY "Owner or lead can update rubrics"
  ON evaluation_rubrics FOR UPDATE
  USING (public.can_manage_campaign(evaluation_rubrics.campaign_id));

-- rubric_dimensions scopes through its rubric.
DROP POLICY IF EXISTS "Users can view dimensions for their rubrics" ON rubric_dimensions;
DROP POLICY IF EXISTS "Users can insert dimensions for their rubrics" ON rubric_dimensions;
DROP POLICY IF EXISTS "Users can update dimensions for their rubrics" ON rubric_dimensions;
DROP POLICY IF EXISTS "Users can delete dimensions for their rubrics" ON rubric_dimensions;

CREATE POLICY "Campaign members can view rubric dimensions"
  ON rubric_dimensions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM evaluation_rubrics r
     WHERE r.id = rubric_dimensions.rubric_id
       AND public.can_view_campaign(r.campaign_id)
  ));

CREATE POLICY "Owner or lead can insert rubric dimensions"
  ON rubric_dimensions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM evaluation_rubrics r
     WHERE r.id = rubric_dimensions.rubric_id
       AND public.can_manage_campaign(r.campaign_id)
  ));

CREATE POLICY "Owner or lead can update rubric dimensions"
  ON rubric_dimensions FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM evaluation_rubrics r
     WHERE r.id = rubric_dimensions.rubric_id
       AND public.can_manage_campaign(r.campaign_id)
  ));

CREATE POLICY "Owner or lead can delete rubric dimensions"
  ON rubric_dimensions FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM evaluation_rubrics r
     WHERE r.id = rubric_dimensions.rubric_id
       AND public.can_manage_campaign(r.campaign_id)
  ));

DROP POLICY IF EXISTS "Users can view SLA timers for their campaigns" ON sla_timers;
DROP POLICY IF EXISTS "Users can insert SLA timers for their campaigns" ON sla_timers;
DROP POLICY IF EXISTS "Users can update SLA timers for their campaigns" ON sla_timers;
DROP POLICY IF EXISTS "Users can delete SLA timers for their campaigns" ON sla_timers;

CREATE POLICY "Campaign members can view SLA timers"
  ON sla_timers FOR SELECT
  USING (public.can_view_campaign(sla_timers.campaign_id));

CREATE POLICY "Owner or lead can insert SLA timers"
  ON sla_timers FOR INSERT
  WITH CHECK (public.can_manage_campaign(sla_timers.campaign_id));

CREATE POLICY "Owner or lead can update SLA timers"
  ON sla_timers FOR UPDATE
  USING (public.can_manage_campaign(sla_timers.campaign_id));

CREATE POLICY "Owner or lead can delete SLA timers"
  ON sla_timers FOR DELETE
  USING (public.can_manage_campaign(sla_timers.campaign_id));

DROP POLICY IF EXISTS "Users can view screening_questions in their campaigns" ON screening_questions;
DROP POLICY IF EXISTS "Users can insert screening_questions for their campaigns" ON screening_questions;
DROP POLICY IF EXISTS "Users can update screening_questions in their campaigns" ON screening_questions;
DROP POLICY IF EXISTS "Users can delete screening_questions in their campaigns" ON screening_questions;

CREATE POLICY "Campaign members can view screening questions"
  ON screening_questions FOR SELECT
  USING (public.can_view_campaign(screening_questions.campaign_id));

CREATE POLICY "Owner or lead can insert screening questions"
  ON screening_questions FOR INSERT
  WITH CHECK (public.can_manage_campaign(screening_questions.campaign_id));

CREATE POLICY "Owner or lead can update screening questions"
  ON screening_questions FOR UPDATE
  USING (public.can_manage_campaign(screening_questions.campaign_id));

CREATE POLICY "Owner or lead can delete screening questions"
  ON screening_questions FOR DELETE
  USING (public.can_manage_campaign(screening_questions.campaign_id));

DROP POLICY IF EXISTS "Users can view availability rules for their campaigns" ON interview_availability_rules;
DROP POLICY IF EXISTS "Users can insert availability rules for their campaigns" ON interview_availability_rules;
DROP POLICY IF EXISTS "Users can update availability rules for their campaigns" ON interview_availability_rules;
DROP POLICY IF EXISTS "Users can delete availability rules for their campaigns" ON interview_availability_rules;

CREATE POLICY "Campaign members can view availability rules"
  ON interview_availability_rules FOR SELECT
  USING (public.can_view_campaign(interview_availability_rules.campaign_id));

CREATE POLICY "Owner or lead can insert availability rules"
  ON interview_availability_rules FOR INSERT
  WITH CHECK (public.can_manage_campaign(interview_availability_rules.campaign_id));

CREATE POLICY "Owner or lead can update availability rules"
  ON interview_availability_rules FOR UPDATE
  USING (public.can_manage_campaign(interview_availability_rules.campaign_id));

CREATE POLICY "Owner or lead can delete availability rules"
  ON interview_availability_rules FOR DELETE
  USING (public.can_manage_campaign(interview_availability_rules.campaign_id));

-- Legacy: screening_criteria was dropped from the schema, so these policies
-- exist only on a database old enough to still carry the table.
--
-- Guarded by to_regclass rather than DROP POLICY IF EXISTS, because that IF
-- EXISTS covers the POLICY and not the TABLE: against a database where the
-- table is already gone it raises `relation "screening_criteria" does not
-- exist` and takes the whole migration down with it.
DO $$
BEGIN
    IF to_regclass('public.screening_criteria') IS NOT NULL THEN
        DROP POLICY IF EXISTS "Users can view screening criteria for their campaigns" ON screening_criteria;
        DROP POLICY IF EXISTS "Users can insert screening criteria for their campaigns" ON screening_criteria;
        DROP POLICY IF EXISTS "Users can update screening criteria for their campaigns" ON screening_criteria;
        DROP POLICY IF EXISTS "Users can delete screening criteria for their campaigns" ON screening_criteria;
    END IF;
END $$;

-- ── 5. The pipeline: read for all, write for deciders ────────────────────────
DROP POLICY IF EXISTS "Users can view applications in their campaigns" ON applications;
DROP POLICY IF EXISTS "Users can insert applications for their campaigns" ON applications;
DROP POLICY IF EXISTS "Users can update applications in their campaigns" ON applications;
DROP POLICY IF EXISTS "Users can delete applications in their campaigns" ON applications;

CREATE POLICY "Campaign members can view applications"
  ON applications FOR SELECT
  USING (public.can_view_campaign(applications.campaign_id));

CREATE POLICY "Deciders can insert applications"
  ON applications FOR INSERT
  WITH CHECK (public.can_decide_campaign(applications.campaign_id));

CREATE POLICY "Deciders can update applications"
  ON applications FOR UPDATE
  USING (public.can_decide_campaign(applications.campaign_id));

CREATE POLICY "Owner or lead can delete applications"
  ON applications FOR DELETE
  USING (public.can_manage_campaign(applications.campaign_id));

-- candidates are shared across campaigns, so they scope through applications.
DROP POLICY IF EXISTS "Users can view candidates in their campaigns" ON candidates;
DROP POLICY IF EXISTS "Users can update candidates in their campaigns" ON candidates;
-- INSERT stays `auth.uid() IS NOT NULL`: a candidate row is created before any
-- application exists, so there is no campaign to scope it against yet.

CREATE POLICY "Campaign members can view candidates"
  ON candidates FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM applications a
     WHERE a.candidate_id = candidates.id
       AND public.can_view_campaign(a.campaign_id)
  ));

CREATE POLICY "Deciders can update candidates"
  ON candidates FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM applications a
     WHERE a.candidate_id = candidates.id
       AND public.can_decide_campaign(a.campaign_id)
  ));

DROP POLICY IF EXISTS "Users can view transitions in their campaigns" ON application_transitions;

CREATE POLICY "Campaign members can view transitions"
  ON application_transitions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM applications a
     WHERE a.id = application_transitions.application_id
       AND public.can_view_campaign(a.campaign_id)
  ));

DROP POLICY IF EXISTS "Users can view screening_responses for their campaigns" ON screening_question_responses;
DROP POLICY IF EXISTS "Users can insert screening_responses for their campaigns" ON screening_question_responses;
DROP POLICY IF EXISTS "Users can update screening_responses for their campaigns" ON screening_question_responses;

CREATE POLICY "Campaign members can view screening responses"
  ON screening_question_responses FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM applications a
     WHERE a.id = screening_question_responses.application_id
       AND public.can_view_campaign(a.campaign_id)
  ));

CREATE POLICY "Deciders can insert screening responses"
  ON screening_question_responses FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM applications a
     WHERE a.id = screening_question_responses.application_id
       AND public.can_decide_campaign(a.campaign_id)
  ));

CREATE POLICY "Deciders can update screening responses"
  ON screening_question_responses FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM applications a
     WHERE a.id = screening_question_responses.application_id
       AND public.can_decide_campaign(a.campaign_id)
  ));

DROP POLICY IF EXISTS "Users can view interview_sessions for their campaigns" ON interview_sessions;
DROP POLICY IF EXISTS "Users can insert interview_sessions for their campaigns" ON interview_sessions;
DROP POLICY IF EXISTS "Users can update interview_sessions for their campaigns" ON interview_sessions;

CREATE POLICY "Campaign members can view interview sessions"
  ON interview_sessions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM applications a
     WHERE a.id = interview_sessions.application_id
       AND public.can_view_campaign(a.campaign_id)
  ));

CREATE POLICY "Deciders can insert interview sessions"
  ON interview_sessions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM applications a
     WHERE a.id = interview_sessions.application_id
       AND public.can_decide_campaign(a.campaign_id)
  ));

CREATE POLICY "Deciders can update interview sessions"
  ON interview_sessions FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM applications a
     WHERE a.id = interview_sessions.application_id
       AND public.can_decide_campaign(a.campaign_id)
  ));

DROP POLICY IF EXISTS "Users can view bookings for their campaigns" ON interview_bookings;

CREATE POLICY "Campaign members can view bookings"
  ON interview_bookings FOR SELECT
  USING (public.can_view_campaign(interview_bookings.campaign_id));

-- ── 6. Evidence and audit ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view ai_audit_log for their campaigns" ON ai_audit_log;
DROP POLICY IF EXISTS "Users can insert ai_audit_log for their campaigns" ON ai_audit_log;

CREATE POLICY "Campaign members can view ai_audit_log"
  ON ai_audit_log FOR SELECT
  USING (public.can_view_campaign(ai_audit_log.campaign_id));

CREATE POLICY "Deciders can insert ai_audit_log"
  ON ai_audit_log FOR INSERT
  WITH CHECK (public.can_decide_campaign(ai_audit_log.campaign_id));

DROP POLICY IF EXISTS "Users can view audit logs for their campaigns" ON campaign_audit_log;
DROP POLICY IF EXISTS "Users can insert audit log entries" ON campaign_audit_log;

CREATE POLICY "Campaign members can view the campaign audit log"
  ON campaign_audit_log FOR SELECT
  USING (public.can_view_campaign(campaign_audit_log.campaign_id));

CREATE POLICY "Deciders can insert campaign audit rows"
  ON campaign_audit_log FOR INSERT
  WITH CHECK (public.can_decide_campaign(campaign_audit_log.campaign_id));

DROP POLICY IF EXISTS "Users can view cached evidence for their campaigns" ON resume_evidence_cache;
DROP POLICY IF EXISTS "Users can cache evidence for their campaigns" ON resume_evidence_cache;
DROP POLICY IF EXISTS "Users can delete cached evidence for their campaigns" ON resume_evidence_cache;

CREATE POLICY "Campaign members can view cached evidence"
  ON resume_evidence_cache FOR SELECT
  USING (public.can_view_campaign(resume_evidence_cache.campaign_id));

CREATE POLICY "Deciders can cache evidence"
  ON resume_evidence_cache FOR INSERT
  WITH CHECK (public.can_decide_campaign(resume_evidence_cache.campaign_id));

CREATE POLICY "Deciders can delete cached evidence"
  ON resume_evidence_cache FOR DELETE
  USING (public.can_decide_campaign(resume_evidence_cache.campaign_id));

-- ── 7. transition_application must let a decider decide ──────────────────────
--
-- The RPC is SECURITY DEFINER, so RLS does not apply to it: it does its own
-- ownership check, and that check hard-coded the owner. Without this half, a
-- reviewer could read everything and still be refused by
-- "Access denied for application %" — the policies above would look correct and
-- the feature would still not work.
--
-- Only the authorisation line changes; the body is otherwise identical to
-- 20260830120000. `transition_application_system` is untouched: it is the
-- service-role path for cron sweeps and agent workers, which have no session
-- and therefore no role to check.

DROP FUNCTION IF EXISTS public.transition_application(UUID, candidate_stage_enum, TEXT, TEXT, TEXT, TEXT);

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
    v_rows INTEGER;
BEGIN
    IF p_actor NOT IN ('system', 'ai', 'recruiter') THEN
        RAISE EXCEPTION 'Invalid actor: %', p_actor;
    END IF;

    IF p_to_state IN ('rejected', 'archived') AND p_disposition_code IS NULL THEN
        RAISE EXCEPTION 'Transition to % requires a disposition code', p_to_state;
    END IF;

    SELECT status, campaign_id
      INTO v_from_state, v_campaign_id
      FROM public.applications
     WHERE id = p_application_id
     FOR UPDATE;

    IF v_from_state IS NULL THEN
        RAISE EXCEPTION 'Application % not found', p_application_id;
    END IF;

    -- Owner, lead or reviewer. An observer is refused here as well as by the
    -- policy, so the read-only role holds even against a direct RPC call.
    IF NOT public.can_decide_campaign(v_campaign_id) THEN
        RAISE EXCEPTION 'Access denied for application %', p_application_id;
    END IF;

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

COMMIT;
