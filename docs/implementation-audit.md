# Implementation Audit — Screenr AI

> **HISTORICAL — not current status.**
> Written 2026-04-29 and kept as a record of the thinking at the time.
> Superseded by the 2026-08-14 PRD implementation audit (issue #160). Much of it is now flatly wrong: Gmail resume intake was retired in favour of the public apply page, the shared `GOOGLE_REFRESH_TOKEN` was replaced by per-recruiter OAuth, and the standalone screening-criteria editor no longer exists.
> For what is actually built today, read [CLAUDE.md](../CLAUDE.md) and [docs/README.md](README.md).

A feature-by-feature mapping of what is actually in the codebase against [docs/prd.md](prd.md), as of 2026-04-29.

Status legend: ✅ implemented, 🟡 partial / spec-divergent, ⛔ not built.

| Feature | PRD § | Status | Key files | Assumptions / risk | Classification |
|---|---|---|---|---|---|
| **Campaign CRUD** (title, JD, dept, positions, status, deadline, location, automation mode, threshold, persona) | 3.1.1 | ✅ | [actions/campaigns.ts](../src/lib/actions/campaigns.ts), [data/campaigns.ts](../src/lib/data/campaigns.ts), [(dashboard)/campaigns/new/page.tsx](../src/app/(dashboard)/campaigns/new/page.tsx), [campaign_management_schema.sql](../supabase/migrations/20260327000000_campaign_management_schema.sql) | Single-owner via `user_id` + RLS; team multi-tenant ownership not modeled. | Core |
| **AI-suggested screening criteria + manual edit** | 3.1.2 | ✅ | [actions/ai-generate.ts](../src/lib/actions/ai-generate.ts), [services/openai.ts:136](../src/lib/services/openai.ts#L136), [campaigns/screening-criteria-editor.tsx](../src/components/campaigns/screening-criteria-editor.tsx) | gpt-4o-mini at temp 0.4; weights enforced in prompt only (no server-side normalization). | Core |
| **AI rubric generation per stage** | 3.1.3 | ✅ | [services/openai.ts:195](../src/lib/services/openai.ts#L195), [campaigns/rubric-editor.tsx](../src/components/campaigns/rubric-editor.tsx), [evaluation_rubrics table](../supabase/migrations/20260327000000_campaign_management_schema.sql#L151) | Rubric versioning column exists but no app code uses it — mid-campaign rubric changes silently overwrite. | Core |
| **Resume intake — Gmail inbox** | 3.2.1 | ✅ | [services/gmail.ts](../src/lib/services/gmail.ts), [actions/candidates.ts:51](../src/lib/actions/candidates.ts#L51), [candidates/gmail-sync-button.tsx](../src/components/candidates/gmail-sync-button.tsx) | Pulls 5 unread per call, manual recruiter-trigger only (no scheduled poll); uses `GOOGLE_REFRESH_TOKEN` env, not per-campaign OAuth as CLAUDE.md claims. | Core |
| **Resume intake — LinkedIn DMs / campaigns** | 3.2.1 | ⛔ | — | No code path; ingestion mechanism still undecided. | Ambiguous |
| **PDF/DOCX parsing → structured candidate** | 3.2.2 | 🟡 | [services/pdf.ts](../src/lib/services/pdf.ts), [services/openai.ts:48](../src/lib/services/openai.ts#L48) | PDF only via `pdf-parse`; DOCX not supported. Original file retained in `resumes` bucket. | Core |
| **Deduplication** | 3.2.3 | 🟡 | [data/candidates.ts:41](../src/lib/data/candidates.ts#L41) | `upsertCandidate` auto-merges on email — PRD requires HR-flagged review, not auto-merge. Documented violation. | Core |
| **AI resume screening + tier + rationale + factor breakdown** | 3.3.1, 3.10.1 | ✅ | [services/openai.ts](../src/lib/services/openai.ts) (`scoreResumeAgainstCriteria`), [rules/resume-scoring.ts](../src/lib/rules/resume-scoring.ts), [candidates/[candidateId]/page.tsx:23](../src/app/(dashboard)/campaigns/[id]/candidates/[candidateId]/page.tsx#L23) | Tiers in code: `strong`/`moderate`/`weak`/`no_match` — PRD names `Potential Match`. Score-factor UI shown on candidate page. | Core |
| **Automation modes (auto vs HITL)** | 3.3.2 | ✅ | [rules/resume-scoring.ts](../src/lib/rules/resume-scoring.ts), [campaigns/ai-settings-fields.tsx](../src/components/campaigns/ai-settings-fields.tsx) | HITL routes to `screening_review_pending`; no recruiter-facing review queue UI yet — recruiter must navigate per-candidate. | Core |
| **Screening threshold config + auto-reject** | 3.3.3 | 🟡 | [rules/resume-scoring.ts:42](../src/lib/rules/resume-scoring.ts#L42) | Auto-reject works (`rejected` transition with rationale) but no AI-personalized rejection email is sent. | Core |
| **AI-generated screening questions** | 3.4.1 | ✅ | [services/screening-questions.ts:11](../src/lib/services/screening-questions.ts#L11), [campaigns/screening-questions-editor.tsx](../src/components/campaigns/screening-questions-editor.tsx), [actions/screening-questions.ts:54](../src/lib/actions/screening-questions.ts#L54) | Recruiter can generate / edit / replace whole set (no per-question version history). | Core |
| **Candidate token-based screening form** | 3.4.2 | ✅ | [auth/screening-token.ts](../src/lib/auth/screening-token.ts), [respond/[token]/page.tsx](../src/app/respond/[token]/page.tsx), [respond/[token]/respond-form.tsx](../src/app/respond/[token]/respond-form.tsx) | 7-day signed-token TTL; IP rate-limited submit (10 / 10 min). | Core |
| **Video/audio recording responses + practice question + re-record** | 3.4.3 | ⛔ | [respond/[token]/respond-form.tsx](../src/app/respond/[token]/respond-form.tsx) (text only) | **Major spec divergence.** Implementation is text textarea + Zod min(1) string. PRD mandates recordings + practice + re-record. | Core |
| **AI scoring of screening answers (per-question + overall)** | 3.4.4 | 🟡 | [services/screening-questions.ts:93](../src/lib/services/screening-questions.ts#L93), [actions/screening-questions.ts:259](../src/lib/actions/screening-questions.ts#L259) | Scores text answers, not transcripts; no transcript-to-score linkage (3.10.2) since no recording exists. | Core |
| **AI Technical Interview (real-time video + STT/TTS + Claude)** | 3.5.1–3.5.3 | ⛔ | — | Entire feature missing. STT/TTS/realtime vendor TBDs in PRD. Claude integration absent (OpenAI only). | Core |
| **Proctoring** | 3.5.4 | ⛔ | — | Not built. | Core |
| **Interview recording + transcript** | 3.5.5 | ⛔ | — | Not built. | Core |
| **Interview self-scheduling** | 3.5.6 | ⛔ | — | `interview_scheduling` state exists in enum but no scheduler UI / availability model. | Core |
| **Interview scoring (per-section, evidence-linked)** | 3.5.7, 3.10.2 | ⛔ | — | Not built (no interview to score). | Core |
| **Interviewer persona modes** | 3.5.8 | 🟡 | [constants.ts:5](../src/lib/constants.ts#L5), [campaigns/ai-settings-fields.tsx](../src/components/campaigns/ai-settings-fields.tsx) | Config + storage for `pressure/collaborative/socratic/neutral` persisted, but no consumer code reads it (no AI interviewer to apply it to). | Core |
| **Smart difficulty adaptation, multi-language, simulations** | 3.5.9–3.5.11 | ⛔ | — | Not built. | Likely deferred (depends on 3.5 core) |
| **Manager dashboard — ranked list + sort** | 3.6.1 | 🟡 | [(dashboard)/campaigns/[id]/page.tsx](../src/app/(dashboard)/campaigns/[id]/page.tsx), [campaigns/candidate-table.tsx](../src/components/campaigns/candidate-table.tsx) | Lists candidates with resume score; no sort by stage scores other than resume; no recordings/transcripts to surface. | Core |
| **Manager actions — advance / reject / notes / flag / compare / bulk** | 3.6.2 | 🟡 | [candidates/stage-changer.tsx](../src/components/candidates/stage-changer.tsx), [actions/candidates.ts:220](../src/lib/actions/candidates.ts#L220) | Stage change + manual rationale exists. Notes, flagging, side-by-side compare, bulk actions, talent-pool action — none. | Core |
| **Multi-reviewer collaboration / activity log** | 3.6.3 | 🟡 | [campaign_reviewers table](../supabase/migrations/20260327000000_campaign_management_schema.sql#L261), [campaigns/team-reviewers-editor.tsx](../src/components/campaigns/team-reviewers-editor.tsx) | Editor lets recruiter list reviewers but `user_id` is faked client-side (`user-temp-${Date.now()}`); no notes table; no ratings; no dashboard view. | Ambiguous |
| **Interview replay / AI commentary / highlight reel** | 3.6.4 | ⛔ | — | Depends on missing recordings. | Likely deferred |
| **AI audit log (per call)** | 3.7.1 | 🟡 | [data/candidates.ts:147](../src/lib/data/candidates.ts#L147), [ai_audit_log table](../supabase/migrations/20260330174903_candidate_pipeline_schema.sql#L60) | Logs only resume-parsing + resubmission; resume-scoring + screening-question scoring runs do **not** log. Schema captures model + prompt_version but no `confidence` or `rubric_version` column. | Core |
| **Append-only state-machine transition log** | 3.7.1, 3.7.2 | ✅ | [application_transitions_log.sql](../supabase/migrations/20260417000000_application_transitions_log.sql), [data/transitions.ts](../src/lib/data/transitions.ts) | Atomic `transition_application` RPC enforces legal transitions + optimistic locking. Recruiter rationale required. | Core |
| **Audit log UI (filter / export / 3-year retention)** | 3.7.3 | ⛔ | — | No `/audit` route or admin view. Retention policy not configured. | Core |
| **Calibration / drift monitoring** | 3.7.4 | ⛔ | — | Not built. | Likely deferred |
| **Final interview scheduling (Google Calendar)** | 3.8 | ⛔ | — | `final_interview_scheduling` state in enum; no calendar code. | Core |
| **AI-personalized rejection emails** | 3.9.1 | ⛔ | [services/email-templates/screening-questions.ts](../src/lib/services/email-templates/screening-questions.ts) (only template) | Only template is the screening-questions invite. No rejection mailer. | Core |
| **Interview prep guide page** | 3.9.2 | ⛔ | — | No page or link generator. | Core |
| **Mobile responsiveness for candidate surfaces** | 3.9.3 | 🟡 | [respond/[token]/respond-form.tsx](../src/app/respond/[token]/respond-form.tsx) | Tailwind layout, but unverified on iOS/Android; no mobile-only desktop-warning page (interview is desktop-only per PRD but no interview UI yet). | Ambiguous |
| **Granular score attribution** | 3.10.1 | ✅ | [candidates/[candidateId]/page.tsx:23](../src/app/(dashboard)/campaigns/[id]/candidates/[candidateId]/page.tsx#L23), `applications.score_factors` jsonb | Resume score factors render on candidate page; not yet for screening answers (per-answer scores stored but no factor view). | Core |
| **Transcript-to-score linkage** | 3.10.2 | ⛔ | — | Depends on transcripts (3.4.3 / 3.5.5). | Core |
| **Score comparison view + rubric versioning flag** | 3.10.3 | ⛔ | — | No compare view; rubric `version`/`is_active` columns exist but no scoring path stamps the version onto a score record. | Ambiguous |
| **Scoring methodology documentation** | 3.10.4 | ⛔ | — | Not surfaced anywhere. | Likely deferred |
| **Talent pool (silver-medalist)** | 3.11 | ⛔ | — | No table, no UI, no warm-rejection email. | Core (per PRD) |
| **Bulk actions** | 3.12.1 | ⛔ | — | No multi-select on candidate table. | Core |
| **SLA timers + overdue indicator** | 3.12.2 | 🟡 | [sla_timers table](../supabase/migrations/20260327000000_campaign_management_schema.sql#L314), [campaigns/sla-timers-editor.tsx](../src/components/campaigns/sla-timers-editor.tsx) | Recruiter can configure timers, but no consumer that compares `entered_at` against limits, no overdue filter, no alerts. | Core |
| **Campaign cloning** | 3.12.3 | ✅ | [actions/campaigns.ts:105](../src/lib/actions/campaigns.ts#L105), [data/campaigns.ts](../src/lib/data/campaigns.ts) (`cloneCampaignTx`), [clone-campaign-button.tsx](../src/components/campaigns/clone-campaign-button.tsx) | Clones config; verify it carries SLA timers + rubrics correctly. | Core |
| **Auto-archiving (non-response, no-slot)** | 3.12.4 | ⛔ | — | `archived` state in enum but no scheduled job. | Core |
| **No-show handling + reschedule** | 3.12.5 | ⛔ | — | No interview scheduling layer to detect no-shows. | Core (depends on 3.5.6) |
| **Reusable template library** | 3.12.6 | ⛔ | — | Email/question/rubric templates are per-campaign only. | Likely deferred |
| **Skill fingerprint** | 3.13 | ⛔ | — | Not built. | Likely deferred |
| **Bias auditor** | 3.14 | ⛔ | — | Not built. EU AI Act compliance gap. | Core (compliance) |
| **Candidate experience surveys + signals** | 3.15 | ⛔ | — | Not built. | Likely deferred |
| **Team fit prediction** | 3.16 | ⛔ | — | Not built. | Likely deferred |
| **Coaching mode (public practice)** | 3.17 | ⛔ | — | Not built. | Likely deferred |
| **Predictive analytics** | 3.18 | ⛔ | — | Not built. | Likely deferred |
| **AI reference check** | 3.19 | ⛔ | — | `reference_check` state in enum; no flow. | Core (per PRD) |
| **Transactional emails** | §4.1 | 🟡 | [services/email.ts](../src/lib/services/email.ts), [services/email-templates/screening-questions.ts](../src/lib/services/email-templates/screening-questions.ts) | Single template (screening invite) sent via Gmail API. Rejection / reminder / interview-invite / confirmation / no-show / reference templates absent. PRD email-provider TBD; current path is recruiter's Gmail OAuth, not Resend/Postmark/SendGrid. | Core |
| **Admin notifications & alerts** | §5 | ⛔ | — | No notifications table or in-app inbox. | Core |
| **Auth + token-based candidate access** | §7.2 | ✅ | [middleware.ts](../src/middleware.ts), [auth/guards.ts](../src/lib/auth/guards.ts), [auth/screening-token.ts](../src/lib/auth/screening-token.ts) | Supabase Auth + signed JWT-style token (HMAC) for candidate links. RLS enabled on every domain table. | Core |
| **Rate limiting** | §7 (implied) | 🟡 | [rate-limit.ts](../src/lib/rate-limit.ts) | In-memory per-process; CLAUDE.md flags it as not multi-instance-safe. | Ambiguous |
| **Tech stack — AI engine** | §8 | 🟡 | [services/openai.ts](../src/lib/services/openai.ts), [services/screening-questions.ts](../src/lib/services/screening-questions.ts) | OpenAI `gpt-4o-mini` everywhere. PRD/onboarding say Claude Opus 4.5 — note already captured in [docs/prd-notes.md](prd-notes.md). | Core (tech direction) |

## Headline gaps

1. **Screening answer recordings (3.4.3)** — biggest spec divergence; current text shortcut is incompatible with downstream transcript-to-score linkage.
2. **AI Interview (3.5)** — entirely missing, gates 3.5.4–3.5.11, 3.6.4, 3.10.2, 3.12.5, 3.13, 3.16.
3. **Audit completeness (3.7)** — log only fires for resume parsing; resume + screening scoring need to write `ai_audit_log` rows with prompt/model/rubric versions.
4. **Compliance scope (3.14, 3.7.3)** — bias auditor and audit-log retention/export are zero-coded; high regulatory cost.
5. **Email surface (§4)** — only 1 of ~11 transactional templates exists, and the transport is recruiter-Gmail rather than the PRD's TBD ESP.
