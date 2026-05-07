# Issue seed list — revised after decisions on 2026-04-30

A draft of issues to bulk-create. Skim it, strike anything wrong, then I bulk-create.

## What changed

You decided 9 of 12 A-items. The seed is reorganized into:
- **Resolved decisions** — no issue, just recorded for the audit trail.
- **Decisions still open** — kept as `decision` issues.
- **Implementation work** — spawned by the resolved decisions + B/C items.
- **Deferred** — D1–D12 stay deferred until A2 is decided.

---

## Resolved decisions (no separate issue — record in the relevant docs / commits)

| | Decision |
|---|---|
| A1 | AI engine = **OpenAI `gpt-4o-mini`**. No code change. PRD/onboarding need updating. |
| A3 | Screening response format = **video/audio recordings**. Decided but parked behind recording infra. Text stays as accepted divergence in the meantime. |
| A5 | Deduplication = **build the HR review queue** (replace `upsertCandidate` auto-merge). |
| A6 | Rubric versioning = **stamp version on future scores; badge differences; no auto-rescore**. |
| A8 | **DOCX required.** Add to resume parser. |
| A9 | `team-reviewers-editor` = **hide for now** behind a feature flag. |
| A11 | Tier label = **Potential Match** (rename `moderate` in UI/output). |
| A12 | Audit retention = **3 years**. Confirm legal stance separately, defer export UI. |

---

## Decisions still open — `decision` label

### D1. A2 — V1 scope: include AI interview stack?
Labels: `decision`, `priority/high`
Parked. The realtime interview stack (LiveKit + STT + TTS + proctoring + scoring) is a multi-month commitment. Spawn implementation issues only after this is resolved.

### D2. A4 — Email transport
Labels: `decision`
Recruiter-Gmail OAuth (current) vs ESP (Resend / Postmark / SendGrid). Discuss later.

### D3. A7 — LinkedIn intake mechanism
Labels: `decision`
Browser extension / CSV / API. Discuss later.

### D4. A10 — Rate-limit backend (Redis vs in-memory)
Labels: `decision`
In-memory works for single instance. Required: Redis (or equivalent) before any multi-instance deploy. Decide before deploy planning.

---

## Implementation issues — `priority/high` or `enhancement`

### Spawned by resolved decisions

#### I1. Update PRD + onboarding to reflect OpenAI as the V1 AI engine
Labels: `priority/high`, `enhancement`
Source: A1. Replace "Claude Opus 4.5" references in `docs/prd.md` and `docs/onboarding.md` with "OpenAI gpt-4o-mini". Remove the apparent contradiction between docs and code.

#### I2. Build HR duplicate-review queue (replace `upsertCandidate` auto-merge)
Labels: `priority/high`, `enhancement`
Source: A5. New flow: when an inbound resume matches an existing candidate by email/phone/strong-similarity, flag the duplicate for HR review instead of silently merging. UI: a review queue + accept/reject merge with rationale.

#### I3. Stamp rubric version on score writes + show mismatch badge
Labels: `enhancement`
Source: A6. When `saveResumeScore` (and screening-score equivalent) writes, persist the active `rubric_version`. Surface a small badge in the candidate detail page when a candidate's score was produced under a different rubric version than the campaign currently has active.

#### I4. Add DOCX support to resume parser
Labels: `enhancement`
Source: A8. Today `parsePdf` is the only path; the action rejects everything else. Add `parseDocx` (e.g. via `mammoth`), wire it into `syncResumesFromGmail` mime-type filter (allow `application/vnd.openxmlformats-officedocument.wordprocessingml.document`).

#### I5. Hide team-reviewers-editor behind a feature flag
Labels: `tech-debt`
Source: A9. The editor writes fake `user_id`s. Hide via feature flag (env var or campaign setting) until a real reviewer-invite flow exists. Don't delete — keep the code so it can be brought back when reviewer auth lands.

#### I6. Rename `moderate` → `Potential Match` in UI / output strings
Labels: `enhancement`
Source: A11. Code value (`moderate`) stays in the DB enum and types — only the human-facing label changes. Touches `TIER_LABELS`, candidate table tier badge, candidate detail score card, AI rationale prompts.

#### I7. Track A3 (video/audio screening) as accepted divergence with implementation issue
Labels: `accepted-divergence`, `tech-debt`
Source: A3 + the parking note. Document in delta-PRD that text answers are a temporary substitute. Sub-issue when recording infra is the next priority — depends on A2 resolution if interview stack is shared infra.

#### I8. Confirm 3-year audit retention with legal / compliance
Labels: `decision`
Source: A12. Soft action: get a written confirmation before designing the export UI. No code work in this issue.

### From immediate execution priorities (delta-PRD)

#### I9. Complete audit-log writes on resume scoring path
Labels: `priority/high`, `tech-debt`
`scoreApplicationResume` writes the score onto the application but does not insert a row into `ai_audit_log` per call. Add: `model_version`, `prompt_version`, `rubric_version`, `confidence`, `raw_output`, `input_snapshot`, `action_taken`.

#### I10. Complete audit-log writes on screening-question scoring path
Labels: `priority/high`, `tech-debt`
Same as I9 for `scoreScreeningAnswers`.

#### I11. Baseline transactional email surface (advance / reject)
Labels: `priority/high`, `enhancement`
Plain templates. Triggered from terminal and screening-advance transitions. Avoids candidates being "approved" or "rejected" with no notification.

#### I12. Manager-review backbone — side-by-side compare + notes
Labels: `priority/high`, `enhancement`
Just the basics on the candidate detail page. Compare two candidates' scores + a notes panel. Not analytics, not bulk actions.

### Tech debt / state-machine migrations

#### I13. Migrate legacy `candidate_stage_enum` values out
Labels: `tech-debt`
Re-map existing rows from `screening` / `screening_q` / `interview` to canonical names; drop legacy from enum; drop bridge entries from `APPLICATION_STATE_TRANSITIONS`.

#### I14. Add explicit failure states to `candidate_stage_enum`
Labels: `tech-debt`
`screening_expired`, `interview_no_show`, `processing_failed` are referenced in CLAUDE.md but not in the enum. Add when the corresponding features land.

#### I15. Persist `rubric_version` and `confidence` on `ai_audit_log` rows
Labels: `tech-debt`
Schema is missing both. Adds compliance + calibration value. Aligns with I3 + I9.

#### I16. Mobile pass on candidate-facing pages (`/respond/[token]` etc.)
Labels: `tech-debt`, `enhancement`
PRD requires mobile-friendly screening + scheduling. iOS Safari + Android Chrome QA pass + fixes.

### Process

#### I17. Adopt issue templates + working-principles workflow
Labels: `priority/high`, `enhancement`
Once `chore/github-issue-templates` and `docs/working-principles` merge, all new feature work starts as a `feature` issue and gets grilled before code.

---

## Deferred V1+ — `deferred-v1` (parked until A2 resolves)

D1–D12 from the previous draft stay deferred. Don't create issues for them yet — they only become V1 work if A2 = "include AI interview stack". When A2 is decided, I'll either (a) create them as V1 implementation issues if A2 = yes, or (b) leave them deferred indefinitely if A2 = no.

---

## Total to create: ~21 issues + ~9 labels

**Labels (create first):**
`decision`, `priority/high`, `tech-debt`, `accepted-divergence`, `deferred-v1`, `qa`, `human-only` (existing: `bug`, `enhancement`)

**Issues:**
- 4 `decision` issues (D1–D4)
- 17 implementation issues (I1–I17)

---

## What I need from you

1. Skim the implementation list (I1–I17). Strike anything you don't want as an issue.
2. Confirm: commit + push templates branch, create labels, create the ~21 issues.

If anything in "Resolved decisions" was wrong, say so before I create — those are getting recorded into commit messages and won't be re-discussed.
