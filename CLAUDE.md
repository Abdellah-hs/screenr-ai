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
5. **Orchestration / Pipelines** (`src/lib/resume-ingest/`, `src/lib/screening/`, `src/lib/scheduling/`) — multi-step **use-cases** that compose the lower layers (services → data → rules → `transition()`) into one reusable flow. They exist because a flow like resume ingest may be driven from **more than one entry point** (today the public apply action; a session-less caller like a cron sweep could reuse it tomorrow), so it can't live inside any single action. A pipeline runs on an **injected `db` client** (`SupabaseDb`) so it works with or without a recruiter session (service-role for cron). **MUST NOT** perform auth, Zod validation, or rate-limiting — those stay in the action that calls it (a cron route does its own `CRON_SECRET` guard). It **MUST** still route every `applications.status` change through `transition()` and keep AI advisory (score → rule decides → transition). Think of it as an "action body" lifted out so several callers can share it. The canonical example is `ingestResumeDocument` (extract → classify → upload → upsert → score → rule → advance).

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

- Tailwind CSS 4 utilities, tokens declared in the `@theme` block of `src/app/globals.css`
- `cn()` helper in `src/lib/utils.ts` (clsx + tailwind-merge) for conditional classes
- Custom component classes (`.btn-primary`, `.card`, `.input`, `.ai-rail`, `.modal-overlay`) defined in globals.css

**The AI advises in indigo. A person decides in ink.** Machine output and human
authority never dress alike, and colour encodes *consequence*, not prominence.
Four families, one job each — using one for another's job is a bug, not taste:

| Token | Hex | Its only job |
| --- | --- | --- |
| `ink` | `#111827` | A person is about to change someone's state. The highest-contrast object on screen. |
| `ai` | `#4F46E5` | An AI produced what follows — a 3px rail or a caption. **Never a fill, never a button.** |
| `primary` | `#2563EB` | Blue. Links, focus, navigation, affordances. **It is never an action.** |
| `cta` | `#10B981` | Emerald. A positive **terminal** outcome only — hired, approved, submitted. Not "advance". |

Plus `tier-*` (one AI verdict on one stage, never summed) and the stage badge
palette. `Button` variants encode the same distinction: `primary` is ink,
`success` is emerald, `danger` is outlined rather than filled, and "generate with
AI" is `secondary` because it is a helper, not a commitment.

Attribution is a primitive, not a convention: `AiRail` / `AiCaption` /
`AiEyebrow` in `src/components/ui/ai-attribution.tsx`. **Wrap the whole score,
not just its header** — a score and its "why" are one object, and nobody should
read a 61 without seeing that a model wrote it and that it moved nobody.

Three rules that exist because breaking them caused real problems:

1. **Fields are solid white.** `bg-white/70 backdrop-blur-md` samples whatever
   is behind it, so the contrast of the text being typed depends on the page
   underneath — including on the candidate apply form. One definition,
   `FIELD_BASE` in `src/components/ui/field.ts`, kept identical to `.input`.
2. **Hover changes colour, never position.** No `hover:-translate-y-*`: a card
   that rises shifts everything below it on a scrolling list, and a button that
   lifts moves out from under the cursor. `transition-colors duration-150`;
   `transition-all` only where a box genuinely changes geometry (the proctoring
   overlay is the sole case).
3. **No sparkle icons on AI features**, no emoji as icons, no gradient
   decoration, no glassmorphism. Heroicons outline, inline SVG.

`design-system/screenr-ai/MASTER.md` holds the long form — but note that
`design-system/` is **gitignored**, so it is a local aid only and this section is
the version that travels. If the two disagree, **this file wins** (as it does
over everything in `docs/`), and the code wins over both.

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
→ interview_invited            (on-demand AI interview — PRD 3.5.6)
→ interview_completed
→ interview_scored
→ reference_check              (optional)
→ manager_review
→ final_interview_scheduling
→ hired | rejected | archived
```

`interview_scheduling` / `interview_scheduled` are **deprecated** (the AI interview is on-demand, not slot-scheduled — see "AI Interview Invitation (On-Demand)"). They remain in the enum until a cleanup migration retires them; new flows use `interview_invited`.

Explicit failure states (never silent): `screening_expired`, `interview_expired`, `interview_no_show`, `processing_failed`, `archived`.

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

#### Interview scoring is not a gate (decision 2026-08-18)

`evaluateInterviewScoringOutcome` always records `interview_scored` first, then follows `automation_mode`:

- `human_in_loop` → `[interview_scored]` (rests; the recruiter advances it)
- `fully_auto` → `[interview_scored, manager_review]`

**The interview score never gates and never auto-rejects**, at any threshold. Two reasons, both deliberate:

1. `manager_review` is not an outcome — it is the handoff point where a person takes ownership. Advancing into it is exactly what "the AI took this as far as it can without a human" means, which is safe in a way auto-rejecting after a full interview would not be.
2. The PRD wants managers inspecting stage-specific evidence rather than a rollup gate. Rejecting someone who sat a whole interview on the strength of one number is the decision most worth keeping human.

Before this, the rule returned `interview_scored` unconditionally and **nothing in the codebase ever moved an application into `manager_review`** — every earlier stage auto-advanced on a rule and this one silently stopped, so a `fully_auto` campaign parked scored interviews forever, contradicting the mode the recruiter chose.

Both post-interview waiting states (`interview_scored` under HITL, `manager_review` under either mode) are surfaced in the notification bell by `fetchAwaitingDecisionNotifications`, so a finished interview cannot sit unseen in either mode. **The candidate is sent nothing between submitting their interview and the final outcome** — the submit confirmation is the acknowledgement, and the next contact is the decision. Adding a "we're reviewing" email is deliberately left to the email-templates work (#134 / #147) rather than bolted on here.

### Disposition Codes

Every terminal transition (`rejected`, `archived`) requires a structured disposition `{ code, description }`. Allowed codes include: `LOW_SCORE`, `FAILED_INTERVIEW`, `NO_SHOW`, `EXPIRED`, `OVERRIDE_REJECTED`.

### Manual Override Rules

Any recruiter action that contradicts an AI recommendation must:
- Record the original AI decision alongside the manager's action.
- Require a **written rationale** (not optional).
- Be logged via the same `transition()` function with `actor='recruiter'`.

### Talent Pool

Separate concept from applications. Old scores are historical context only — new campaigns generate fresh evaluations.

There are **two lists**, and conflating them is the mistake #141 fixed:

- **The directory** (`fetchTalentPoolRows` → `getTalentPool`) — everyone who ever applied to one of the recruiter's campaigns, assembled automatically. Lives at `/candidates?view=all`. A person stays here even after their only campaign is soft-removed, with the removal flagged rather than hiding them.
- **The curated pool** (`talent_pool_entries` → `getCuratedTalentPool`) — the PRD 3.11 silver medalists: an **opt-in** set a recruiter deliberately marked, carrying `tags text[]` and a free-text `notes`. Lives at `/candidates`. One row per `(added_by, candidate_id)`, owner-scoped RLS on `added_by`, with the INSERT policy additionally requiring the candidate be visible to that recruiter. `source_application_id` / `source_campaign_id` record where the decision was made and are `ON DELETE SET NULL` — **the pool must outlive the campaign that filled it**.

Entry points are the candidate detail page (`TalentPoolButton`, available at any stage) and an opt-in checkbox on the manager's reject modal, which is unchecked by default — pre-ticking it would refill the pool with everyone rejected, i.e. the directory again. The pool add is deliberately **non-fatal and runs after** the rejection transition: the rejection is recorded state, the pool entry is a bookmark.

Search (PRD 3.11.2) is a pure function, `filterTalentPool` in `src/lib/talent-pool/search.ts` — free text over name/email/headline/skills/tags/notes, tags ANDed, original campaign, added-date window, and a `bestScore` range. `bestScore` is the highest number a person reached at **any** stage of **any** application; it is a search axis over history, **not** a composite score and never a decision input. An unscored person is excluded the moment any score bound is set (including a max-only one) — "never scored" is not a low score.

### Anti-Patterns (FORBIDDEN)

- Direct `.update({ status: ... })` outside `transition()`
- Using AI output as the final decision without an explicit rule branch
- Merging Candidate and Application concepts
- Overwriting historical AI outputs or rubrics (append/version instead)
- Non-versioned AI prompts or rubrics
- Silent failures — every error path ends in an explicit failure state

## PRD-Critical Product Rules

Non-negotiable product behaviors from `docs/prd.md`. Do not assume a feature is out of scope just because the code doesn't implement it yet — missing implementation is migration work, not permission to drop the requirement.

### Screening Questions (PRD 3.4.3)

- Candidate responses are **spoken**, captured as a live voice call and stored as a server-side transcript. **The text form was retired in #161** — there is no typed-answer path left, and no env flag re-enables one. Video responses remain an accepted divergence (#48); audio is what ships.
- The flow includes a **practice question** before scored questions.
- Candidates may re-record before final submission.
- AI transcribes responses; per-question scores and the overall screening score must be traceable to transcript excerpts — persist the transcript alongside the score.

### Independent Stage Scores

Each stage (resume, screening answers, interview) produces its own score. There is no composite master score. Managers inspect stage-specific evidence independently — do not build UIs that hide stage scores behind a rollup.

### AI Interview

- Target is a real-time conversational interview on a **desktop-only** client.
- Configurable formats: system design, technical Q&A, behavioral, code reading.
- Output must include transcript, per-section scores, overall score, strengths/concerns, and proctoring report.
- **Decision 2026-08-04:** the interview is **not recorded**. This retires PRD 3.5.5 and supersedes the earlier "recording" output requirement — do not rebuild it. The camera is live-only: the agent worker samples frames in memory for proctoring and discards them, so no interview video is ever written to storage. The durable record is the transcript + score + proctoring report. The cost is explicit: a proctoring finding can't be checked against footage, which is why the detection rules are biased toward missing incidents and the report carries a fallibility note.

### AI Interview Invitation (On-Demand)

- **Decision 2026-06-23:** the AI interview is **on-demand, not slot-scheduled**. The AI interviewer is available 24/7, so there is no calendar to coordinate against. After passing screening, the candidate is *invited* via a token link with a deadline (like screening links) and starts the interview whenever ready — no booking. Capacity/cost is a **concurrency cap** on realtime sessions, not candidate-facing slots. Reminders + prep guide (web page, not PDF) go out as the deadline approaches.
- This **supersedes** the earlier "self-serve schedule against AI interview availability" design (PRD 3.5.6). The slot-booking infrastructure (`interview_availability_rules`, `interview_bookings`, `/schedule/[token]`) is **repointed to the final human interview** below, where coordinating a real person's calendar genuinely needs it.

### Final Interview Scheduling

Manager review is not the final step. After manager review, the system schedules a human final interview via calendar integration — this is where candidate-facing **slot booking** lives (it inherits the availability/booking machinery originally built for the AI interview). Treat this as a first-class stage, not a manual follow-up.

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
feature/issue-<n>-<slug>
fix/issue-<n>-<slug>
chore/<slug>
docs/<slug>
refactor/<slug>
```

Keep branches small and focused — one feature or fix per branch. All PRs merge into `main`.

### Branch Hygiene (non-negotiable)

1. **One issue = one branch = one PR.** Use the naming patterns above so the branch name carries the issue number.
2. **`main` is the only long-lived branch.** Every other branch is short-lived (days, not weeks).
3. **Never commit on `main` directly.** Always `git checkout -b <new-branch>` first.
4. **Sync before branching:** `git checkout main && git pull` before creating a new branch.
5. **Delete the branch the moment its PR merges** — locally (`git branch -d <name>`) and on GitHub (the "Delete branch" button on the merged PR page).
6. **`git status` and `git branch` should be boring.** If `git branch` shows >5 local feature branches, run a cleanup pass: prune merged ones with `git branch -d`, and for orphans archive their tip as a tag (`git tag archive/<name> <name>`) before force-deleting.
7. **No subagent worktrees left behind.** After any subagent run, check `git worktree list` and remove any leftover `.claude/worktrees/agent-*` entries with `git worktree remove --force <path>`.
8. **Recovery is always possible** via archive tags: `git checkout -b <name> archive/<name>` restores an archived branch.

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
| **Services** (`src/lib/services/*.ts`) | `*.test.ts` next to the file | The transformation your code applies *around* the external call (prompt construction, response parsing, error handling) | Mock the external SDK / `fetch` (OpenAI, googleapis, Datalab Marker) |
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

## Development Workflow

Screenr AI is built using a structured **day shift / night shift** model. The human drives alignment and architecture; Claude Code drives implementation.

### Day Shift: Alignment and Planning

The human leads planning before any code is written.

1. **Grill me session** — Intensive Q&A to align on feature scope, constraints, and edge cases.
2. **PRD** — Synthesize alignment into `docs/prd.md` or feature-specific PRDs.
3. **Vertical slices** — Break work into GitHub issues that are **vertical slices** (tracer bullets): thin end-to-end features that touch all layers (schema → data → rules → UI). Never assign horizontal slices (e.g., "write all migrations" or "build all UI").
4. **Kanban with blocking relationships** — Issues must declare `Blocked by` dependencies. Agents only pick up unblocked issues.

### Night Shift: Autonomous Implementation

Claude Code implements issues with minimal human intervention.

- **TDD is mandatory** — Write failing tests first, then implementation, then refactor. This is the only reliable feedback loop when coding autonomously.
- **Deep modules** — The codebase is split into deep modules (rules, data, services) with simple interfaces and rich internals. Respect the interface; implement the internals.
- **One feature = one branch** — Each vertical slice gets its own `feature/issue-XX-description` branch off `main`.
- **Quality gates before push** — `pnpm typecheck && pnpm test` must pass. No exceptions.

### QA: Human Taste Loop

After an agent pushes a branch, the human performs manual QA. Do not automate QA — this is where human taste and edge-case discovery happen. New findings become fresh issues on the board while the AI continues working in the background.

**Bug or refactor found during QA?**

1. **Document it** — File a new issue (or comment on the existing one) describing exactly what's wrong, with steps to reproduce.
2. **Move the card back** — The issue returns to "Ready" or "In Progress" on the Kanban board.
3. **Agent fixes it** — New commits are pushed to the same feature branch. `pnpm typecheck && pnpm test` must still pass.
4. **Re-QA** — Human verifies the fix before merging.
5. **Merge only when green** — No merging branches with known QA failures.

Refactors discovered during QA get their own issue so they don't block shipping the feature.

### Prerequisites for AFK Mode

Background agents require **Bash to be auto-approved** in Claude Code settings. Without this, agents cannot run `git`, `pnpm`, or tests and will stall.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL      # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Supabase anonymous key
OPENAI_API_KEY                # OpenAI API key for AI generation (resume extraction, screening criteria, rubrics, scoring)
DATALAB_API_KEY               # Datalab Marker API key for layout-aware resume text extraction (PDF + DOCX). Sign up at https://www.datalab.to
GOOGLE_CLIENT_ID              # Google OAuth client ID (the app identity — same for all recruiters)
GOOGLE_CLIENT_SECRET          # Google OAuth client secret
SUPABASE_SERVICE_ROLE_KEY     # Service-role key for session-less server writes (admin client) — NEVER exposed to the browser
CRON_SECRET                   # Shared secret guarding the scheduled-job endpoints (e.g. screening expiry sweep)
LIVEKIT_URL                   # LiveKit Cloud project URL (wss://...) — voice-screening rooms
LIVEKIT_API_KEY               # LiveKit API key (room creation + join-token minting)
LIVEKIT_API_SECRET            # LiveKit API secret — NEVER exposed to the browser
AGENT_API_SECRET              # Shared secret the agent worker presents to /api/agent/* routes (transcript + proctoring reporting)
LINKEDIN_CLIENT_ID            # LinkedIn OAuth app client id — social publishing ("Share on LinkedIn")
LINKEDIN_CLIENT_SECRET        # LinkedIn OAuth app client secret — NEVER exposed to the browser
NEXT_PUBLIC_ENABLE_TEAM_REVIEWERS  # Feature flag, default OFF — see Feature Flags below
```

### Feature Flags

`src/lib/flags.ts`. Two rules hold for every flag:

1. **Default off.** Unset, empty, or anything other than the exact string `"true"` reads as false. A flag exists to hide something that isn't ready, so a mistyped value must land on the safe state.
2. **The flag holds on the server too.** Hiding a form section only removes its inputs — the Server Action behind it must refuse the work as well, or the flag hides a mess instead of preventing one.

The `NEXT_PUBLIC_` prefix is required because flags are read inside Client Components as well as Server Actions. Next inlines them at **build** time, so flipping one takes a redeploy, not just a restart.

| Flag | Default | What it gates |
| --- | --- | --- |
| `NEXT_PUBLIC_ENABLE_TEAM_REVIEWERS` | off | The team-reviewers editor on `/campaigns/new`, and the reviewer rows `createCampaign` writes. The editor mints placeholder identities (`user-temp-<timestamp>`) for people with no account, and `campaign_reviewers` is referenced by no RLS policy (#132) — so the rows grant nothing while reading as though they do. Stays off until reviewer invites create real accounts and #132 settles what a reviewer may do. |

Social publishing (`src/lib/services/linkedin.ts`) lets a recruiter publish a "we're hiring" post to their own LinkedIn feed from a campaign's **Share on social** panel. It mirrors the Gmail integration: the OAuth **app** credentials (`LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`) live in env; the per-recruiter **access token** is obtained via consent (Settings → Integrations → Connect LinkedIn) and stored in the `social_connections` table (one row per `user_id` + `provider`, owner-only RLS, read server-side only). Connect/callback route handlers live in `src/app/api/integrations/linkedin/{connect,callback}/route.ts`; publishing goes through `publishLinkedInPost` (`src/lib/actions/social-publish.ts`). **Setup:** create a LinkedIn app, request the *Sign In with LinkedIn using OpenID Connect* + *Share on LinkedIn* products (approval required), set the two env vars, and register the redirect URL `<origin>/api/integrations/linkedin/callback`. Until then the Connect flow fails closed and nothing else breaks. AI **only drafts** the post copy; the recruiter reviews/edits and clicks Publish — the app never posts on its own. LinkedIn access tokens are long-lived (~60 days) and are not silently refreshed; an expired token surfaces as "Reconnect needed."

The voice screening runs on **LiveKit**: after token verification, the server opens a per-attempt room and mints the candidate's join grant (`src/lib/services/livekit.ts`); a standalone agent worker (`agents/screening/` — its own package with its own `pnpm install` / `pnpm dev`, deployable to LiveKit Cloud) is dispatched into the room, runs the OpenAI Realtime conversation (instructions come from room metadata, set server-side), and reports the transcript to `POST /api/agent/screening/transcript` (guarded by `AGENT_API_SECRET`, admin-client write, draft-only while the response is `sent`). The candidate's browser never supplies transcript content — its submit sends only the token and the server finalizes from the agent-reported draft. The worker must be running (see `agents/screening/README.md`) or candidates join a silent room.

**The AI interview is not recorded.** LiveKit Egress, the `interview-recordings` bucket, `interview_sessions.recording_url` and the `SUPABASE_S3_*` env vars were all removed on 2026-08-04 (migration `20260804140000_drop_interview_recordings.sql`). The candidate's camera exists only as a live track: the agent worker samples frames in memory for proctoring and discards them. **Do not reintroduce recording** without revisiting the decision recorded in "AI Interview" above — the absence of stored video is a deliberate privacy posture, not missing work.

**Proctoring (Phases C + C2)** — `src/lib/proctoring/`. Runs on **both** candidate-facing live stages, but they can carry different evidence:

- **Voice screening** (`/respond/[token]`) — browser tab-focus only; there is no camera at this stage. Worth having because screening is where a candidate has the most reason to game (the question is asked before the answer is given, and "hold on a second" costs nothing), but it is the *self-reported* half with nothing to corroborate it: a candidate who edits their submit payload produces a clean report. Treat a clean screening report as weak evidence. Stored on `screening_question_responses.proctoring`.
- **AI video interview** (`/interview/[token]`) — browser signals *plus* server-side camera vision, which the candidate's machine cannot forge. Stored on `interview_sessions.proctoring`.

Both stages run the same `summarizeProctoring` rules and render through one shared component (`src/components/candidates/proctoring-report.tsx`), so a report reads identically wherever it came from and the fallibility wording can't drift between stages.

Interview evidence comes from two independent streams, and the distinction is load-bearing:

- **Browser signals (Phase C)** — **tab focus** (`visibilitychange` + window `blur`/`focus`) and **camera presence** (LiveKit local video track muted / unpublished). Only the browser can see these, so the trust boundary is drawn carefully: the client (`collector.ts`) buffers raw open/close intervals and flushes them **once, on submit**, reporting only *what happened and for how long*. It never asserts severity. `collector.ts` is typed against `ProctoringEventType`, which deliberately excludes the vision types — a candidate's browser cannot post (or suppress) a camera finding.
- **Camera vision (Phase C2)** — the interview agent worker (`agents/interview/src/vision.ts`) samples a frame from the candidate's published video track, runs a **local YOLOX-tiny detector** over it (`agents/interview/src/detector.ts` + `postprocess.ts`, weights committed under `agents/interview/models/`, Apache-2.0), and reports `{at, person_count, confidence, phone_count}` to `POST /api/agent/interview/proctoring` (guarded by `AGENT_API_SECRET`, admin-client write, draft-only while the session is open). Detection is in-process: frames are scored in memory and discarded, so no image is stored or sent to a third party. This is **server-side** evidence the candidate's machine cannot forge. It is kept strictly **out of the Realtime interviewer session** — feeding frames to the interviewer would make it react to what it sees mid-call, turning monitoring into a live accusation delivered by the interviewer. The interviewer remains audio-only.
- **Live overlay (decision 2026-08-04)** — detection boxes are ALSO published to the candidate's own browser over the LiveKit data channel (topic `proctoring.boxes`) and drawn on their self-view. This knowingly gives up the "don't tip them off" property: the candidate sees what was detected and when, and can time around it. It does **not** affect the record — boxes flow worker → browser only, the reporting route accepts no incident types from a browser, and the report is assembled server-side from the worker's readings. Turn it off with `VISION_OVERLAY=0` on the worker. The overlay runs a faster cadence (`VISION_OVERLAY_INTERVAL_MS`, default 1s) than the report (`VISION_SAMPLE_INTERVAL_MS`, default 10s); the two are deliberately separate knobs so overlay smoothness can never change what a stored report means or blow the 500-observation schema bound. Overlay geometry (`object-fit: cover` crop + mirrored preview) lives in `src/lib/proctoring/overlay.ts`, pure and tested.

Both streams report raw readings only; `summarizeProctoring` (`incidents.ts`, pure + versioned via `PROCTORING_REPORT_VERSION`, now `proctoring-v3`) owns all judgement — it drops sub-threshold noise, run-length-encodes vision samples into durations **per condition** (a frame can be both `multiple_people` and `phone_visible`, so runs are tracked independently), and classifies what survives as `warning` / `critical`, tagging each incident with its `source` (`client` | `vision`). Vision incident types are `person_absent` / `multiple_people` / `phone_visible`. The report lands on `interview_sessions.proctoring`; raw vision samples live on `interview_sessions.proctoring_observations` until submit folds them in.

Vision inference is deliberately **biased toward missing incidents rather than inventing them**, because wrongly accusing a real candidate is the expensive failure — and with no recording, nobody can check a finding against footage. Samples below `VISION_MIN_CONFIDENCE` are discarded rather than believed, a single stray frame spans zero time and can never clear a threshold, `multiple_people` and `phone_visible` each need three consecutive sightings, box-area floors reject a person on a poster or a background monitor, and a gap over `VISION_MAX_SAMPLE_GAP_MS` breaks a run so a stalled worker can't read as a minute of absence. `confidence` is **frame usability** (luminance + contrast, capped by the weakest counted box) rather than a model's self-report — a detector cannot say "I couldn't see", and without this an unlit room would read as an abandoned one. Phone detection uses COCO `cell phone` + `remote` (detectors routinely label a held phone as a remote); `laptop` / `tv` / `book` are deliberately excluded because a second screen is normal on a desktop-only interview.

**Evidence snapshots (decision 2026-08-04)** — when a frame is flagged, the worker encodes *that one frame* as a small annotated JPEG (`agents/interview/src/snapshot.ts`) and posts it to `POST /api/agent/interview/snapshot`; the app uploads it to the private `proctoring-snapshots` bucket (owner-scoped RLS keyed on the campaign id in the first path segment, same convention as `resumes`) and keeps only the object **key** on `interview_sessions.proctoring_snapshots`, resolved to a short-lived signed URL at read time. This deliberately reintroduces stored candidate images — but narrowly, and it is what makes a camera finding checkable now that there is no recording. The guardrails are load-bearing: only flagged frames are encoded (a clean interview stores nothing), one still per condition per `VISION_SNAPSHOT_INTERVAL_MS` (default 30s), and at submit `attachSnapshots` attaches the earliest still inside each **confirmed** incident and **deletes every other key** — so the frames behind the detector's own false positives are precisely the ones thrown away. The route accepts no severity or incident type, like every other agent report. `VISION_SNAPSHOTS=0` disables capture.

Proctoring is **observational only**: it never terminates an interview, never transitions an application, and is never fed into the interview score — the recruiter reads it as independent evidence beside the score, with camera findings labelled and carrying an explicit fallibility note in the UI. It is also best-effort: a malformed browser payload is logged and discarded *without* dropping the worker's vision evidence (otherwise a candidate could erase the one signal they don't control), and the interview still completes. Absent proctoring is rendered distinctly from a clean run, and `summary.vision_sampled` distinguishes "watched and clean" from "never watched". Gaze direction and identity matching remain out of scope; the report shape accommodates them without a schema change.

Gmail integration (`src/lib/services/gmail.ts`) uses the `googleapis` SDK and is now **outbound-only** — it sends candidate emails (screening/interview links) from the recruiter's connected inbox. (Inbound CV sync was retired; candidates submit CVs exclusively through the public apply page `/apply/<slug>`.) The OAuth **app** credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) live in env; the per-recruiter **refresh token** is obtained via the consent flow and stored in the `gmail_connections` table (one row per `user_id`). A recruiter connects/changes their inbox under **Settings → Integrations**, which drives the OAuth round-trip through the route handlers in `src/app/api/integrations/gmail/{connect,callback}/route.ts`. Outbound sends (`src/lib/actions/gmail-sender.ts`) read the stored token (server-side only) to build the Gmail client. The refresh token is a secret: protected by owner-only RLS, never returned to the browser; encryption-at-rest (pgcrypto / Supabase Vault) is a future hardening step. **Setup:** in the Google Cloud OAuth client, register the redirect URI `<origin>/api/integrations/gmail/callback` (e.g. `http://localhost:3000/...`) and allow the `gmail.modify` scope (a superset of `gmail.send`).

Resume text extraction (`src/lib/services/marker.ts`) uses the hosted Datalab Marker API for all document types — it replaced the legacy `pdf-parse` (PDF) and `mammoth` (DOCX) extractors. The OpenAI resume parser classifies each document (`document_type`: `cv` | `motivation_letter` | `other`); only CVs are ingested.

### Scheduled Jobs (Cron)

Screening links carry a 7-day deadline (`RESPONSE_TTL_MS`). Expiry is detected two ways: **lazily** when the candidate reopens a dead link (`startCandidateVoiceScreening`), and **proactively** by a scheduled sweep so the pipeline reflects reality even for candidates who never return. The sweep (`sweepExpiredScreenings` in `src/lib/screening/expiry-sweep.ts`) finds every `screening_sent` response past its `expires_at` and moves the application to `screening_expired` via the system transition (admin client — it runs without a recruiter session).

The **AI interview** works the same way (`INTERVIEW_TOKEN_TTL_MS`, also 7 days), with one extra wrinkle: the deadline lives *inside* the token, so a lapsed link used to throw on verification before anything could record that it had lapsed — an invited no-show sat in `interview_invited` forever. `peekResponseToken` (`src/lib/auth/screening-token.ts`) authenticates a token **without** enforcing its deadline, so the expiry paths can recover which application a dead link belongs to. It checks the HMAC exactly as `verifyResponseToken` does; only the deadline is relaxed, and callers must treat `expired: true` as "close this out", never as access.

The interview sweep (`sweepExpiredInterviews` in `src/lib/interview/expiry-sweep.ts`) selects open sessions past `expires_at`, then lets the pure rule `isInterviewAbandoned` (`src/lib/rules/interview-expiry.ts`) decide which have truly lapsed. **A session that is `in_progress` is not swept until the call could no longer be running** (`INTERVIEW_DURATION_MINUTES + ABANDONED_GRACE_MINUTES`) — otherwise a candidate whose 7-day deadline falls mid-answer would have their live interview and transcript destroyed by the sweep.

Both are exposed as guarded GET routes, `Authorization: Bearer ${CRON_SECRET}` (failing closed if the secret is unset):

- **`GET /api/cron/expire-screenings`**
- **`GET /api/cron/expire-interviews`**

**Final-interview reminders** are the one scheduled job that is *not* an expiry sweep. `sweepInterviewReminders` (`src/lib/scheduling/reminder-sweep.ts`, route `GET /api/cron/interview-reminders`) sends the 24h / 1h nudges ahead of a booked final human interview, driving the `interview-reminder` template that had sat unwired since #31. Three properties are load-bearing:

- **The rule decides, the sweep executes.** `dueInterviewReminders` (`src/lib/rules/interview-reminders.ts`) is pure and answers "what is owed *right now*", so the sweep stays correct at any cadence. At most one email per pass: when a gap leaves both unsent, the nearest lead is sent and the stale one is **retired unsent** rather than delivered late.
- **Claim before send.** The `reminder_24h_sent_at` / `reminder_1h_sent_at` stamps on `interview_bookings` are written by a conditional `UPDATE … WHERE col IS NULL`, so two overlapping runs cannot both win. A failed send hands the claim back so the next run retries. A **reschedule clears both stamps** (in `updateBooking`) — a new time is a new thing to be reminded about.
- **Remindable is an allowlist.** A booking row outlives the decision that made it, so `isRemindableApplicationState` gates on the *application*: a candidate rejected the day before their final interview is never reminded to attend it.

**All are scheduled in `vercel.json`**, daily and staggered so they never overlap:

| Path | Schedule (UTC) |
| --- | --- |
| `/api/cron/expire-screenings` | `0 2 * * *` |
| `/api/cron/expire-interviews` | `30 2 * * *` |
| `/api/cron/renew-calendar-watches` | `0 3 * * *` |
| `/api/cron/auto-archive` | `0 4 * * *` |
| `/api/cron/interview-reminders` | `0 5 * * *` |

Vercel injects the `CRON_SECRET` bearer automatically for paths listed in `vercel.json`, so **`CRON_SECRET` must be set in the deployed environment** — the routes fail closed without it, which shows up as a 500 in the cron log rather than an open endpoint. Daily is deliberate for the sweeps: a 7-day TTL doesn't need finer granularity, and Vercel's Hobby plan permits only one run per day per path anyway.

**The reminder job is the exception, and the limit bites.** A reminder is only useful *before* the thing it announces, and the final hour cannot be caught by a job that looks once a day. On the daily schedule above the 24h reminder still lands (somewhere inside the final day) and the 1h one is quietly retired unsent — nothing breaks, nothing double-sends, but the 1h nudge effectively never fires. Making it real is a one-line change to `0 * * * *` on a plan that allows more than one run per day per path; the sweep already handles the faster cadence without any other change.

Other schedulers work equally well if you ever move off Vercel:

- **Supabase pg_cron + pg_net** — schedule an HTTP GET to the deployed URL with the bearer header.
- **External cron / GitHub Actions** — `curl -H "Authorization: Bearer $CRON_SECRET" <origin>/api/cron/expire-screenings`.

Expiry is therefore detected **both** ways: proactively on the schedule above, and lazily when a candidate reopens a dead link. The lazy path alone was never enough — the candidates who never return are exactly the ones who need sweeping. Recruiters see lapsed interviews in the notification bell (`fetchExpiredInterviewNotifications`).

## Notes for Future Work

- **Rate limiting** (`src/lib/rate-limit.ts`) is in-memory and per-process. Any move to multi-instance deployment must replace it with Redis (or similar).
- **Migrations** in `supabase/migrations/` are timestamped. After editing schema, run `supabase gen types typescript` to refresh `src/types/database.types.ts` so the data layer stays type-safe.

## Documentation

Start at **[docs/README.md](docs/README.md)** — it says which documents in `docs/` are current and which are historical, and why.

- [docs/README.md](docs/README.md) — index of the docs folder, with a reviewed-on date
- [Product Requirements (PRD)](docs/prd.md) — amended in place, with dated entries
- [Architecture](docs/architecture.md) — the layer map and reading order
- [Intern Onboarding Guide](docs/onboarding.md)
- [Design System Master](design-system/screenr-ai/MASTER.md)

**This file wins.** Most of `docs/` is planning material from April–May 2026, kept for the reasoning rather than the facts. Where CLAUDE.md and any document under `docs/` disagree, CLAUDE.md is the current one — every file that has stopped being true now says so in a banner at the top.
