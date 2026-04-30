# Ubiquitous Language — Screenr AI

The shared vocabulary for this project. Every term below has **one** canonical meaning across docs, code, schemas, and UI copy. Drifted vocabulary is how subtle bugs ship — for example, code that conflates `Candidate` with `Application` will mis-attribute scores or stages because the same person can score differently for different roles.

When a new domain term appears in conversation, a PRD, or code, add or update its entry here. If two terms turn out to mean the same thing, pick one and migrate the other out — don't leave them as synonyms.

## Core entities

### Candidate

A person. Stable across campaigns. Holds identity data only — first name, last name, email, phone, links (LinkedIn, portfolio).

**A candidate has no pipeline state, scores, or status of their own.** A candidate exists once even if they apply to ten campaigns.

DB table: `candidates`

### Application

A `Candidate` applying to one `Campaign`. **All pipeline state, stage timestamps, scores, disposition, and transitions belong to the Application, not the Candidate.** One Candidate → many Applications.

DB table: `applications`

> **Common mistake:** treating "candidate" and "application" as the same thing in UI labels (the candidate detail page is really an *application* detail page) or in scoring code. The score is on the Application, because the same person can score differently for different roles.

### Campaign

A hiring process for one role. Owns screening criteria, rubrics, automation mode (`fully_auto` / `human_in_loop`), threshold, and reviewers.

DB table: `campaigns`

## State machine

### Application State (`status`)

The Application's position in the pipeline. One of a fixed enum (see `candidate_stage_enum` in the DB and `ApplicationState` in `src/lib/constants.ts`). Authoritative for the application's pipeline state. Examples: `new`, `screening_review_pending`, `screening_approved`, `interview_scored`, `hired`, `rejected`.

The legacy `CandidateStage` UI type (`applied | screening | interview | offer | hired | rejected`) is a coarser display projection of `ApplicationState` and is being migrated out.

### Transition

A move from one Application state to another. **The only legal way to change `applications.status`.** Performed by `transitionApplication()` in `src/lib/data/transitions.ts`, which validates legality, records actor + rationale, and writes to the append-only `application_transitions` log atomically.

### Actor

Who initiated a transition. One of:
- `system` — automated rule-driven (e.g. resume scoring above threshold)
- `ai` — currently unused; reserved for direct AI-attributed transitions if we ever allow them
- `recruiter` — manual human action. **Recruiter actors must supply a written rationale.**

### Rationale

A short written justification recorded on a transition, especially required for recruiter overrides. Stored on the transition row, not the application. Min 10 chars on the HITL approve/reject path.

### Disposition

A structured `{ code, description }` recorded on every terminal transition (`rejected`, `withdrawn`, `archived`). Codes include `LOW_SCORE`, `FAILED_INTERVIEW`, `NO_SHOW`, `WITHDRAWN`, `EXPIRED`, `OVERRIDE_REJECTED`.

## Scoring

### Score

A 0–100 number produced by the AI for one stage of the pipeline. Stages produce **independent** scores — there is no composite master score. A `Resume Score`, `Screening Score`, and `Interview Score` are distinct values for the same Application.

### Tier

A coarse classification of a score. Currently three values (`strong`, `moderate`, `weak`). Per [docs/delta-prd.md](delta-prd.md) decision #10, the canonical UI label for `moderate` is `Potential Match`; the code value is unchanged.

### Score Factor

A named contribution to a score, with a weight and a sub-score. Persisted on the Application as `score_factors` JSON. Surfaces in the candidate detail page under the AI summary.

### Rubric

A configured set of `Score Factors` for one stage of one campaign. Versioned (`version`, `is_active`). Per delta-PRD #9, future scores stamp the rubric version they were produced under; old scores are not auto-rescored on rubric change.

## Automation

### Automation Mode

A campaign-level setting. Two values:
- `fully_auto` — AI score directly drives the next transition (auto-approve / auto-reject against the threshold).
- `human_in_loop` (HITL) — AI scores, then parks the application at `screening_review_pending`. A recruiter must approve or reject before it advances.

### HITL (Human-in-the-Loop)

Shorthand for the `human_in_loop` automation mode. Used in code (`decideHitlReview`) and UI ("Pending review" pill / panel).

### Pending review

UI label for an Application currently in `screening_review_pending`. Distinct from `Applied` (which corresponds to status `new`). Pending review only appears on HITL campaigns or on stuck rows from a campaign that used to be HITL.

### Threshold

The numeric score boundary configured per campaign that decides auto-pass vs auto-reject under `fully_auto`. Score `>= threshold` is a pass; below is a reject. Boundary is inclusive on the pass side.

## Audit & evidence

### Audit Trail

Two append-only logs that together answer "what did the system do, and why":
- `ai_audit_log` — every AI call's input snapshot, raw output, model version, prompt version.
- `application_transitions` — every state-machine move, with actor and rationale.

Both are append-only — never updated, never deleted.

### Evidence

The output of an AI call (score, rationale, factors, classification). **Evidence is not a decision.** The rules layer reads evidence and decides whether to transition. AI never transitions. See "Control > AI > Data" in CLAUDE.md → ATS State Machine Rules.

## Process / workflow

### Vertical slice

A feature that cuts through every layer end-to-end (UI → action → rules → data → DB), however thin. The opposite is horizontal slicing (build all of layer A, then all of layer B). Vertical slices ship value at every commit. See CLAUDE.md → Working Principles.

### Server Action

A Next.js Server Action — the entry point for any UI mutation or scoped read. Lives in `src/lib/actions/`. Handles auth guard, Zod validation, rate-limit, then delegates to rules / data / services. Never bypassed by the UI.

### Rules layer

Pure decision functions in `src/lib/rules/`. Reads already-validated evidence, returns a `TransitionDescriptor` or guard. Cannot import from the data layer or services. The "decisioner" half of "AI is evidence, rules decide".

### Data layer

Supabase query/mutation functions in `src/lib/data/`. No auth checks (that's the action's job), no AI, no business decisions. Just typed reads and writes. Functions ending in `Tx` perform multi-table writes that should be treated as a logical transaction.

### Token-based candidate access

Candidates have **no accounts**. They access the system via signed tokens in URLs (e.g. `/respond/[token]`). Token verification lives in `src/lib/auth/screening-token.ts`. Recruiters use Supabase Auth; candidates never do.
