# Delta PRD — Screenr AI

> **HISTORICAL — not current status.**
> Written 2026-04-29 and kept as a record of the thinking at the time.
> Its central working assumption — "V1 = ATS-first, not the full real-time AI interview platform" — was overtaken. The real-time AI interview shipped in #117-#124.
> For what is actually built today, read [CLAUDE.md](../CLAUDE.md) and [docs/README.md](README.md).

A decision-oriented complement to `docs/prd.md`, based on the current codebase audit as of 2026-04-29.

## Working assumption

Until explicitly changed, **V1 = ATS-first**, not the full real-time AI interview platform. This means we optimize for a shippable ATS backbone first: campaign management, resume intake, AI screening, screening questions, manager review basics, audit integrity, and core transactional flows.

## Confirmed for V1

These are stable and should be treated as current V1 foundations.

- **Application state machine is the source of truth.** All `applications.status` writes go through `transition_application` with append-only `application_transitions` logging.
- **AI is evidence, not authority.** AI generates scores/rationale; rule logic decides transitions.
- **Auth model is fixed.** Recruiters use Supabase Auth; candidates use signed token links only, with no candidate accounts.
- **Campaign CRUD is in scope.** Includes AI-assisted criteria generation and rubric generation.
- **Resume intake via Gmail is the active ingestion path.**
- **Resume screening is in scope.** Persisted score factors and rationale are already surfaced in the UI.
- **Token-based screening question flow is in scope.**
- **Campaign cloning remains in scope.**
- **RLS and owner-scoped access remain foundational.**

## Decisions needed

These decisions block clean execution. Recommendation lines are included to speed up approval.

### 1. AI engine
- **Current reality:** Code uses OpenAI `gpt-4o-mini`; PRD says Claude Opus 4.5.
- **Decision needed:** Which AI engine is the product standard for V1?
- **Recommendation:** Keep the current OpenAI implementation for V1 and update stale docs now; revisit engine choice only if there is a strong product or cost reason to switch.

### 2. AI interview scope
- **Current reality:** PRD centers the product around the real-time AI interview, but no interview stack is built.
- **Decision needed:** Is V1 ATS-only, or must V1 include the real-time interview stack?
- **Recommendation:** Make V1 ATS-only. Treat AI interview as V1.5+ unless leadership explicitly wants to fund STT/TTS/WebRTC work now.

### 3. Screening response format
- **Current reality:** Screening answers are text-based; PRD requires video/audio with practice and re-record.
- **Decision needed:** Is text acceptable for V1, or must screening recordings ship now?
- **Recommendation:** Accept text responses for V1 as a temporary divergence, document it clearly, and defer recording infrastructure.

### 4. Email transport
- **Current reality:** Gmail-based sending exists; PRD leaves ESP open.
- **Decision needed:** Keep Gmail temporarily or move now to Resend/Postmark/SendGrid?
- **Recommendation:** Keep Gmail temporarily if internal usage only; switch to a real ESP before broader production rollout.

### 5. Deduplication policy
- **Current reality:** `upsertCandidate` auto-merges by email; PRD requires HR review of duplicates.
- **Decision needed:** Keep temporary auto-merge, or build duplicate-review flow now?
- **Recommendation:** Do not expand auto-merge behavior. Short term: keep it as a documented temporary shortcut. Next step after V1 backbone: replace with flagged review.

### 6. LinkedIn intake
- **Current reality:** No LinkedIn path exists.
- **Decision needed:** Browser extension, CSV import, or API-based import?
- **Recommendation:** Choose CSV/manual import first if LinkedIn intake is needed in near-term scope.

### 7. DOCX support
- **Current reality:** PDF works; DOCX does not.
- **Decision needed:** Is DOCX required for V1?
- **Recommendation:** Defer DOCX unless a real customer/user workflow is blocked by it.

### 8. Multi-reviewer collaboration
- **Current reality:** Reviewer editor exists, but writes fake `user_id`s.
- **Decision needed:** Build real reviewer invitations now, or remove/hide this UI?
- **Recommendation:** Hide or remove the fake reviewer editor until a real user model exists.

### 9. Rubric versioning behavior
- **Current reality:** Version columns exist, but scoring does not stamp rubric version.
- **Decision needed:** On rubric change, do we re-score, gate advancement, or just badge differences?
- **Recommendation:** For V1, stamp rubric version on future scores and show a badge; do not auto-rescore old candidates.

### 10. Tier naming
- **Current reality:** Code uses `moderate`; PRD uses `Potential Match`.
- **Decision needed:** Which label is canonical?
- **Recommendation:** Rename UI/output to match PRD language: `Potential Match`.

### 11. Rate limiting backend
- **Current reality:** In-memory only.
- **Decision needed:** Upgrade before deploy or accept single-instance risk?
- **Recommendation:** Accept for local/internal testing only; require Redis or equivalent before multi-instance deployment.

### 12. Audit retention
- **Current reality:** PRD expects minimum 3-year retention; no retention policy configured.
- **Decision needed:** Is this a hard near-term compliance requirement?
- **Recommendation:** Confirm legal/compliance expectations now; if not immediate, defer UI/export but not the policy decision.

## Deferred from V1

These are intentionally deferred under the ATS-first V1 assumption.

- Full AI interview stack: proctoring, recording, transcript, scheduling, scoring, persona execution, difficulty adaptation, multi-language, simulations.
- Interview replay, AI commentary, highlight reel.
- Final interview scheduling with Google Calendar.
- AI-personalized rejection emails; use plain templates first if needed.
- Interview preparation guide.
- Audit log admin UI/export.
- Calibration and drift monitoring.
- Score comparison UI and scoring methodology surface.
- Talent pool.
- Bulk actions.
- SLA enforcement jobs, auto-archiving, no-show handling, template library.
- Skill fingerprint, bias auditor, candidate-experience surveys, team fit, coaching mode, predictive analytics, AI reference check.
- Admin notifications and alerts.

## Accepted temporary divergences

These are known gaps between PRD and code that are temporarily accepted for execution speed. They should not be mistaken for final product decisions.

- Text screening answers instead of video/audio.
- OpenAI implementation instead of PRD-stated Claude.
- Gmail transport instead of a dedicated ESP.
- Auto-merge deduplication instead of HR-review deduplication.
- Incomplete audit logging on scoring paths.
- Fake reviewer editor / placeholder collaboration surface.
- PDF-only parsing instead of PDF + DOCX.

## Immediate execution priorities

Assuming the ATS-first V1 decision holds, the next implementation priorities are:

1. **Audit-log completion** for resume scoring and screening-question scoring.
2. **Baseline transactional email surface** for rejection/advance flows, even if templates are plain.
3. **Manager-review backbone** improvements, not advanced analytics.
4. **Decision cleanup**: remove/hide fake reviewer UI, align tier labels, document temporary text-answer divergence.
5. **Deployment hardening** only as needed: rate-limit backend and retention policy decisions before broader rollout.

## Owners

- **Product / scope decisions:** Manager / founder.
- **Architecture + implementation follow-through:** current engineering owner.
- **Compliance confirmation:** whoever owns legal / operations risk.
