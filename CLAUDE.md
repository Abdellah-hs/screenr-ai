# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Screenr AI is an internal ATS (Applicant Tracking System) and AI-powered interview platform built for MatiousCorp. It automates the hiring pipeline from resume collection through AI interviews to final scheduling.

## Commands

```bash
pnpm dev          # Start dev server (port 3000)
pnpm build        # Production build
pnpm start        # Start production server
pnpm lint         # Run ESLint
pnpm typecheck    # Run TypeScript type check (no emit)
pnpm test         # Run Vitest once (CI mode)
pnpm test:watch   # Run Vitest in watch mode (local dev)
```

Package manager is **pnpm**. Test framework is **Vitest**.

## Tech Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5**
- **Supabase** for database (PostgreSQL), auth, and file storage (`@supabase/ssr`, `@supabase/supabase-js`)
- **Tailwind CSS 4** with `@tailwindcss/postcss`
- **React Compiler** enabled via `babel-plugin-react-compiler`
- **Zod 4** (`zod/v4`) for input validation, **OpenAI** for AI generation/scoring, **pdf-parse** for resume parsing, **googleapis** for Gmail integration
- Node.js >=18.18.0

## Architecture

### Routing

Next.js App Router with a `(dashboard)` route group for authenticated pages:

- `/` → redirects to `/campaigns`
- `/campaigns` — campaign list
- `/campaigns/new` — create campaign
- `/campaigns/[id]` — campaign detail
- `/campaigns/[id]/edit` — edit campaign
- `/campaigns/[id]/candidates/[candidateId]` — candidate detail
- `/login`, `/signup` — auth pages
- `/auth/callback` — Supabase auth callback

### Layered Architecture

A strict layered pattern is enforced for all data flow. Respect the boundaries — UI never touches Supabase directly, and data-layer / rules-layer code never calls services or AI.

1. **Server Actions** (`src/lib/actions/`) — entry point for mutations and reads from React. Accepts `FormData` or typed args, performs `auth.getUser()` guard (or `requireUserId()` from `src/lib/auth/guards.ts`), validates with Zod (`src/lib/validations.ts`), enforces rate limits (`src/lib/rate-limit.ts`), then delegates to rules / data / services. Ends with `redirect()` or `revalidatePath()`.
2. **Rules Layer** (`src/lib/rules/`) — **pure** decision functions. Reads already-validated evidence (e.g. an AI score, a response status, a list of required questions vs answers) and returns a decision — usually a `TransitionDescriptor` `{ toState, rationale }` or a guard that throws on bad state. The action executes the transition; the rule only decides. **MUST NOT** import from `@/lib/supabase/*`, `@/lib/actions/*`, or call `revalidatePath` / `redirect`. See `src/lib/rules/README.md` for the full contract. This is the layer that implements "Control > AI > Data" — AI produces evidence, rules decide.
3. **Data Layer** (`src/lib/data/`) — pure Supabase query/mutation functions (e.g. `insertCampaignTx`, `fetchCandidatesByCampaignId`, `transitionApplication`). No auth checks, no validation — that is the action's job. Functions ending in `Tx` perform multi-table writes that should be treated as a logical transaction. **All `applications.status` writes go through `transitionApplication()` in `src/lib/data/transitions.ts`** — never `.update({ status: ... })` directly.
4. **Services** (`src/lib/services/`) — third-party integrations: `openai.ts` (resume extraction, screening criteria/rubric generation, scoring), `gmail.ts` (inbox sync for resume ingestion), `pdf.ts` (PDF text extraction via `pdf-parse`), `email.ts`, `screening-questions.ts`, `email-templates/`.

Auto-generated Supabase types live in `src/types/database.types.ts`. The `src/app/api/` directory exists but is currently empty — there are **no API routes**; everything goes through Server Actions.

### Supabase Clients

- Server: `src/lib/supabase/server.ts` — uses `cookies()` from `next/headers`. Use this in Server Components and Server Actions.
- Browser: `src/lib/supabase/client.ts` — for client components.

### Auth & Route Protection

Supabase Auth via middleware (`src/middleware.ts`). Route protection **is enforced**: unauthenticated users hitting `/campaigns/*` are redirected to `/login`, and authenticated users on `/login` or `/signup` are redirected to `/campaigns`. Every Server Action additionally re-checks the session and validates UUIDs with `uuidSchema` before doing any work — keep this pattern when adding new actions. Use `requireUserId()` from `src/lib/auth/guards.ts` as the canonical guard helper (it wraps `supabase.auth.getUser()` and throws `Unauthorized` on no session).

Candidate-facing pages (`/respond/[token]`) are token-based, not session-based — see PRD-Critical Product Rules. Token verification lives in `src/lib/auth/screening-token.ts` and is called from public actions in `src/lib/actions/respond.ts`.

### Domain Types & Constants

All domain types (Campaign, Candidate, etc.), enums, status configs, and pipeline definitions are in `src/lib/constants.ts`. This is the single source of truth for:

- `CampaignStatus`, `AutomationMode`, `InterviewPersona`, `ReviewerRole`
- `CandidateStage`, `ScreeningTier`
- Status transition rules (`STATUS_TRANSITIONS`)
- Pipeline stage definitions (`resume`, `screening_q`, `interview`)

When adding a new enum value, update both `constants.ts` **and** the matching Zod enum in `src/lib/validations.ts`, otherwise form submissions will reject the new value.

### Components

- `src/components/ui/` — reusable primitives (Button, Card, Input, Modal, Select, Textarea, Badge) exported via `index.ts`
- `src/components/campaigns/` — campaign-specific components (rubric editor, screening criteria editor, SLA timers, team reviewers, candidate table, AI settings)
- `src/components/candidates/` — candidate action client components (Gmail sync button, score-resume button, stage changer)
- `src/components/Navbar.tsx`, `src/components/Sidebar.tsx` — layout chrome inside the `(dashboard)` route group

### Styling

- Tailwind CSS 4 utilities with custom CSS variables in `src/app/globals.css`
- `cn()` helper in `src/lib/utils.ts` (clsx + tailwind-merge) for conditional classes
- Custom component classes (`.btn-primary`, `.card`, `.input`, `.modal-overlay`) defined in globals.css

### Path Alias

`@/*` maps to `./src/*` (configured in tsconfig.json).

## ATS State Machine Rules (STRICT)

**Core principle: Control > AI > Data.** This ATS is a controlled state machine. AI is analysis only — it produces scores, classifications, and rationale, but it NEVER mutates application state. All decisions are made by explicit rules.

### Entities

- **Candidate** — a person. Stable across campaigns. Holds identity data only (name, email, phone, links).
- **Campaign** — a hiring process for one role.
- **Application** — a candidate applying to a campaign. **ALL pipeline state, stage timestamps, scores, disposition, and transitions belong to the Application, not the Candidate.** One candidate → many applications.

### Canonical Application States

An application is always in exactly ONE of these states. No other values are allowed:

```
new
→ resume_parsed
→ resume_scored
→ screening_review_pending     (human-in-the-loop only)
→ screening_approved | screening_rejected
→ screening_sent
→ screening_completed
→ screening_scored
→ interview_scheduling
→ interview_scheduled
→ interview_completed
→ interview_scored
→ reference_check              (optional)
→ manager_review
→ final_interview_scheduling
→ hired | rejected | withdrawn | archived
```

Explicit failure states (never silent): `screening_expired`, `interview_no_show`, `processing_failed`, `archived`.

### Transition Rules (NON-NEGOTIABLE)

**NEVER** write `application.status = X` or `.update({ status: X })` directly.

**ALWAYS** go through a single `transition(applicationId, toState, actor, rationale?)` function that:

1. Validates the transition is legal from the current state (e.g., `hired` requires current = `manager_review`).
2. Appends a row to the transitions log: `{application_id, from_state, to_state, timestamp, actor: system|ai|recruiter, rationale}`.
3. Applies side effects (emails, scheduling, timestamps).
4. Enforces constraints (SLA, required data existence).
5. Updates `entered_at` for the new state so SLA logic is observable.

### AI Usage Rules

AI **may**:
- Score (resume, screening, interview)
- Classify (Strong Match / Potential / Weak / No Match)
- Extract structured data from resumes or responses
- Generate written rationale

AI **must never**:
- Change application state
- Trigger a transition directly
- Be treated as the source of truth

Pattern: AI produces score + rationale → persisted as evidence → rule layer reads score → rule layer calls `transition()`. Keep scoring and decisioning as **separate functions**.

### Mandatory AI Output Persistence

For every AI call, persist: `raw_output`, `normalized_fields`, `model_version`, `prompt_version`, `rubric_version`, `confidence` (if available), `rationale`. AI output is evidence, not truth.

### Decision Layer

All advancement decisions are rule-driven. Example:

```
IF resume_score >= threshold AND automation_mode = fully_auto:
  transition(app, 'screening_approved', actor='system', rationale='score>=threshold')
ELSE IF automation_mode = hitl:
  transition(app, 'screening_review_pending', actor='system', rationale='awaiting review')
ELSE:
  transition(app, 'screening_rejected', actor='system', rationale='score<threshold', disposition='LOW_SCORE')
```

### Disposition Codes

Every terminal transition (`rejected`, `withdrawn`, `archived`) requires a structured disposition `{ code, description }`. Allowed codes include: `LOW_SCORE`, `FAILED_INTERVIEW`, `NO_SHOW`, `WITHDRAWN`, `EXPIRED`, `OVERRIDE_REJECTED`.

### Manual Override Rules

Any recruiter action that contradicts an AI recommendation must:
- Record the original AI decision alongside the manager's action.
- Require a **written rationale** (not optional).
- Be logged via the same `transition()` function with `actor='recruiter'`.

### Talent Pool

Separate concept from applications. Stores `{candidate_id, historical_scores, notes, tags}`. Old scores are historical context only — new campaigns generate fresh evaluations.

### Anti-Patterns (FORBIDDEN)

- Direct `.update({ status: ... })` outside `transition()`
- Using AI output as the final decision without an explicit rule branch
- Merging Candidate and Application concepts
- Overwriting historical AI outputs or rubrics (append/version instead)
- Non-versioned AI prompts or rubrics
- Silent failures — every error path ends in an explicit failure state

### Current Compliance Status

Open violations to migrate:
- Legacy states (`screening`, `screening_q`, `interview`) still exist in `candidate_stage_enum` and in `APPLICATION_STATE_TRANSITIONS`. They currently bridge into the canonical track — a future migration should re-map existing rows onto canonical names and drop the legacy values.
- Screening questions are implemented as text Q&A; PRD 3.4.3 requires video/audio recordings — see PRD-Critical Product Rules below.
- `upsertCandidate` auto-merges on email; PRD requires flagging duplicates for HR review instead.
- Interview scheduling, AI reference check, and final interview scheduling are not yet implemented as first-class stages — see PRD-Critical Product Rules.
- Failure states (`screening_expired`, `interview_no_show`, `processing_failed`) from CLAUDE.md's state diagram are not yet in the enum. Add once the corresponding features exist.

Completed:
- `updateApplicationStage` and `advanceApplicationStatus` now delegate to `transitionApplication()` in `src/lib/data/transitions.ts` — no direct `status` writes remain.
- `application_transitions` append-only log + atomic `transition_application` RPC added in `supabase/migrations/20260417000000_application_transitions_log.sql`.
- Resume scoring and decisioning are split: `scoreApplicationResume()` produces evidence only; `evaluateResumeScoringOutcome()` lives in `src/lib/rules/resume-scoring.ts` and decides the transition.
- Screening-response guards (`assertResponseIsOpen`, `assertResponseNotResubmitted`, `validateRequiredAnswersPresent`) extracted into `src/lib/rules/screening-response.ts`. `src/lib/actions/respond.ts` is now a thin orchestrator that delegates to the rules layer.
- `src/lib/rules/` decision layer scaffolded with its own contract (see `src/lib/rules/README.md`). New decision logic should land here, not in actions.
- `candidate_stage_enum` expanded with the canonical set (`screening_review_pending`, `screening_approved`, `screening_sent`, `screening_completed`, `screening_scored`, `interview_scheduling`, `interview_scheduled`, `interview_completed`, `interview_scored`, `reference_check`, `final_interview_scheduling`, `archived`) in `supabase/migrations/20260418000000_expand_candidate_stage_enum.sql`. `APPLICATION_STATE_TRANSITIONS` in `src/lib/constants.ts` updated in lockstep.
- HITL branch of `evaluateResumeScoringOutcome` now transitions to `screening_review_pending` (from `new`) instead of silently staying in `new`. Auto-mode uses `screening_approved`. `fetchApplicationsReadyForScreeningSend` accepts both the legacy `screening_q` and canonical `screening_approved` states.
- Screening lifecycle is wired into the application state machine: sending questions transitions to `screening_sent` (in `sendScreeningQuestionsToCandidate` / `sendScreeningQuestionsBulk`), candidate submission transitions to `screening_completed` (in `submitScreeningAnswers`), and AI scoring transitions to `screening_scored` via `evaluateScreeningScoringOutcome` (in `scoreScreeningAnswers`). All three are best-effort — the side effect (email / answer save / score persist) commits first, then the transition runs and is logged on failure so a transient RPC error can't ghost an email or lose a candidate's submission.
- `evaluateScreeningScoringOutcome` now branches on automation mode + threshold, parallel to `evaluateResumeScoringOutcome`. It returns a chain of transitions: HITL rests at `screening_scored`; `fully_auto` chains `screening_scored → interview_scheduling` on a pass and `screening_scored → rejected` on a fail (boundary inclusive). The action loops the chain and stops on the first transition error so it can't try an illegal step from a stuck source state.

When touching any code that changes application state, migrate it toward these rules rather than extending the old pattern.

## PRD-Critical Product Rules

Non-negotiable product behaviors from `docs/prd.md`. Do not assume a feature is out of scope just because the code doesn't implement it yet — missing implementation is migration work, not permission to drop the requirement.

### Screening Questions (PRD 3.4.3)

- Candidate responses are **video/audio recordings**, not text answers. The current text-form implementation is a legacy shortcut.
- The flow includes a **practice question** before scored questions.
- Candidates may re-record before final submission.
- AI transcribes responses; per-question scores and the overall screening score must be traceable to transcript excerpts — persist the transcript alongside the score.

### Independent Stage Scores

Each stage (resume, screening answers, interview) produces its own score. There is no composite master score. Managers inspect stage-specific evidence independently — do not build UIs that hide stage scores behind a rollup.

### AI Interview

- Target is a real-time conversational interview on a **desktop-only** client.
- Configurable formats: system design, technical Q&A, behavioral, code reading.
- Output must include transcript, recording, per-section scores, overall score, strengths/concerns, and proctoring report.

### Interview Scheduling

- After passing screening questions, candidates self-serve schedule against system-managed AI interview availability.
- Confirmation + reminder emails include the prep guide (web page, not PDF).

### Final Interview Scheduling

Manager review is not the final step. After manager review, the system schedules a human final interview via calendar integration. Treat this as a first-class stage, not a manual follow-up.

### Reference Checks

Optional stage between interview scoring and manager review. Optional but first-class in architecture — do not bolt on later.

### Candidate-Facing Constraints

- Candidate pages are **token-based**, never account-based. There are no candidate logins.
- Screening forms and scheduling pages must be mobile-friendly.
- The AI interview itself is desktop-only.
- Rejection flows must not expose internal ranking or comparative scores.

### Deduplication

Duplicate candidates across channels (email, phone, strong profile similarity) must be **flagged for HR review**, not auto-merged. The current `upsertCandidate` auto-merge-on-email behavior is an implementation shortcut, not the final policy.

## Git Conventions & Workflow

### Branching

Branch off `main` with descriptive names:

```
feature/campaign-creation
fix/screening-score-display
chore/update-deps
```

Keep branches small and focused — one feature or fix per branch. All PRs merge into `main`.

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add campaign creation form
fix: resolve screening score calculation for edge case
docs: update API documentation for interview endpoints
chore: upgrade supabase-js to v2.x
refactor: extract scoring logic into shared utility
```

### Pull Requests

- Write a clear description: what changed, why, and how to test
- Link to the relevant issue or task
- Request a review before merging

### Code Quality

- TypeScript strict mode — no `any` types unless absolutely unavoidable
- Comments only when the "why" isn't obvious from the code

### Supabase Commands

```bash
supabase start                    # Start local Supabase (requires Docker)
supabase db reset                 # Reset local database and run all migrations
supabase migration new <name>     # Create a new migration file
supabase gen types typescript     # Generate TypeScript types from database schema
```

## Testing

Screenr AI uses **Vitest** as the single test runner. The testing policy is simple and strict: **every new function, service, or data-layer helper ships with tests in the same PR**. A PR that adds logic without tests should be sent back for revision.

### Philosophy

Tests are a contract between the author and the future. They encode what a piece of code is *supposed* to do, so that refactors, upgrades, and teammates cannot silently break it. We write tests for three reasons, in order of importance:

1. **To prevent regressions** — the #1 reason. When a test fails, something that used to work stopped working.
2. **To document behavior** — a well-named test reads like a spec: `it("rejects campaigns with empty titles")`.
3. **To design better APIs** — code that is hard to test is usually hard to use. If you can't test it without 50 lines of setup, the function is doing too much.

### What to test (by layer)

The three-layer architecture maps cleanly onto three test styles:

| Layer | File location | What to test | Mocking |
| --- | --- | --- | --- |
| **Pure logic** (`src/lib/validations.ts`, `src/lib/constants.ts`, `src/lib/utils.ts`) | `*.test.ts` next to the file | Every branch: valid input, invalid input, edge cases (empty, null, too long) | None — these are pure functions |
| **Services** (`src/lib/services/*.ts`) | `*.test.ts` next to the file | The transformation your code applies *around* the external call (prompt construction, response parsing, error handling) | Mock the external SDK (OpenAI, googleapis, pdf-parse) |
| **Data layer** (`src/lib/data/*.ts`) | `*.test.ts` next to the file | That the right Supabase query is built and that results are shaped correctly | Mock the Supabase client chain (`from().select().eq()...`) |
| **Server Actions** (`src/lib/actions/*.ts`) | `*.test.ts` next to the file | Auth guard rejects anonymous users; Zod validation rejects bad input; the right data-layer / service functions are called | Mock `createClient`, the data layer, and services |

**We do not unit-test React components or pages.** UI correctness is verified manually via `pnpm dev`. If we later need component tests, we add `@testing-library/react` then — not preemptively.

### How to name and structure tests

- File naming: `foo.ts` → `foo.test.ts` in the same directory. Co-located, not in a top-level `__tests__` folder.
- Test naming: `describe("functionName", () => { it("does X when Y", ...) })`. The `it` reads as a sentence — if you can't phrase it that way, the test is testing too much.
- Structure each test as **Arrange → Act → Assert** (AAA). Three visual blocks separated by blank lines. No "cleverness."
- **One assertion concept per test.** Multiple `expect()` calls are fine *if they verify the same concept*. If you find yourself testing two unrelated things, split the test.

### Running tests

```bash
pnpm test         # run once, exit with status code (used by CI)
pnpm test:watch   # re-run on file change (local dev loop)
pnpm test src/lib/validations.test.ts   # run a single file
```

### Writing tests that don't lie

A few rules we learned the hard way:

1. **Never test the mock.** If your "test" only verifies that `mockFunction.mockReturnValue(42)` returned `42`, you're testing Vitest, not your code. The test must exercise the real function under test.
2. **Never test implementation details.** Test the *output* of a function, not whether it called a specific private helper. Implementation details change; contracts shouldn't.
3. **Never write a test that always passes.** If a test still passes after you delete the function body, the test is worthless. Run it against broken code once to prove it fails.
4. **Never use `any` in tests.** The rest of the codebase is strict TypeScript; tests are not an exception. Typed tests catch mistakes the runtime would miss.

### CI

Tests run automatically on every push and PR via GitHub Actions (`.github/workflows/ci.yml`). The CI pipeline runs `lint → typecheck → test → build` in order. A failing step blocks the PR from merging.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL      # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Supabase anonymous key
OPENAI_API_KEY                # OpenAI API key for AI generation (resume extraction, screening criteria, rubrics, scoring)
```

Gmail sync (`src/lib/services/gmail.ts`) uses the `googleapis` SDK; OAuth credentials are loaded per-campaign from the database, not from env.

## Notes for Future Work

- **Rate limiting** (`src/lib/rate-limit.ts`) is in-memory and per-process. Any move to multi-instance deployment must replace it with Redis (or similar).
- **Migrations** in `supabase/migrations/` are timestamped. After editing schema, run `supabase gen types typescript` to refresh `src/types/database.types.ts` so the data layer stays type-safe.

## Documentation

- [Product Requirements (PRD)](docs/prd.md)
- [Intern Onboarding Guide](docs/onboarding.md)
- [Design System Master](design-system/screenr-ai/MASTER.md)
