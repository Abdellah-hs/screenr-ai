#!/usr/bin/env bash
# Bulk-create V1 issues from docs/issues/v1-issues.md.
# Run from repo root. Writes URLs to scripts/issue-urls.txt.

set -u
cd "$(git rev-parse --show-toplevel)"

OUTLOG="scripts/issue-urls.txt"
BODIES="$(mktemp -d)"
> "$OUTLOG"

create_issue() {
  local title="$1"
  local labels="$2"
  local body_file="$3"
  echo "→ $title"
  url=$(gh issue create --title "$title" --label "$labels" --body-file "$body_file" 2>&1)
  if [ $? -ne 0 ]; then
    echo "   FAILED: $url" >&2
    echo "$title || FAILED: $url" >> "$OUTLOG"
    return 1
  fi
  echo "   $url"
  echo "$title || $url" >> "$OUTLOG"
}

# ===== I15 =====
cat > "$BODIES/i15.md" <<'EOF'
**Source:** [docs/issues/v1-issues.md → I15](../blob/main/docs/issues/v1-issues.md)
**Estimate:** 1 day

## Context
The `ai_audit_log` table is missing `rubric_version` and `confidence` columns. Both are required for compliance and calibration.

## Scope
- [ ] Migration: add `rubric_version text` and `confidence numeric` to `ai_audit_log`
- [ ] Regenerate `src/types/database.types.ts`
- [ ] Update any type references

## Relevant code
- `supabase/migrations/20260330174903_candidate_pipeline_schema.sql`

## Out of scope
- Actually writing these values (I9, I10 do that)

## Testing
- Migration is idempotent or versioned correctly
- TypeScript types compile after generation

## Definition of Done
- [ ] `supabase db reset` passes
- [ ] `pnpm typecheck` passes
EOF

# ===== I9 =====
cat > "$BODIES/i9.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I9
**Estimate:** 2–3 days
**Blocked by:** I15

## Context
`scoreApplicationResume` persists the score to `applications.score_factors` but never inserts a row into `ai_audit_log`. This violates the "mandatory AI output persistence" rule in CLAUDE.md and creates compliance risk.

## Scope
- [ ] Add `rubric_version` and `confidence` columns to `ai_audit_log` (depends on I15)
- [ ] Update `saveResumeScore()` in `src/lib/data/candidates.ts` to insert an audit row
- [ ] Ensure `scoreApplicationResume` action passes `model_version`, `prompt_version`, `raw_output`, `input_snapshot`, `action_taken` to the data layer
- [ ] Backfill existing scored applications with a placeholder audit row (or document the gap)

**⚠️ Legal check required:** Confirm whether placeholder rows count as audit evidence or as a compliance gap. If placeholder rows are insufficient, backfilling must be in-scope.

## Relevant code
- `src/lib/actions/candidates.ts` — `scoreApplicationResume()`
- `src/lib/data/candidates.ts` — `saveResumeScore()`
- `src/lib/services/openai.ts` — `scoreResumeAgainstCriteria()`
- `supabase/migrations/20260330174903_candidate_pipeline_schema.sql` — `ai_audit_log`

## Out of scope
- Audit-log admin UI or export
- Backfilling with actual historical raw_output (not stored today)

## Testing
- Mock Supabase client in `src/lib/data/candidates.test.ts`; assert `from('ai_audit_log').insert()` is called with expected shape
- Mock OpenAI response; assert `raw_output` and `model_version` are captured exactly as returned
- Assert `rubric_version` is read from the campaign's active rubric at score time

## Definition of Done
- [ ] Migration runs cleanly (`supabase db reset`)
- [ ] Types regenerated (`supabase gen types typescript`)
- [ ] `pnpm test` passes
- [ ] No direct `applications` table updates outside `transitionApplication()`
EOF

# ===== I10 =====
cat > "$BODIES/i10.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I10
**Estimate:** 1–2 days
**Blocked by:** I9 (copy the pattern)

## Context
Same as I9, but for `scoreScreeningAnswers`.

## Scope
- [ ] Update screening scoring path to insert `ai_audit_log` row
- [ ] Include per-question scores snapshot and overall score
- [ ] Include `prompt_version`, `model_version`, `rubric_version`, `raw_output`

## Relevant code
- `src/lib/actions/screening-questions.ts` — `scoreScreeningAnswers()`
- `src/lib/services/screening-questions.ts` — scoring function
- `src/lib/data/candidates.ts` — screening score persistence

## Testing
- Same pattern as I9: mock Supabase, assert insert shape

## Definition of Done
- [ ] `pnpm test` passes
- [ ] Both resume and screening scoring paths now write audit rows
EOF

# ===== I13 =====
cat > "$BODIES/i13.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I13
**Estimate:** 2–3 days

## Context
Legacy values (`screening`, `screening_q`, `interview`) still exist in the DB enum and in `APPLICATION_STATE_TRANSITIONS`. They bridge into canonical states but create confusion and risk of illegal transitions.

## Scope
- [ ] Confirm mapping of legacy → canonical for existing rows:
  - `screening` → `screening_approved` (or `screening_review_pending` — confirm)
  - `screening_q` → `screening_sent`
  - `interview` → `interview_scheduled`
- [ ] Migration: re-map existing rows
- [ ] Drop legacy values from `candidate_stage_enum`
- [ ] Remove bridge entries from `APPLICATION_STATE_TRANSITIONS` in `src/lib/constants.ts`
- [ ] Update any UI strings or guards that reference legacy values

## Relevant code
- `src/lib/constants.ts` — `APPLICATION_STATE_TRANSITIONS`
- `src/lib/data/transitions.ts` — `transitionApplication()`
- `supabase/migrations/20260418000000_expand_candidate_stage_enum.sql`

## Out of scope
- Adding new failure states (I14)
- Re-scoring candidates affected by the remap

## Testing
- Add or update `constants.test.ts` to assert every canonical state has at least one valid inbound transition
- Assert no references to `screening`, `screening_q`, or `interview` as stage values in `src/`

## Blockers
- Must confirm no production rows are in an illegal intermediate state before migration runs

## Definition of Done
- [ ] `supabase db reset` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes
EOF

# ===== I18 =====
cat > "$BODIES/i18.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I18
**Estimate:** 2–3 weeks (single engineer)

## Context
D1 is resolved: V1 includes the AI interview. This is the foundational issue. No interview stack exists today.

We're stacking three layers:
1. **LiveKit** — WebRTC infrastructure (rooms, audio + video, egress recording).
2. **LiveKit Agents** — Python/Node framework that joins a room as an AI participant. Owns track subscription, audio routing, and lifecycle so we don't write that glue ourselves.
3. **OpenAI Realtime plugin** — adapter inside Agents that uses OpenAI's speech-to-speech model as the brain. No separate STT or TTS — audio in, audio out, transcript emitted as a side channel.

Video is required (proctoring + recording), which is why we're not using Vapi. The Agents framework is what compresses the estimate from 4–6 weeks (raw LiveKit + Realtime glue) to 2–3 weeks.

## Scope
- [ ] **LiveKit room + tokens:** server-side token generation, room creation, candidate join URL
- [ ] **Agent worker:** Python/Node service that joins the room as the AI participant; uses Agents framework + OpenAI Realtime plugin
- [ ] **Persona wiring:** read `campaign.interview_persona` (pressure / collaborative / socratic / neutral) and inject persona prompt into the Realtime session instructions at agent start
- [ ] **Interview session model:** `interview_sessions` table `{id, application_id, room_name, started_at, ended_at, recording_url, transcript_url, status: 'in_progress'|'completed'|'failed'}`
- [ ] **State transitions:** `interview_scheduling` → `interview_scheduled` → `interview_completed` (via `transitionApplication()`), driven by LiveKit room/session webhooks
- [ ] **Desktop-only gate:** block mobile browsers with a warning page

## Reference docs
- LiveKit Agents: https://docs.livekit.io/agents/
- OpenAI Realtime plugin: https://docs.livekit.io/agents/integrations/realtime/openai/

## Relevant code
- `src/lib/constants.ts` — `InterviewPersona`, `APPLICATION_STATE_TRANSITIONS`
- `src/lib/data/transitions.ts` — `transitionApplication()`
- `src/app/api/` — currently empty; will need route handlers for LiveKit webhooks + token mint
- `src/components/campaigns/ai-settings-fields.tsx` — persona config (already exists)

## Out of scope
- Proctoring (I22)
- Multi-language
- Skill simulations / code execution environments
- Interview replay UI (deferred: D26)

## Testing
- Mock LiveKit SDK; assert token generation includes correct room + identity
- Mock OpenAI Realtime API; assert session instructions include persona prompt
- Assert `transitionApplication('interview_completed')` is called only after session ends
- Assert mobile browser is redirected to desktop-warning page

## Definition of Done
- [ ] Recruiter can configure interview persona in campaign settings
- [ ] Candidate can join a LiveKit room from a desktop browser
- [ ] OpenAI Realtime API conducts a voice conversation
- [ ] Session start/end updates application state via `transitionApplication()`
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
EOF

# ===== I2a =====
cat > "$BODIES/i2a.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I2a
**Estimate:** 3–4 days

## Context
`upsertCandidate` in `src/lib/data/candidates.ts:41` auto-merges on email. PRD requires HR review of duplicates.

## Scope
- [ ] Add `duplicate_review_queue` table: `{id, candidate_id, matched_candidate_id, match_signals:jsonb, status: 'open'|'approved'|'rejected', reviewer_user_id, rationale, created_at}`
- [ ] Create `flagDuplicateCandidate()` data helper
- [ ] Create `resolveDuplicateFlag()` data helper (approve merge or reject/keep separate)
- [ ] Update `upsertCandidate` logic: on email/phone match, insert flag row instead of merging
- [ ] RLS: ensure only campaign owners/admins can view/resolve flags

## Relevant code
- `src/lib/data/candidates.ts` — `upsertCandidate()`
- `supabase/migrations/` — new migration for `duplicate_review_queue`

## Out of scope
- UI for the review queue (I2b)
- Similarity scoring algorithm (use exact match for V1)
- LinkedIn intake deduplication

## Testing
- Mock Supabase; assert `duplicate_review_queue.insert()` called on conflict
- Assert no `candidates.update()` merge happens when flag is inserted
- Assert `resolveDuplicateFlag('approved')` actually merges the candidates
- Assert RLS rejects unauthenticated reads

## Definition of Done
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] Migration is idempotent
EOF

# ===== I11 =====
cat > "$BODIES/i11.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I11
**Estimate:** 3–4 days

## Context
Candidates currently advance or reject with no notification. The only email template is the screening-questions invite. We need plain templates for:
- Screening approved → advance to interview scheduling
- Screening rejected → rejection with rationale placeholder
- Interview scheduled → confirmation
- Interview reminder → 24h / 1h

## Scope
- [ ] Add `services/email-templates/` files:
  - `advance-screening.ts`
  - `reject-screening.ts`
  - `interview-confirmation.ts`
  - `interview-reminder.ts`
- [ ] Wire templates into transition side effects (where `transitionApplication` triggers emails)
- [ ] Plain text first; HTML can be added later
- [ ] Include candidate name, campaign title, and next-step CTA (tokenized link where applicable)

## Relevant code
- `src/lib/services/email.ts`
- `src/lib/services/email-templates/screening-questions.ts`
- `src/lib/data/transitions.ts` — side effects on transition

## Out of scope
- AI-personalized rejection emails (deferred)
- HTML email design
- Email analytics (open/click tracking)

## Testing
- Mock `email.ts` transport; assert correct template is called with correct variables
- Mock transition side effects; assert email is queued/sent on `screening_approved` and `rejected`

## Definition of Done
- [ ] `pnpm test` passes
- [ ] Templates render without missing variable errors
- [ ] Transitions log includes `email_sent` side effect note
EOF

# ===== I14 =====
cat > "$BODIES/i14.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I14
**Estimate:** 1–2 days

## Context
`screening_expired`, `interview_no_show`, and `processing_failed` are referenced in CLAUDE.md but not in the enum. These are needed before the corresponding features land.

## Scope
- [ ] Migration: add `screening_expired`, `interview_no_show`, `processing_failed` to `candidate_stage_enum`
- [ ] Add transitions in `APPLICATION_STATE_TRANSITIONS`:
  - `screening_sent` → `screening_expired`
  - `interview_scheduled` → `interview_no_show`
  - Any state → `processing_failed` (or define legal sources)
- [ ] Regenerate types

## Relevant code
- `src/lib/constants.ts` — `APPLICATION_STATE_TRANSITIONS`
- `supabase/migrations/20260418000000_expand_candidate_stage_enum.sql`

## Out of scope
- UI or automation for triggering these transitions
- SLA enforcement jobs

## Testing
- Add test: assert `processing_failed` is reachable from at least one state
- Assert enum includes all three new values

## Definition of Done
- [ ] `supabase db reset` passes
- [ ] `pnpm typecheck` passes
- [ ] No TypeScript errors from new enum values
EOF

# ===== I19 =====
cat > "$BODIES/i19.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I19
**Estimate:** 4–5 days

## Context
After passing screening, candidates self-serve schedule against AI interview availability. `interview_scheduling` state exists but no scheduler UI or availability model. This issue is independent of the LiveKit backbone (I18) — slots can be built and tested without the interview agent existing.

## Scope
- [ ] Add `interview_slots` table: `{id, campaign_id, start_time, end_time, is_booked, booked_by_application_id, timezone}`
- [ ] Data helpers: `fetchAvailableSlots()`, `bookSlot()`, `releaseSlot()`
- [ ] Candidate-facing scheduling page: `/schedule/[token]` — calendar view, slot picker, timezone display
- [ ] On book: transition `interview_scheduling` → `interview_scheduled` via `transitionApplication()`
- [ ] Send confirmation email (template from I11)

## Relevant code
- `src/lib/constants.ts` — `APPLICATION_STATE_TRANSITIONS`
- `src/lib/data/transitions.ts`
- `src/lib/auth/screening-token.ts` — token verification pattern

## Out of scope
- Google Calendar integration (final human interview scheduling)
- Reminder emails (I11 covers templates; scheduling just triggers them)
- Manager availability UI (system-managed slots for V1)

## Testing
- Mock Supabase; assert slot is marked booked and application status transitions
- Assert double-booking is prevented (unique constraint or optimistic lock)
- Assert expired slots are filtered from candidate view

## Definition of Done
- [ ] Candidate can view available slots and book one
- [ ] Booking triggers state transition and confirmation email
- [ ] `pnpm test` passes
EOF

# ===== I20 =====
cat > "$BODIES/i20.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I20
**Estimate:** 3–4 days
**Blocked by:** I18

## Context
Every AI interview must produce a recording and transcript for compliance, scoring, and replay. LiveKit supports egress recording.

## Scope
- [ ] Configure LiveKit egress to record sessions to Supabase Storage (or S3-compatible)
- [ ] After session ends, fetch recording URL and persist to `interview_sessions.recording_url`
- [ ] Generate transcript from OpenAI Realtime API conversation history (or use LiveKit transcription)
- [ ] Persist transcript to `interview_sessions.transcript_text` (or separate `interview_transcripts` table)
- [ ] Link transcript excerpts to scores (future: I21)

## Relevant code
- `src/lib/services/` — new `livekit.ts` or extend existing
- `supabase/migrations/` — `interview_sessions` table (created in I18)

## Out of scope
- Interview replay UI (deferred: D26)
- Highlight reel generation
- AI commentary on replay

## Testing
- Mock LiveKit egress; assert recording URL is persisted after session end
- Mock transcript generation; assert transcript text is stored
- Assert transcript is linked to correct `application_id`

## Definition of Done
- [ ] Every completed interview has a recording URL
- [ ] Every completed interview has a transcript
- [ ] `pnpm test` passes
EOF

# ===== I21 =====
cat > "$BODIES/i21.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I21
**Estimate:** 3–4 days
**Blocked by:** I18, I20

## Context
After the AI interview completes, the system scores the candidate per-section and overall. This mirrors resume scoring and screening scoring.

## Scope
- [ ] Add `interview_scores` table: `{id, application_id, section_scores:jsonb, overall_score, rationale, strengths, concerns, model_version, prompt_version, rubric_version, created_at}`
- [ ] Service: `scoreInterview()` in `src/lib/services/openai.ts` — takes transcript + rubric, returns section scores + rationale
- [ ] Rule: `evaluateInterviewScoringOutcome()` in `src/lib/rules/` — reads score, decides transition (`interview_scored` → `manager_review` or `rejected`)
- [ ] Persist to `ai_audit_log` (follow I9 pattern)
- [ ] Surface score on candidate detail page

## Relevant code
- `src/lib/services/openai.ts`
- `src/lib/rules/resume-scoring.ts` — reference for rule layer pattern
- `src/lib/data/candidates.ts` — score persistence pattern
- `src/app/(dashboard)/campaigns/[id]/candidates/[candidateId]/page.tsx`

## Out of scope
- Proctoring report (I22)
- Transcript-to-score linkage UI (deferred: D26)
- Score comparison view

## Testing
- Mock OpenAI; assert prompt includes transcript excerpts and rubric
- Mock rules layer; assert `evaluateInterviewScoringOutcome()` returns correct transition for pass/fail/threshold
- Assert `ai_audit_log` insert happens

## Definition of Done
- [ ] Interview scores are persisted with section breakdown
- [ ] Rule layer decides advancement/rejection
- [ ] Score visible on candidate detail page
- [ ] `pnpm test` passes
EOF

# ===== I3 =====
cat > "$BODIES/i3.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I3
**Estimate:** 2–3 days

## Context
`evaluation_rubrics` has `version`/`is_active` columns, but no scoring path stamps the version onto a score. Managers need to know if a candidate was scored under an old rubric.

## Scope
- [ ] Update `saveResumeScore()` to persist `rubric_version` (from the campaign's active rubric)
- [ ] Update screening score persistence similarly
- [ ] Update interview score persistence similarly
- [ ] Add badge in candidate detail page when `score.rubric_version !== campaign.active_rubric_version`
- [ ] Badge copy: "Scored under rubric v2 (current: v3)"

## Relevant code
- `src/lib/data/candidates.ts` — `saveResumeScore()`
- `src/app/(dashboard)/campaigns/[id]/candidates/[candidateId]/page.tsx`
- `src/components/campaigns/` — candidate detail score card

## Out of scope
- Auto-rescore under new rubric
- Blocking advancement on rubric mismatch

## Testing
- Mock Supabase; assert `rubric_version` is written on score insert
- Assert badge renders when versions differ
- Assert no badge when versions match

## Definition of Done
- [ ] `pnpm test` passes
- [ ] Badge visible in UI when mismatch exists
EOF

# ===== I4 =====
cat > "$BODIES/i4.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I4
**Estimate:** 2–3 days

## Context
Only PDF parsing exists (`services/pdf.ts`). The action rejects DOCX uploads. PRD requires both.

## Scope
- [ ] Add `parseDocx()` service using `mammoth` (or similar)
- [ ] Wire into `syncResumesFromGmail` — accept `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- [ ] Update resume upload action to allow `.docx`
- [ ] Extracted text flows into the same `ParsedResumeData` shape as PDF

## Relevant code
- `src/lib/services/pdf.ts`
- `src/lib/services/` — new `docx.ts`
- `src/lib/actions/candidates.ts` — upload/sync actions
- `src/lib/services/gmail.ts` — mime-type filter

## Out of scope
- DOC parsing (old Word format)
- Image-based DOCX (OCR)

## Testing
- Mock `mammoth`; assert `extractRawText` returns expected string
- Assert DOCX mime-type passes Gmail sync filter
- Assert rejected file types still fail

## Definition of Done
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] DOCX file can be uploaded and parsed end-to-end
EOF

# ===== I6 =====
cat > "$BODIES/i6.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I6
**Estimate:** 1 day

## Context
Code uses `moderate` as the DB enum value. PRD requires the human-facing label to be `Potential Match`. AI rationale prompts should also use the PRD language.

## Scope
- [ ] Update `TIER_LABELS` in `src/lib/constants.ts` (or wherever labels map)
- [ ] Update candidate table tier badge
- [ ] Update candidate detail score card
- [ ] Update AI rationale prompts to say "Potential Match" instead of "moderate"
- [ ] DB enum value stays `moderate` — only labels change

## Relevant code
- `src/lib/constants.ts`
- `src/components/campaigns/candidate-table.tsx`
- `src/app/(dashboard)/campaigns/[id]/candidates/[candidateId]/page.tsx`
- `src/lib/services/openai.ts` — prompt templates

## Out of scope
- DB migration (enum stays)
- API changes

## Testing
- Search codebase for `"moderate"` (case-insensitive) outside of DB enum references; assert zero hits
- Assert UI renders "Potential Match"

## Definition of Done
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] UI shows "Potential Match"
EOF

# ===== I12a =====
cat > "$BODIES/i12a.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I12a
**Estimate:** 2–3 days

## Context
Manager review today is per-candidate only. PRD requires side-by-side compare + notes. This issue is the data layer.

## Scope
- [ ] Add `candidate_notes` table: `{id, application_id, author_user_id, note_text, created_at}`
- [ ] Add `candidate_flags` table (if not existing): `{id, application_id, reason, created_by, created_at}`
- [ ] Data helpers: `insertCandidateNote()`, `fetchCandidateNotes()`, `flagApplication()`
- [ ] Expose compare data: `fetchApplicationsForCompare(applicationIds[])` — returns scores + factors + notes

## Relevant code
- `src/lib/data/candidates.ts`
- `supabase/migrations/`

## Out of scope
- UI components (I12b)
- Bulk actions
- Talent pool action

## Testing
- Mock Supabase; assert note insert shape
- Assert compare query returns correct fields for exactly the requested IDs

## Definition of Done
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
EOF

# ===== I16 =====
cat > "$BODIES/i16.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I16
**Estimate:** 2–3 days

## Context
PRD requires mobile-friendly screening + scheduling. Current Tailwind layout is unverified on iOS/Android. The AI interview itself is desktop-only, but screening and scheduling must be mobile-friendly.

## Scope
- [ ] Audit `src/app/respond/[token]/` and `src/app/schedule/[token]/` pages on iOS Safari and Android Chrome
- [ ] Fix touch targets (min 44px)
- [ ] Fix font scaling / viewport
- [ ] Fix textarea overflow on small screens
- [ ] Add meta viewport if missing

## Relevant code
- `src/app/respond/[token]/page.tsx`
- `src/app/respond/[token]/respond-form.tsx`
- `src/app/schedule/[token]/page.tsx` (new)

## Out of scope
- Desktop interview UI (I18 handles desktop warning)
- Mobile-only desktop-warning page

## Testing
- Manual QA on physical devices or BrowserStack
- Verify token submission works on mobile

## Definition of Done
- [ ] Layout is usable down to 375px width
- [ ] No horizontal scroll
- [ ] Submit button is tappable without zoom
EOF

# ===== I22 =====
cat > "$BODIES/i22.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I22
**Estimate:** 3–4 days
**Blocked by:** I18

## Context
PRD requires proctoring: presence detection, multi-face, gaze, tab focus. For V1 MVP, implement the two highest-signal checks: tab focus and basic presence.

## Scope
- [ ] **Tab focus:** client-side JS detects `visibilitychange` + `blur`/`focus` events on the interview page. Log incidents.
- [ ] **Presence:** LiveKit video track — if no face visible for >5s, log incident.
- [ ] Add `interview_proctoring_log` table: `{id, interview_session_id, incident_type, timestamp, severity: 'warning'|'critical', details:jsonb}`
- [ ] Surface proctoring summary in interview scoring (I21)
- [ ] Do **not** auto-terminate on violation (log only for V1)

## Relevant code
- `src/app/interview/[token]/page.tsx` (new interview room page)
- `src/lib/services/livekit.ts`

## Out of scope
- Gaze tracking
- Multi-face detection
- Auto-termination policy
- Real-time recruiter alerts

## Testing
- Mock browser events; assert `interview_proctoring_log.insert()` called on tab blur
- Mock LiveKit track; assert presence incident logged when face not detected

## Definition of Done
- [ ] Tab blur events are logged
- [ ] Absence from camera is logged
- [ ] Proctoring summary is available for scoring
- [ ] `pnpm test` passes
EOF

# ===== I23 =====
cat > "$BODIES/i23.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I23
**Estimate:** 2 days

## Context
Confirmation and reminder emails must include a prep guide link. This is a web page, not a PDF.

## Scope
- [ ] Route: `/prep/[token]` — tokenized, no login required
- [ ] Content: what to expect, technical requirements (desktop, Chrome, webcam), sample topics, persona description, duration
- [ ] Pulled from campaign config (persona, interview format, duration)
- [ ] Link included in `interview-confirmation.ts` and `interview-reminder.ts` email templates

## Relevant code
- `src/lib/services/email-templates/` (I11)
- `src/app/prep/[token]/page.tsx`

## Out of scope
- Interactive practice question
- Downloadable PDF
- Video walkthrough

## Testing
- Manual QA: verify page renders with correct campaign data
- Verify token expiry behavior

## Definition of Done
- [ ] Page renders correct prep content per campaign
- [ ] Link works from confirmation email
- [ ] Mobile-friendly (Tailwind responsive)
EOF

# ===== I25 =====
cat > "$BODIES/i25.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I25
**Estimate:** 1–2 weeks

## Context
D3 resolved: browser extension is the V1 LinkedIn intake path. Recruiter clicks an extension button on a LinkedIn profile, and the candidate data is sent to Screenr.

## Scope
- [ ] Chrome extension manifest v3 scaffold (new top-level `extensions/linkedin/` or `apps/extension/`)
- [ ] Content script: extract name, headline, current role, summary, profile URL from LinkedIn profile DOM
- [ ] Background script: authenticate with Screenr (API key or recruiter token)
- [ ] Send extracted data to a new server action: `importCandidateFromLinkedIn()`
- [ ] Server action: validate, parse, insert candidate + application into DB (reuse `upsertCandidate` / `createApplication` flow)
- [ ] Show success/failure toast in extension popup

## Relevant code
- `src/lib/data/candidates.ts` — `upsertCandidate()`
- `src/lib/actions/candidates.ts` — intake actions

## Out of scope
- LinkedIn search bulk import
- Sales Navigator API
- Firefox/Safari versions
- Auto-scraping without user click

## Testing
- Unit tests for DOM parser (mock LinkedIn HTML)
- Mock server action; assert correct payload shape
- Manual QA on real LinkedIn profiles

## Definition of Done
- [ ] Extension loads in Chrome
- [ ] One-click import from a LinkedIn profile creates a candidate in Screenr
- [ ] Duplicate handling follows I2a logic
- [ ] `pnpm test` passes (server-side)
EOF

# ===== I2b =====
cat > "$BODIES/i2b.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I2b
**Estimate:** 2–3 days
**Blocked by:** I2a

## Context
HR needs a page to view flagged duplicates and accept/reject merges.

## Scope
- [ ] Route: `/admin/duplicates`
- [ ] Table: candidate A vs candidate B with match signals (email, phone)
- [ ] Actions: "Merge into A" / "Keep separate" with rationale textarea
- [ ] Call `resolveDuplicateFlag()` server action
- [ ] Toast/confirmation on resolve

## Relevant code
- `src/lib/actions/candidates.ts` — new action `resolveDuplicateFlagAction()`
- `src/lib/data/candidates.ts` — `resolveDuplicateFlag()`

## Out of scope
- Bulk resolve
- Similarity scoring visualizations

## Testing
- UI is manual QA (no component tests per policy)
- Verify via `pnpm dev` that the queue renders and actions work

## Definition of Done
- [ ] Happy path: flag → review → merge → candidate disappears from queue
- [ ] Reject path: flag → review → keep separate → flag marked rejected
- [ ] Mobile-friendly layout (Tailwind responsive)
EOF

# ===== I12b =====
cat > "$BODIES/i12b.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I12b
**Estimate:** 2–3 days
**Blocked by:** I12a

## Context
Build the UI on top of I12a.

## Scope
- [ ] Compare mode on candidate detail page: select 2 candidates, render scores side-by-side
- [ ] Notes panel: add/read notes per candidate
- [ ] Flag button with rationale textarea

## Relevant code
- `src/app/(dashboard)/campaigns/[id]/candidates/[candidateId]/page.tsx`
- `src/components/candidates/` — new `compare-panel.tsx`, `notes-panel.tsx`

## Out of scope
- Bulk actions
- Talent pool
- AI-annotated replay

## Testing
- Manual QA via `pnpm dev`
- Verify responsive layout (not full mobile, but no horizontal scroll on laptop)

## Definition of Done
- [ ] Recruiter can compare two candidates' scores
- [ ] Recruiter can add a note and see it persist after refresh
- [ ] Flag action writes to `candidate_flags` table
EOF

# ===== I5 =====
cat > "$BODIES/i5.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I5
**Estimate:** 1 day

## Context
The reviewer editor writes fake `user_id`s (`user-temp-${Date.now()}`). It should not be visible until real reviewer invites exist.

## Scope
- [ ] Add feature flag: `ENABLE_TEAM_REVIEWERS` (env var or campaign setting)
- [ ] Hide `team-reviewers-editor.tsx` when flag is false
- [ ] Default to false
- [ ] Keep the component code — do not delete

## Relevant code
- `src/components/campaigns/team-reviewers-editor.tsx`
- `src/components/campaigns/` — wherever the editor is rendered

## Testing
- Assert editor is not rendered when flag is false
- Assert editor renders when flag is true

## Definition of Done
- [ ] Default install does not show reviewer editor
- [ ] Flag can be toggled without code change
EOF

# ===== I7 =====
cat > "$BODIES/i7.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I7
**Estimate:** 0.5 day

## Context
PRD requires video/audio screening answers. Current implementation is text. I24 will close this gap by reusing LiveKit infra from I18. Document the state either way.

## Scope
- [ ] If I24 ships: update `docs/delta-prd.md` to remove text-answer divergence note
- [ ] If I24 slips: add section to `docs/delta-prd.md` under "Accepted temporary divergences" explaining text is temporary

## Relevant code
- `docs/delta-prd.md`

## Definition of Done
- [ ] `docs/delta-prd.md` accurately reflects whether screening is text or video in V1
EOF

# ===== I24 =====
cat > "$BODIES/i24.md" <<'EOF'
**Source:** docs/issues/v1-issues.md → I24
**Estimate:** 3–4 days
**Blocked by:** I18

## Context
PRD 3.4.3 requires video/audio screening answers with practice question + re-record. Current implementation is text. Since I18 builds LiveKit + OpenAI Realtime, we can reuse that infra for screening recordings.

## Scope
- [ ] Reuse LiveKit room for short screening recordings (1–2 min per question)
- [ ] Add practice question before scored questions
- [ ] Allow re-record before final submission
- [ ] Transcribe responses (reuse OpenAI STT or Realtime API)
- [ ] Store recording + transcript alongside answers
- [ ] Update `submitScreeningAnswers` to accept recording URLs + transcripts

## Relevant code
- `src/app/respond/[token]/respond-form.tsx`
- `src/lib/services/livekit.ts` (from I18)
- `src/lib/actions/screening-questions.ts`

## Out of scope
- Realtime AI conversation during screening (just record + transcribe)
- Screening scoring changes (I10 covers scoring)

## Testing
- Mock LiveKit; assert recording URL is persisted
- Assert transcript is generated and stored
- Assert re-record replaces previous attempt before final submit

## Definition of Done
- [ ] Candidate can record video answers to screening questions
- [ ] Practice question works
- [ ] Re-record works
- [ ] Transcript is stored and linked to score
EOF

# ===== Create issues in dependency order =====

# 1. Schema / data foundations
create_issue "schema(audit): add rubric_version and confidence to ai_audit_log (I15)" \
  "priority/critical,tech-debt,data-layer" \
  "$BODIES/i15.md"

# 2. Critical compliance + state machine
create_issue "fix(audit): write ai_audit_log row on every resume score (I9)" \
  "priority/critical,tech-debt,compliance,data-layer" \
  "$BODIES/i9.md"

create_issue "fix(audit): write ai_audit_log row on every screening-answer score (I10)" \
  "priority/critical,tech-debt,compliance,data-layer" \
  "$BODIES/i10.md"

create_issue "refactor(state-machine): migrate legacy candidate_stage_enum values to canonical names (I13)" \
  "priority/critical,tech-debt,state-machine" \
  "$BODIES/i13.md"

# 3. AI interview backbone
create_issue "feat(ai-interview): build real-time interview backbone (LiveKit Agents + OpenAI Realtime plugin) (I18)" \
  "priority/critical,enhancement,ai-interview" \
  "$BODIES/i18.md"

# 4. High priority — parallel
create_issue "feat(dedup): flag duplicate candidates for HR review instead of auto-merge (I2a)" \
  "priority/high,enhancement,data-layer" \
  "$BODIES/i2a.md"

create_issue "feat(email): baseline transactional email surface for advance/reject flows (I11)" \
  "priority/high,enhancement" \
  "$BODIES/i11.md"

create_issue "schema(state-machine): add explicit failure states to candidate_stage_enum (I14)" \
  "priority/high,tech-debt,state-machine" \
  "$BODIES/i14.md"

# 5. AI interview pipeline (high)
create_issue "feat(scheduling): interview self-scheduling against system availability (I19)" \
  "priority/high,enhancement,ai-interview" \
  "$BODIES/i19.md"

create_issue "feat(recording): interview recording + transcript persistence (I20)" \
  "priority/high,enhancement,ai-interview,compliance" \
  "$BODIES/i20.md"

create_issue "feat(scoring): interview scoring per-section + overall (I21)" \
  "priority/high,enhancement,ai-interview" \
  "$BODIES/i21.md"

# 6. Medium priority
create_issue "feat(scoring): stamp rubric version on score writes and show mismatch badge (I3)" \
  "priority/medium,enhancement,ui" \
  "$BODIES/i3.md"

create_issue "feat(parser): add DOCX support to resume parser (I4)" \
  "priority/medium,enhancement" \
  "$BODIES/i4.md"

create_issue "chore(copy): rename moderate tier label to Potential Match in UI and prompts (I6)" \
  "priority/medium,enhancement,ui" \
  "$BODIES/i6.md"

create_issue "feat(review): manager review backbone — compare schema and notes data layer (I12a)" \
  "priority/medium,enhancement,data-layer" \
  "$BODIES/i12a.md"

create_issue "fix(ui): mobile pass on candidate-facing pages (I16)" \
  "priority/medium,tech-debt,ui" \
  "$BODIES/i16.md"

create_issue "feat(proctoring): basic interview proctoring (tab focus + presence) (I22)" \
  "priority/medium,enhancement,ai-interview" \
  "$BODIES/i22.md"

create_issue "feat(content): interview prep guide page (I23)" \
  "priority/medium,enhancement,ai-interview" \
  "$BODIES/i23.md"

create_issue "feat(linkedin): browser extension for one-click candidate intake (I25)" \
  "priority/medium,enhancement" \
  "$BODIES/i25.md"

# 7. Blocked by earlier high-prio
create_issue "feat(ui): HR duplicate review queue page (I2b)" \
  "priority/high,enhancement,ui" \
  "$BODIES/i2b.md"

create_issue "feat(ui): manager review backbone — side-by-side compare + notes panel (I12b)" \
  "priority/medium,enhancement,ui" \
  "$BODIES/i12b.md"

# 8. Low priority
create_issue "chore(flags): hide team-reviewers-editor behind a feature flag (I5)" \
  "priority/low,tech-debt,ui" \
  "$BODIES/i5.md"

create_issue "docs: document text-screening divergence as accepted temporary gap (I7)" \
  "priority/low,accepted-divergence" \
  "$BODIES/i7.md"

create_issue "feat(intake): add video/audio recording to screening questions (share LiveKit infra) (I24)" \
  "priority/low,enhancement,accepted-divergence" \
  "$BODIES/i24.md"

echo ""
echo "===== DONE ====="
echo "URLs written to: $OUTLOG"
wc -l "$OUTLOG"
