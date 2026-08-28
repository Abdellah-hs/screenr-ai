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
- **Zod 4** (`zod/v4`) for input validation
- **OpenAI** for AI generation, scoring, and the Realtime voice/interview agents
- **LiveKit** (`livekit-client`, `livekit-server-sdk`) for the screening and interview rooms
- **Datalab Marker** for resume text extraction (PDF + DOCX) — it replaced `pdf-parse` and `mammoth`, neither of which is a dependency any more
- **googleapis** for Gmail (outbound only) and Google Calendar
- Deployed on **Vercel** (`vercel.json` also declares the cron schedules)
- Node.js >=18.18.0

## Architecture

### Routing

Next.js App Router. Three kinds of page, and the route group says which:

**`(dashboard)`** — the authenticated shell (sidebar + scrolling `<main>`):

- `/` → redirects to `/campaigns`
- `/overview` — cross-campaign dashboard and decision queue
- `/campaigns` — campaign list
- `/campaigns/[id]` — campaign detail (`?tab=pipeline|setup`)
- `/campaigns/[id]/candidates` — the candidate table
- `/campaigns/[id]/candidates/[candidateId]` — candidate detail
- `/candidates` — the curated talent pool; `?view=all` is the directory
- `/settings` — integrations (Gmail/Calendar, LinkedIn)
- `/admin/audit`, `/admin/duplicates` — audit log, duplicate review queue

**`(focus)`** — one task, one way out: **no sidebar**, because the surrounding
navigation is only an invitation to abandon a half-finished campaign.

- `/campaigns/new` — the create wizard
- `/campaigns/[id]/edit` — the same wizard, seeded from the row
- `/campaigns/[id]/share` — the stage after a successful create: apply link + social

**Public / token-based** — no session, no route group:

- `/apply/[slug]` — the public apply page, the only resume intake channel
- `/respond/[token]` — voice screening
- `/interview/[token]` — the AI interview (desktop-only)
- `/prep/[token]` — the interview prep guide
- `/schedule/[token]` — final human interview slot booking
- `/login`, `/signup`, `/auth/callback` — auth

### Layered Architecture

A strict layered pattern is enforced for all data flow. Respect the boundaries — UI never touches Supabase directly, and data-layer / rules-layer code never calls services or AI.

1. **Server Actions** (`src/lib/actions/`) — entry point for mutations and reads from React. Accepts `FormData` or typed args, performs `auth.getUser()` guard (or `requireUserId()` from `src/lib/auth/guards.ts`), validates with Zod (`src/lib/validations.ts`), enforces rate limits (`src/lib/rate-limit.ts`), then delegates to rules / data / services. Ends with `redirect()` or `revalidatePath()`.
2. **Rules Layer** (`src/lib/rules/`) — **pure** decision functions. Reads already-validated evidence (e.g. an AI score, a response status, a list of required questions vs answers) and returns a decision — usually a `TransitionDescriptor` `{ toState, rationale }` or a guard that throws on bad state. The action executes the transition; the rule only decides. **MUST NOT** import from `@/lib/supabase/*`, `@/lib/actions/*`, or call `revalidatePath` / `redirect`. See `src/lib/rules/README.md` for the full contract. This is the layer that implements "Control > AI > Data" — AI produces evidence, rules decide.
3. **Data Layer** (`src/lib/data/`) — pure Supabase query/mutation functions (e.g. `insertCampaignTx`, `fetchCandidatesByCampaignId`, `transitionApplication`). No auth checks, no validation — that is the action's job. Functions ending in `Tx` perform multi-table writes that should be treated as a logical transaction. **All `applications.status` writes go through `transitionApplication()` in `src/lib/data/transitions.ts`** — never `.update({ status: ... })` directly.
4. **Services** (`src/lib/services/`) — third-party integrations: `openai.ts` (resume extraction, rubric/criteria generation, scoring), `marker.ts` (resume text extraction), `gmail.ts` + `email.ts` + `email-templates/` (**outbound** candidate email), `calendar.ts` (Google Calendar), `livekit.ts` + `realtime.ts` (rooms and Realtime session config), `interview.ts` + `interview-scoring.ts`, `screening-questions.ts` + `screening-evidence.ts` + `screening-coverage.ts`, `linkedin.ts` (social publishing).
5. **Pure domain packages** (`src/lib/resume-scoring/`, `src/lib/screening-scoring/`, `src/lib/interview-scoring/`, `src/lib/scoring/`, `src/lib/proctoring/`, `src/lib/talent-pool/`) — versioned, dependency-free logic that is too big for a rule but must never touch I/O. `resume-scoring` owns the whole evidence→score path: the priority model, the LLM evidence schema, quote verification, the deterministic scoring/eligibility/ranking functions, and the cache key. `screening-scoring` is its mirror for the voice stage and `interview-scoring` for the AI interview. `scoring` holds what the stages must share so they cannot drift apart: the evidence-level enum and the level → score table (all three stages), plus — for the two that grade SPEECH — the transcript rendering, the reporting schema, the quote validator and weight normalisation. What each level MEANS stays with its stage, because a CV, a screening answer and a full interview each prove a skill differently. No OpenAI calls, no Supabase, no clock.
6. **Orchestration / Pipelines** (`src/lib/resume-ingest/`, `src/lib/screening/`, `src/lib/interview/`, `src/lib/scheduling/`) — multi-step **use-cases** that compose the lower layers (services → data → rules → `transition()`) into one reusable flow. They exist because a flow like resume ingest may be driven from **more than one entry point** (today the public apply action; a session-less caller like a cron sweep could reuse it tomorrow), so it can't live inside any single action. A pipeline runs on an **injected `db` client** (`SupabaseDb`) so it works with or without a recruiter session (service-role for cron). **MUST NOT** perform auth, Zod validation, or rate-limiting — those stay in the action that calls it (a cron route does its own `CRON_SECRET` guard). It **MUST** still route every `applications.status` change through `transition()` and keep AI advisory (score → rule decides → transition). Think of it as an "action body" lifted out so several callers can share it. The canonical example is `ingestResumeDocument` (extract → classify → upload → upsert → score → rule → advance). Resume evaluation itself is a second one: `evaluateApplicationResume` (`src/lib/resume-ingest/score-resume.ts`) is shared by the ingest pipeline and the recruiter re-score action so a CV cannot be graded two different ways depending on how it arrived.

Auto-generated Supabase types live in `src/types/database.types.ts`.

**Server Actions are the default; route handlers exist only where an Action cannot reach.** Nothing the recruiter's browser does goes through `src/app/api/` — but three kinds of caller have no React tree and no session, so each gets a guarded route:

- `/api/agent/screening/transcript`, `/api/agent/interview/{transcript,proctoring,snapshot}` — the standalone agent workers reporting in (`AGENT_API_SECRET`)
- `/api/agent/{screening,interview}/instructions` — the same workers **reading**: a `GET` that returns the interviewer instructions for one application (`AGENT_API_SECRET`). It flows app→worker, and it exists because room metadata cannot hold a secret — see "Room metadata is candidate-visible" below.
- `/api/agent/screening/control` — the screening worker's **conversation** with the app: it reports what just happened on a live call (a finalized candidate turn, a question having been asked, an answer running out of time) and is told the exact question to put next (`AGENT_API_SECRET`). The only agent route that is a round-trip rather than a report — see "The app pushes the conversation" below.
- `/api/cron/{expire-screenings,expire-interviews,renew-calendar-watches,auto-archive,interview-reminders}` — scheduled sweeps (`CRON_SECRET`, fail closed)
- `/api/cron/backfill-contact-links` — same guard, **not** a schedule and deliberately absent from `vercel.json`. A one-shot repair invoked by hand; it re-reads stored CVs through Marker, which costs money per document, so it defaults to a small batch and takes `?dryRun=1` (free) to size the job first.
- `/api/integrations/{gmail,linkedin}/{connect,callback}`, `/api/webhooks/google-calendar` — OAuth round-trips and Google's push notifications, which are redirects and third-party POSTs

If you are adding an endpoint and the caller is a page in this app, it is a Server Action, not a route.

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
- `src/components/Sidebar.tsx` — the `(dashboard)` shell's only chrome. There is no Navbar: it was 80px for one icon, so the pages that want the notification bell render it themselves

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

#### An outage of ours costs the applicant a delay, never their application (decision 2026-08-25)

**A candidate whose CV we failed to READ is still filed.** Marker timing out,
OpenAI refusing, Datalab returning a 502 — every one of those used to propagate
out of `ingestResumeDocument`, and the only thing the apply action could do with
an exception was email the applicant and forget them. **Nothing was written**, so
nobody at the company ever knew somebody had applied, and the email asked them
to fix it: *"We couldn't read that file. Please upload a clear PDF."* Their file
was usually fine.

Three separate things were wrong, and they compounded:

1. **The poll budget was sized against a limit that had stopped applying.**
   `POLL_MAX_ATTEMPTS` was 25 (~50s), commented as "comfortably inside the 60s
   Vercel Server Action limit" — but resume ingest moved into `after()`, which
   runs on the route's own `maxDuration`. It is now 90 (~3 min), and the apply
   page declares `maxDuration = 300` so the deferred work actually has it.
2. **A timeout was reported to the candidate as an unreadable document.**
   `isUnreadableDocument` now draws the line: only `conversion_failed` — Marker
   read the file and said it could not convert it — is the document's fault.
   Everything else is ours.
3. **Ours had no explicit failure state**, which is the anti-pattern this file
   already forbids.

**The rules:**

- **`processing_failed` is now reachable from `new`,** written by
  `recordProcessingFailure`. It uploads the CV, upserts the candidate from the
  identity the apply form already validated, creates the application, and
  transitions with the upstream error message as the rationale. The applicant is
  in the pipeline, visible, contactable.
- **The self-declared identity is what makes this possible.** The form asks for
  a name and an email and validates both, so a failed extraction is not a failed
  application — the identifying half arrived by a route that cannot time out.
  The CV-shaped fields are left empty rather than guessed, the same rule the
  extractor runs under.
- **It never scores.** There is nothing to score against; the CV has not been
  read. `processing_failed` is not a verdict on the candidate and the scoring
  rule must never be able to reach it.
- **The candidate gets the ordinary receipt, not "please apply again."** They
  ARE received, and asking them to re-apply would both ask a candidate to fix
  our outage and file them twice. The only path that still says "try again" is
  one where nothing could be written at all.
- **A caller with no self-declared identity still throws.** A row with no name
  and no email is an anonymous CV nobody could act on or contact — worse than
  the exception. No live channel hits this; the apply form always supplies one.

##### `processing_failed` is the one failure state with a way back

`reprocessFailedApplication` (`src/lib/resume-ingest/reprocess.ts`) re-reads the
stored CV and, on success, returns the application to `new`. Without it the
state is a graveyard — its only other exit is `archived` — so an applicant lost
to a five-minute Marker blip would stay lost, which is the problem this whole
decision exists to fix.

- **It is the only failure state that is OURS rather than a fact about the
  candidate.** The others record something that happened in the world and
  cannot be un-happened: a link ran out, a window closed, somebody did not turn
  up. This one records that our extractor was down while a real person's CV sat
  there unread.
- **`new` is the only edge, deliberately.** Routing a repair straight to a
  scored or approved state would skip the rule that owns that decision. A repair
  is not a verdict.
- **`new` is therefore a `SYSTEM_PRODUCED_STATE`.** It is the only edge into
  `new` (an application otherwise ARRIVES there), and the artifact it asserts is
  a CV that was actually read. A recruiter setting it by hand from the stage
  dropdown would move the application to "waiting to be scored" while
  `parsed_data` is still the identity-only placeholder — and the next scoring
  sweep would grade that empty parse, producing a real number, quite possibly a
  rejection, for a document nobody has opened.
- **`processing_failed` is reached from three places and only one is
  recoverable.** From `screening_completed` or `interview_completed` it means a
  SCORE could not be computed for somebody who has already been through those
  stages; re-reading their CV repairs nothing and would drag them back to `new`,
  discarding a screening they actually sat. The state alone cannot tell those
  apart, so `isRecoverableProcessingFailure` (`src/lib/rules/processing-failure.ts`)
  takes the state the application failed FROM — read off the transitions log by
  the action, off the already-loaded timeline by the page. Getting this wrong in
  the permissive direction destroys real evidence, so the rule is an allowlist
  of one.
- **It must never create anything.** `upsertCandidate` always INSERTs and flags
  a duplicate rather than merging, so a retry built on `ingestResumeDocument`
  would fill the duplicate queue with the consequences of our own outage.
- **A retry that fails the same way changes nothing.** The pipeline throws, the
  application stays `processing_failed`, and the recruiter is told and offered
  the button again. Only a verdict about the DOCUMENT comes back as a result.
- **A re-read fills blanks and never blanks a filled field.** By the time
  somebody retries this, a recruiter may have corrected a phone number by hand.
- **"CV could not be read" is gone from the UI.** `eventLabel` and
  `decisionPrompt` said it, and it is wrong for all three routes into the state.

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
IF NOT eligible (any must-have criterion failed):
  transition(app, 'rejected', actor='system', rationale='failed must-have: X', disposition='LOW_SCORE')
ELSE IF automation_mode = hitl:
  transition(app, 'screening_review_pending', actor='system', rationale='awaiting review')
ELSE IF ranking_score >= threshold:
  transition(app, 'screening_approved', actor='system', rationale='ranking>=threshold')
ELSE:
  transition(app, 'rejected', actor='system', rationale='ranking<threshold', disposition='LOW_SCORE')
```

#### Resume screening is evidence-based, not model-scored (decision 2026-08-19)

**The model never returns a number for a resume.** It reads the CV and reports,
per criterion, an `evidence_level` (`not_present` | `unclear` | `weak` |
`partial` | `strong` | `very_strong`) plus verbatim quotes. Every number is
derived in `src/lib/resume-scoring/` by a fixed table:

```
not_present → 0    partial → 55
unclear     → 0    strong  → 80
weak        → 25   very_strong → 100
```

This replaced a prompt that asked for per-criterion 0-100 scores. Two reasons:

1. **Reproducibility.** "Is this a 68 or a 74?" has no stable answer, so the same
   CV could score differently on consecutive runs. A reading repeats; an
   arbitration does not.
2. **Must-haves are gates, not weights.** A weighted total lets a surplus on one
   criterion pay for a shortfall on another. Applied to a non-negotiable
   requirement that turns "must" into "mostly", silently.

**The rules, in order, and none of them may be relaxed:**

- The recruiter's only per-criterion decision is `priority`: `must_have` or
  `nice_to_have`. No weights, no per-criterion fail lines, no importance on the
  resume stage. (Screening-question and interview rubrics still use the
  importance-weighted model — this decision covers resume screening only.)
- **Every** must-have is checked independently against `MUST_HAVE_MINIMUM_SCORE`
  (60). All must pass. Failures are reported in full, not first-only.
- A candidate is `eligible` only when every must-have passes. Ineligible is a
  **hard reject in every automation mode**, HITL included — a gate is not a
  review call.
- The ranking score is the arithmetic mean of **every criterion, must-haves
  included** (changed 2026-08-23 — see below), and is computed **only for an
  eligible candidate**. An ineligible candidate has `ranking_score = null` —
  never a low number, which would read as "how close they came" and invite an
  argument with the gate.
- **A nice-to-have can never repair a failed must-have.** This is the invariant
  the whole module exists to hold; the tests assert it directly. It is about
  *eligibility*, which is decided before any averaging happens and is never
  reached by it.
- Tier is `eligible` | `ineligible`. Do not label a resume `strong` / `moderate`
  / `weak` — those values remain in the enum for stored history and for the
  graded stages.
- Quotes are verified against the exact document the model was shown
  (`buildNormalizedResumeDocument` — the same string is prompt input,
  verification corpus, and cache-key input). An unverifiable quote is discarded;
  a criterion left with no verified quote is downgraded to `unclear` (score 0).
  **Never award credit on an unverified quote.** Structural failures (wrong
  count, wrong order) reject the run; evidential failures downgrade and warn.
- `applications.resume_score` now holds the **ranking score** and is null for an
  ineligible candidate. **`scored_at` is the "has this been evaluated" marker**,
  not `resume_score`.

##### The ranking is graded on must-haves too (decision 2026-08-23)

The ranking used to average the **nice-to-haves only**, which threw away the
reading of the criteria the recruiter cared about *most*. Passing a gate was the
entire contribution a must-have made: `very_strong` evidence of five years and
`strong` evidence of one project both scored "eligible" and then vanished from
the number, so two candidates who cleared every requirement were ordered purely
by optional extras.

The pathology that surfaced it: a candidate met all **3** must-haves and ranked
**13**, because the only criteria in the mean were 4 nice-to-haves their CV
barely touched. At a `resume_threshold` of 70 that is an auto-reject of someone
who met every stated requirement.

`calculateNiceToHaveRanking` is therefore now **`calculateRankingScore`**, the
mean over **all** criteria, and `RESUME_SCORING_RULES_VERSION` is
`v2_ranking_over_all_criteria`.

- **The gate is untouched and structurally cannot be reached by this.**
  `evaluateEligibility` runs first, criterion by criterion, against
  `MUST_HAVE_MINIMUM_SCORE`. `calculateRankingScore` takes `eligible` as an
  argument rather than deriving it, and an ineligible candidate still gets
  `null`. There is no number for a surplus to inflate, so a nice-to-have still
  cannot repair a failed must-have.
- **Every criterion carries equal weight, deliberately.** A must-have is not
  worth more *inside the ranking* — its extra importance was already spent, in
  full, on the gate that ends the application. Weighting it again would state
  the same preference twice and reintroduce exactly the compensating arithmetic
  the priority model exists to forbid.
- **"Eligible with no nice-to-haves scores 100" is gone.** Such a candidate now
  ranks on how strongly they evidenced the requirements (all-`strong` → 80,
  all-`very_strong` → 100). Only an empty criteria list returns 100, and
  `evaluateApplicationResume` returns null before that can happen.
- **Old scores are not comparable to new ones and are not back-filled.** A
  ranking written before this averaged a different set, so a campaign scored
  across the change holds two kinds of number. Re-score to move a candidate onto
  the current rules; the stale-rubric banner and the audit row's
  `scoring_rules_version` are what say which rules produced a given figure.
- Extraction is cached in `resume_evidence_cache`, keyed on resume text +
  criteria/priorities in order + rubric version + prompt version + model +
  scoring-rules version. Only the *evidence* is cached; the deterministic score
  is always recomputed, so a cached result can never predate its rules.

#### Screening answers are evidence-based too (decision 2026-08-21, unit changed 2026-08-22)

**The model never returns a number for a screening answer either.** It reads the
voice transcript and reports an `evidence_level` plus verbatim candidate quotes
**per rubric dimension**; `src/lib/screening-scoring/` derives every score. Same reason
as the resume stage, and the same ladder — the level → score table lives in
`src/lib/scoring/evidence-levels.ts` and is shared by both, so a `strong`
reading is worth 80 wherever it was read. A recruiter comparing a resume score
to a screening score is comparing two numbers made the same way.

What each level *means* is deliberately **not** shared
(`SCREENING_EVIDENCE_LEVEL_DEFINITIONS`). A CV proves a skill by listing a role
and a duration; an answer proves it by what the candidate can say about the work
when asked. Reusing the resume wording would grade speech as though it were a
document, penalising a candidate for not reciting job titles out loud.

**The rules:**

- Quotes are verified against the **candidate's half** of the transcript, never
  the whole thing. The interviewer states the topic of every question, so a
  quote lifted from their turn would verify cleanly and award credit for the
  topic merely having been raised.
- An unverifiable quote is discarded; a dimension left with no verified quote is
  downgraded to `unclear` (score 0). **Never award credit on an unverified
  quote.** Structural failures (wrong finding count, duplicate or unknown
  dimension id) reject the run; evidential failures downgrade and warn.
- Validation can only ever lower a level, never raise one.
- The overall is the **weighted** mean of **every** rubric dimension, covered or
  not. Dropping uncovered dimensions from the denominator would let a candidate
  who evidenced one competency well and never touched four outscore one who
  covered all five adequately. Weights come from the recruiter's importance
  choice via `deriveDimensionFields`, and are re-normalised at score time so a
  rubric whose stored weights round to 0.99 still lets a flawless call reach 100.
- A transcript with no candidate speech is scored `not_present` across the board
  **in code, without calling the model** — a model handed silence invents
  answers to fill it.
- `scoring_rules_version` and the validation warnings are persisted in the audit
  snapshot, so a stored score always says which arithmetic produced it and what
  was corrected on the way.

**There is deliberately no must-have gate on screening.** A resume must-have is
objective and checkable against the document; a screening answer is speech,
transcribed, and noisier. A weak answer lowers the score — it never
auto-rejects. The `screening_threshold` gate in
`evaluateScreeningScoringOutcome` is unchanged. `ScreeningDimension` therefore
carries **only** `id`, `name` and `weight`: `is_mandatory` and `min_score` never
reach the scorer, so the gate cannot be reintroduced by accident, and the
Must-Have control is hidden on the rubric editor's screening tab because a
control that labels a rule which does not exist is worse than no control.

##### The scoring unit is the rubric dimension, not the question (decision 2026-08-22)

Until this, the recruiter could edit a "Screening questions" rubric that
**nothing read** — the score was the unweighted mean of a score per question,
and the rubric's dimensions changed nothing. The pipeline is now:

```
Job description → screening rubric → questions drafted FROM the rubric
  → candidate answers → evidence extracted PER DIMENSION → weighted score
```

- **Questions are how the call goes looking; the rubric is what is graded.** A
  candidate who evidences a competency while answering some *other* question has
  evidenced it. Per-question reading could not see that, and it silently gave a
  competency probed by two questions twice the say of one probed by a single
  question — a weighting nobody chose, produced by phrasing.
- **Questions are drafted from the screening rubric** (`generateQuestionsForRole`).
  A dimension no question goes looking for scores 0 by default, so drafting from
  the description alone was a real hazard. It previously took the **resume**
  criteria, which was the wrong rubric for this stage entirely. The wizard passes
  its draft rubric because it is holding one before the campaign row exists.
- **The rubric also sizes the set** (`screeningQuestionCountForRubric`): one
  question per dimension, clamped to 3–8. A fixed five could not hold the rule
  above — against seven dimensions it left two unprobed and therefore scored 0
  for every candidate, and against three it spent two questions on topics
  nothing grades. The floor exists because evidence is read across the whole
  transcript, so extra questions give a dimension more chances to be evidenced;
  the ceiling because a spoken call past eight questions is one candidates
  abandon, and the prompt already knows to combine related dimensions. Neither
  caller passes a `count` — sizing lives in one place so the wizard and the
  campaign page cannot draft differently sized sets for the same rubric.
- **The model is never shown the weights.** It would lean on them — reporting
  more generously for the dimension it can see counts for most, which is scoring
  by proxy. Weighting is applied afterwards, in `calculateScreeningScore`.
- **A campaign with no screening rubric scores each question as its own
  dimension at equal weight**, which reproduces the old arithmetic exactly
  through the same code path. There is deliberately no second scorer: a fallback
  that runs different arithmetic is one nobody tests.
- `screening_question_responses.dimension_scores` holds the result. **NULL means
  the response was scored per question** (anything before 2026-08-22, plus the
  legacy text path) and renders from `answers[].score`. History is not
  back-filled — a score should show the unit it was actually graded in.
- `SCREENING_SCORING_RULES_VERSION` is `v2_weighted_dimensions` and the prompt is
  `v4_rubric_dimension_evidence`; the audit snapshot also records `scoring_unit`
  and the rubric it used, so adding a rubric later cannot make an old score look
  as though it had been graded against one.

`screening_questions.is_required` was **dropped** on 2026-08-21 as part of this.
It gated nothing — no rule read it and no submission was blocked by it — so
after the no-gate decision it labelled a rule that does not exist, which is
worse than no label: a recruiter ticking "Required" reasonably expects a weak
answer there to cost more, and it does not. It also worked against the scoring:
the voice agent was told optional topics were "if time allows", so it could
legitimately skip one, while the overall is the mean over **every** question —
a skipped topic scores 0. The agent is now told to cover all of them and why.

The **legacy text path** (`scoreAnswers`) still uses the old numeric prompt. The
typed-answer form was retired in #161, so it only runs when a recruiter
re-scores a response captured before that; converting a path no new response can
reach would mean maintaining a second evidence prompt for no live benefit.

##### An uncovered dimension scores 0, and the fix is a question (decision 2026-08-22, revised same day)

The weighted mean runs over every rubric dimension. That is right for a
dimension a candidate **was asked about** and said nothing useful on — 0 is an
honest verdict on an answer. It bites for a dimension **no question probes**:

```
Kafka 0.3 / SQL 0.3 / Collaboration 0.2 / Model Validation 0.2
questions cover only the first two, candidate answers both strongly:
  80×0.3 + 80×0.3 + 0×0.2 + 0×0.2 = 48   → auto-rejected at a threshold of 70
```

**The remedy is to ask about it**, not to shrink the rubric. `checkScreeningQuestionCoverage`
names the unprobed dimension before the campaign goes live, `generateQuestionsForRole`
drafts one question per dimension so the gap is unlikely to open in the first
place, and a dimension nobody wants to ask about should be deleted from the
rubric rather than kept in it unscored.

A per-dimension **"Scored / Not scored"** toggle (`rubric_dimensions.excluded_from_scoring`)
was built for this and **removed the same day**: it was a second way to express
"this is not part of the screening" alongside deleting the dimension, and two
controls for one intent is how a rubric ends up saying something its author did
not mean. The column still exists on the table, `DEFAULT false`, written by
nothing and read by nothing — left in place because dropping a column is not
worth a migration until something else needs the space.

`calculateScreeningScore` deliberately cannot tell the two cases apart, and must
not try: from inside the scorer, "asked and gave nothing" and "never asked" are
the same input. Every fix for this belongs upstream of it.

##### Question coverage is checked, never stored (decision 2026-08-22)

A rubric dimension no question probes scores **0 for every candidate**, and that
0 enters the weighted total as though they had failed it — when nobody asked.
`checkScreeningQuestionCoverage` (`src/lib/services/screening-coverage.ts`) reads
the rubric and the questions and reports which dimensions look unprobed.

**Questions are deliberately NOT linked to dimensions in the database.** No
`dimension_id`, no join table, no migration. A question legitimately covers
several dimensions at once ("a system you designed that had to handle rapidly
increasing traffic" probes design, scaling and performance), and the generator is
explicitly told to combine dimensions when there are more of them than questions
— so a single stored tag would be wrong by construction in exactly the case
coverage matters most. The relationship is semantic and is computed when needed.

The asymmetry is load-bearing and is stated in the prompt: **a dimension with no
question is a problem; a question with no dimension is not.** "Why do you want to
work here" is a fine thing to ask and simply does not contribute to the score.
The response schema has no field for complaining about it.

- **It never touches scoring.** Nothing in `src/lib/screening-scoring/` imports
  it, and the scorer still reads the WHOLE transcript per dimension. Narrowing
  evidence to "that question's answer" would recreate the per-question bug.
- **Everything that can be wrong is corrected in a pure layer**
  (`src/lib/screening/coverage.ts`): an id not in the rubric is dropped, a
  dimension the model never mentioned counts as **covered** (silence is not
  evidence of a gap), names come from the rubric, and "no questions at all" is
  answered in code without calling the model.
- **`stepBlockers` takes coverage as an argument** rather than computing it. That
  function is pure and the wizard calls it every render; computing it there would
  mean an AI call per keystroke. The component checks once, on Next from the
  rubric step, keyed on `coverageSignature`.
- **The blocker is hard, but the check fails open** (decision revised 2026-08-22).
  A "Continue anyway" shipped first, on the grounds that this blocker is a
  model's reading rather than a fact about the draft. It was removed: the two
  remedies — ask about the dimension, or take it out of the rubric — are both
  seconds of work, and an override is the path of least resistance, so the one
  outcome nobody wants (every candidate scoring zero on a dimension) was also
  the easiest to reach. Each blocker sentence therefore names both remedies; a
  blocker with no override and no stated way out is a dead end.
  **A failed CHECK is a different thing from a finding** and still advances,
  with a visible note: OpenAI being down says nothing about the questions, so a
  configuration warning must never become an outage — and it must never silently
  read as "everything is covered".
- **Prevention at creation, advice afterwards.** The campaign page's editor shows
  the same finding as a dismissible warning; it never blocks a save on a live
  campaign.
- **The score breakdown remains the backstop.** A dimension that ends with no
  evidence still renders as 0 with "no evidence found", because the coverage
  model is not guaranteed to be right.

#### The interview is scored the same way as screening (decision 2026-08-28)

The AI interview was the last stage still asking a model for numbers. It now
runs the same pipeline as the voice screening: the model reports an
`evidence_level` plus verbatim quotes **per rubric dimension**, code verifies
the quotes against the candidate's own speech, and `calculateInterviewScore`
derives every number from the shared ladder in `src/lib/scoring/evidence-levels.ts`.

Two separate things were wrong, and the second is the worse one:

1. **The numbers were not reproducible.** `scoreInterview` told the model to
   "score each 0-100" and averaged what came back. "Is this a 68 or a 74" has no
   stable answer, so the same interview could score differently on consecutive
   runs — the identical reasoning that took numbers off the resume stage on
   2026-08-19 and the screening stage on 2026-08-21.
2. **The recruiter's interview rubric was never read at all.** The prompt told
   the model to "identify the competencies the role actually calls for", and the
   one caller never passed the rubric — `runInterviewScoring` fetched only its
   VERSION, to stamp the score with. So a rubric the recruiter had built,
   weighted and maintained decided nothing, while the score it stamped implied
   it had.

**The rules:**

- **The scoring unit is the rubric dimension**, read across the WHOLE
  transcript. A candidate who evidences a competency while answering some other
  question has evidenced it.
- **The overall is the weighted mean over the dimensions the interview actually
  REACHED**, re-normalised across them (decision 2026-08-28, revised same day).
  A competency nobody asked about is left out rather than scored 0. This is the
  one place the interview deliberately diverges from screening, and the
  difference is upstream rather than a matter of taste:

  | | Screening | Interview |
  | --- | --- | --- |
  | Where questions come from | drafted FROM the rubric | improvised from the candidate's CV |
  | Coverage guaranteed? | `checkScreeningQuestionCoverage`, a hard blocker | nothing, by design |
  | An unprobed dimension is | a fixable authoring error | expected behaviour |
  | So scoring it 0 | exposes the mistake | blames the candidate for a question nobody asked |

  **The CV-anchoring is what makes the divergence correct, and it is not
  incidental.** "You said you rebuilt the ingest pipeline — what broke?" is hard
  to bluff; "tell me about system design" is easy. Probing claims is what makes
  interview evidence worth grading at all, so no mechanism aims a question at
  each dimension and none should be added.

  **A screening-style coverage check cannot exist here** — that one matches a
  question LIST against dimensions, and interview questions are improvised, so
  there is no list. A question-count check was considered and rejected for the
  same reason the per-question scorer was: evidence is read across the whole
  transcript, one answer can evidence three dimensions, so "6 dimensions > 5
  questions" is not a shortfall.

- **What this gives up, and the remedy.** A candidate who evidenced one
  competency brilliantly and touched nothing else now outranks one who covered
  everything adequately. A test pins that exact inversion so it cannot be
  forgotten. `covered_count` / `covered_weight` are therefore **not optional**:
  they are computed, persisted on the score AND the audit row, and rendered
  above the breakdown, because 100 from one dimension of five and 80 from all
  five are otherwise indistinguishable. The remedy is disclosure rather than
  arithmetic, and that works here **only because the interview never gates** —
  suppressing a thin score would be gate-like behaviour on the one stage that
  has no gate.

- **`not_present` is the only excluded level, and the prompt had to be hardened
  for it.** Once an unreached dimension is dropped rather than scored 0,
  `not_present` stops being the maximum penalty and becomes *better* for the
  candidate than `weak` — a new incentive to under-report. So `sc`-style
  wording was added spelling out that it describes the CONVERSATION ("the topic
  never came up") and never the quality of an answer; a candidate who was asked
  and said "I don't know" is `unclear`, which is assessed and scores 0.
  Validation still downgrades only to `unclear`, never to `not_present`, so the
  validator can never drop a dimension out of the denominator and raise a score.
  `INTERVIEW_EVIDENCE_PROMPT_VERSION` is `v3_rubric_dimension_evidence`.
- **The ladder is shared; the DEFINITIONS are not.**
  `INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS` asks for more at every rung than the
  screening wording, and a test asserts the two are never identical. A single
  example described at surface level is `strong` in a five-minute filter and
  `partial` in the deep stage; reusing the screening wording would hand out top
  marks for clearing the filter's bar and stop the interview discriminating at
  the point it exists to discriminate. **The direction is fixed: the deeper
  stage asks for MORE evidence per level, never less.**
- **A campaign with no interview rubric is graded by `DEFAULT_INTERVIEW_DIMENSIONS`** —
  four equal-weighted competencies — through the SAME code path. A degenerate
  rubric, not a second scorer: a fallback running different arithmetic is one
  nobody tests, and it would put two kinds of number in one column. The ids are
  readable slugs (`default:role_fit`) so a stored score says plainly that no
  rubric was used, and the breakdown tells the recruiter to build one.
- **Still no gate, and this is unchanged.** The interview has no threshold and
  no must-have; it never rejects at any score. `InterviewRubricDimension` omits
  `is_mandatory` / `min_score` for the same reason `ScreeningDimension` does —
  a field the scorer never receives is a gate that cannot come back by accident
  — and the breakdown renders no threshold card.
- **`dimension_scores` is NULL for every interview scored before this**, and is
  not back-filled. Those render from `dimensions[].score`, the unit they were
  actually graded in. The two overalls are not comparable — one an unweighted
  mean of model-chosen competencies, the other a weighted mean over the
  recruiter's rubric — so re-score to move a candidate onto the current rules.
- `INTERVIEW_SCORING_RULES_VERSION` is `v2_covered_dimensions_only`. The audit snapshot also records the rubric it
  graded against and whether the default set stood in, so a stored score cannot
  later be mistaken for one graded against a rubric added afterwards.
- **`strengths` / `concerns` are gone** (empty arrays). They came from the
  numeric prompt; keeping them would have meant forking the evidence schema the
  two spoken stages now share, and the per-dimension notes plus the extraction
  summary say the same things against the rubric instead.
- **The retired scorer was deleted**, not left dormant. `scoreInterview` and its
  tests are gone: an unused second scorer is the thing that eventually gets
  called again by mistake.
- **`rescoreInterview` is what makes "re-score to move onto the current rules"
  a real instruction.** It did not exist: `runInterviewScoring` had exactly one
  caller, the candidate's own submit, so an old interview was stuck on the old
  display forever and the new pipeline could not be exercised without sitting a
  whole interview. The button sits on the interview panel.
  - **It is an evidence refresh and applies NO transition** (`mode: "rescore"`,
    which returns before the rule layer). The application has usually already
    passed `interview_scored`, so re-running the rule would either fail on an
    illegal edge or, in `fully_auto`, shove a candidate a manager is actively
    reviewing back into `manager_review`. Same contract as the resume re-score.
  - **Unlike the SCREENING re-score it accepts an already-scored interview** —
    that is the entire point. What it refuses is a closed application
    (`assertInterviewRescoreAllowed`: `hired` / `rejected` / `archived`),
    because rewriting the evidence behind a decision already made only muddies
    the record. The campaign-freeze rule applies as it does to every other
    re-score.

**What moved into `src/lib/scoring/` to make this possible.** Both spoken stages
now share `transcript.ts` (the rendering that is simultaneously prompt input and
verification corpus), `transcript-evidence.ts` (the reporting schema and the
validator) and `weights.ts`. `screening-scoring` re-exports them under its own
names, so its callers and tests were untouched. The duplication-free version is
the point: if the validator existed twice, one stage would eventually start
awarding credit on an unverified quote while the other did not, and the shared
ladder would become a fiction.

#### Two thresholds, not one, and none on the interview (decision 2026-08-21)

There are exactly **two** score gates on a campaign, and they are separate columns:

| Column | Read by | Passing it means | Failing it means |
| --- | --- | --- | --- |
| `resume_threshold` | `evaluateResumeScoringOutcome` | the CV's **ranking** score clears the bar → `screening_approved` | `rejected` |
| `screening_threshold` | `evaluateScreeningScoringOutcome` | the voice answers clear the bar → `interview_invited` | **rests at `screening_scored`** — never rejected |

`resume_threshold` is **not** the must-have gate — that runs first and is not a
threshold at all (see the previous section). It is the bar on how good an
*already eligible* candidate is, applied to the nice-to-have ranking.

Until 2026-08-21 both rules read `screening_threshold` while the UI showed one
box, so a recruiter raising the bar to stop weak CVs was silently also raising
the bar on candidates who had already answered well. **They are not the same kind
of number** — a resume ranking orders a pile of CVs against a rubric, a screening
score grades spoken answers — so they must never share a fail line. The DB
default was also 50 while the form sent 70; both are now `DEFAULT_SCORE_THRESHOLD`
(70) in `src/lib/constants.ts`, which the columns, the Zod parser and the form
defaults all read.

`fetchCampaignScoringConfig` returns both because two callers share it, but the
resume rule's own `CampaignScoringConfig` declares **only** `resume_threshold` —
the resume decision structurally cannot reach for the screening bar.

**There is deliberately no interview threshold.** See the next section: the
interview never gates and never auto-rejects, so it has no bar to set. If the
problem is "too many scored interviews to work through", the answer is ordering
the `manager_review` queue, not a gate — a threshold there would auto-reject
someone who sat a whole interview, on the least reviewable evidence in the
product (there is no recording to check a decision against).

##### Must-have is a resume control, on every stage (decision 2026-08-22)

The rubric editor offered **Must have / Nice to have** on the interview stage,
and the footnote under it said *"Must have dimensions knock a candidate out if
they fail them."* Nothing did. `evaluateInterviewScoringOutcome` never rejects
at any threshold, so an interview must-have could not knock anyone out even in
principle — the control named a rule that does not exist, and the caption
asserted it outright. The screening stage lost the same control on 2026-08-21;
this finishes the job.

**Must-have now exists on the resume stage and nowhere else**, because that is
the only stage where it is both enforced and checkable: a CV either states the
qualification or it does not.

- The editor renders the control only when `isResumeStage`. `setPriority` is
  resume-only in consequence.
- The read-only `RubricDisplay` drops its **Requirement** column for any stage
  but resume (`showsRequirement`). Rubrics are never rewritten in place, so
  rows saved before this still carry `is_mandatory: true`; hiding the badge is
  what stops an old row asserting a gate the code does not have.
- `mandatoryDimensionNames(rubrics, "screening")` no longer feeds the screening
  score breakdown — that "· must-have" suffix was the same claim in a third
  place.
- **`generateRubricDimensions` forces `is_mandatory: false` for `screening_q`
  and `interview` in code**, not merely in the prompt. Asking was not enough:
  no editor control renders the flag on those stages, so a recruiter could
  never see a stray mandatory dimension, let alone clear it. Clearing the flag
  clears the derived `min_score` with it, so the row does not describe a fail
  line either.

The column stays in the schema and the type — the resume gate reads it, and
stored history must keep meaning what it meant.

##### The screening threshold advances, it does not reject (decision 2026-08-22)

`evaluateScreeningScoringOutcome` used to chain `[screening_scored, rejected]`
below the line in `fully_auto`. It now returns `[screening_scored]` and stops.
A pass still chains straight to `interview_invited`, so the mode is still
automatic where automation is safe — only the irreversible half became human.

Three reasons, in order of weight:

1. **The volume is not where the leverage is.** The must-have gate and
   `resume_threshold` cut the pile before a screening link is ever sent. Of
   ~100 applicants perhaps 12 complete a call and 5 fall below the line, so
   auto-rejecting here saved a recruiter five review items — at the price of
   never letting a person look at someone who held a live conversation with the
   product. At the resume stage the same rule cuts 80.
2. **It contradicted the rule one stage later.** The interview never
   auto-rejects, because "rejecting someone who sat a whole interview on the
   strength of one number is the decision most worth keeping human". A voice
   screening is that in a milder form — degree, not kind — so the reasoning
   should not stop at the stage boundary. The same file already concedes that
   screening evidence is *noisier* than a CV, which is why there is no
   must-have gate here; a threshold is a gate too, just on the aggregate.
3. **The screening score is the most fragile number in the product.** The
   overall is the weighted mean over every rubric dimension, and a dimension no
   question probes scores 0. The coverage check that prevents that is a model's
   reading. With auto-reject, a missed gap became a silent stack of rejections;
   without it, the same mistake becomes a queue somebody notices.

The counter-argument was weighed and is real: unlike the interview, the
screening **transcript is persisted**, so a rejection here is auditable in a way
an interview rejection could never be. That makes an automatic rejection
*recoverable*, not correct, at these volumes.

**`screening_scored` was added to `AWAITING_DECISION_STATES`** in the same
change — in `data/notifications.ts` (the bell) and `campaigns/board-view.ts`
(the campaign list's attention column), which must stay in step. Replacing an
auto-reject with a queue nobody can see would be a worse failure than the one it
fixed. The `fully_auto` mode description changed with it: it now says candidates
**advance** on your thresholds, because the resume stage is the only one that
still rejects without a person.

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
- Asking a model for a numeric score, weight, tier, eligibility, or hire/no-hire verdict at **any** scored stage — resume, screening or interview (see "Resume screening is evidence-based", "Screening answers are evidence-based too" and "The interview is scored the same way as screening")
- Letting a nice-to-have criterion offset a failed must-have, by weighting, averaging, or any other route
- Awarding credit for a quote that could not be found in the resume text, or in the candidate's own half of a screening transcript

## PRD-Critical Product Rules

Non-negotiable product behaviors from `docs/prd.md`. Do not assume a feature is out of scope just because the code doesn't implement it yet — missing implementation is migration work, not permission to drop the requirement.

### Screening Questions (PRD 3.4.3)

- Candidate responses are **spoken**, captured as a live voice call and stored as a server-side transcript. **The text form was retired in #161** — there is no typed-answer path left, and no env flag re-enables one. Video responses remain an accepted divergence (#48); audio is what ships.
- The flow includes a **practice question** before scored questions.
- Questions are **not** individually required or optional (`is_required` was dropped 2026-08-21). Every question is asked; the **rubric**, not the question, is the scoring unit since 2026-08-22 — see "Screening answers are evidence-based too".
- Candidates may re-record **while the call is theirs to end** — they can stop early and start again, and a fresh room overwrites the previous draft. **They may not re-record once the interviewer has finished (decision 2026-08-24):** when every topic is covered and `end_interview` clears the close, the agent says goodbye, the room closes and the answers are submitted automatically, landing the candidate straight on the done screen. This narrows the original "may re-record before final submission" rule, deliberately. A finished interview that a candidate wandered away from without pressing Submit is one nobody ever scores — it sits at `screening_sent` until the expiry sweep closes it out, and the candidate is rejected for a call they actually completed. The cost is real and accepted: a candidate whose microphone was poor has no second attempt after the interviewer signs off. The transcript is persisted either way, so a recruiter can still see what happened and re-send.
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

The voice screening runs on **LiveKit**: after token verification, the server opens a per-attempt room and mints the candidate's join grant (`src/lib/services/livekit.ts`); a standalone agent worker (`agents/screening/` — its own package with its own `pnpm install` / `pnpm dev`, deployable to LiveKit Cloud) is dispatched into the room, runs the OpenAI Realtime conversation (it **fetches** its interviewer instructions from `GET /api/agent/screening/instructions`), and reports the transcript to `POST /api/agent/screening/transcript` (guarded by `AGENT_API_SECRET`, admin-client write, draft-only while the response is `sent`). The candidate's browser never supplies transcript content — its submit sends only the token and the server finalizes from the agent-reported draft. The worker must be running (see `agents/screening/README.md`) or candidates join a silent room.

**The interviewer is GIVEN the questions; withholding them was reversed
(decision 2026-08-25).** `deferTopicsToTool` withheld the topic list so that
`next_topic` would be the only way to learn it — the theory being that an
instruction cannot out-argue an easier path, so the easier path had to go. It
did not work, and the failure it produced is far worse than the one it fixed.

With the list withheld the prompt says *"Your topics are NOT listed here.
`next_topic` is the only place they exist. You cannot guess them and must not
try."* The model then called the tool **zero times** and improvised an entire
interview. A live call asked five invented questions and **not one of the
recruiter's** — a conversation that sounded completely normal and would have
scored every rubric dimension 0, because the evidence for them was never
solicited.

- **An interviewer with the real questions and no tool call is recoverable.**
  The worker stamps coverage itself (`stampSkippedTopic`) and
  `reconcileAddressedTopic` corrects the order. **An interviewer with no
  questions is not recoverable at all** — nothing downstream can invent the
  evidence it failed to ask for.
- **This also made a repair actively harmful.** `stampSkippedTopic` marks a
  topic asked when the interviewer stops speaking. While the list was withheld
  it was marking topics covered that the interviewer had never raised — the
  ledger said "covered", the transcript held nothing, and the candidate scored
  0. A coverage record is only worth having if it tracks questions that were
  actually asked.
- **What is given up is prompt-extraction hardening** (docs/voice-screening.md
  mitigation #2). The list lives in the server-fetched prompt and never in room
  metadata, so it is not readable from the browser; the residual risk is a
  candidate talking the questions out of the model, which the prompt already
  forbids. That is a much smaller harm than every candidate being asked the
  wrong questions.
- `next_topic` **still exists and still works** when called — it is now a
  convenience rather than the only channel, and the close guard still runs off
  the ledger.
- **`end_interview` is ignored the same way, and the worker now closes the call
  itself.** This is the most expensive of the three tool failures: `windDown` is
  what flushes the transcript, publishes `screening.finished` and lets the
  browser submit. Without it a candidate who answered every question sits on a
  finished call that nobody ever scores — it rests at `screening_sent` until the
  expiry sweep rejects them for a call they actually completed. The worker now
  winds down when the interviewer stops speaking and the app's own directive is
  `close`, which `currentDirective` returns only when no topic is in progress
  AND none is pending — the same condition the close guard checks, so it cannot
  end a call that still has questions left.
- **But "nothing left to ask" is NOT "the interviewer has finished talking",
  and conflating them submitted calls mid-question.** The directive turns
  `close` the instant the last topic settles, which routinely lands while the
  interviewer is still mid-exchange — it then asks one more thing, or
  acknowledges the answer. Closing on the next pause alone cut the candidate
  off in the middle of the final question, which is precisely the failure the
  auto-submit exists to prevent. A real goodbye is followed by silence, so the
  close now waits `CLOSE_SETTLE_MS` (4s) and **any speech from either side
  cancels it**. A conversation that is still going therefore cannot be ended by
  it, and the cost of the delay is four seconds on a call that is over.
- **`considerClose` is armed from BOTH triggers, and guarded at FIRING time.**
  `close` can arrive either while the interviewer is still talking (the
  evaluator settles the last topic mid-turn) or after it has already stopped
  (the evaluator is a 3-5s round-trip, so `turn_completed` routinely lands once
  the room is already silent). Waiting only for the next pause **hangs** in the
  second case — the goodbye has been said and no further state change is
  coming — while closing on the next pause alone **cuts the candidate off** in
  the first. So it arms on the pause AND on the directive turning `close`, and
  the safety is moved to when the timer elapses: if either party is mid-turn it
  re-arms instead of closing. The interviewer generating its goodbye looks
  exactly like that, which is why the check is on live session state rather
  than on elapsed time.

##### The settle window is measured from the SILENCE, not from the wait (decision 2026-08-25)

The wait above shipped as "arm a 4s timer; if somebody is talking when it
elapses, re-arm another 4s". That re-arm is from the moment of the CHECK, so its
phase against the conversation is arbitrary — and on a live call it landed 160ms
after the interviewer stopped:

```
02:42:01  turn_completed -> close; the wait is armed while the interviewer is speaking
02:42:04  fires, deferred (still speaking), re-armed +4s
02:42:08  fires, deferred (still speaking), re-armed +4s
02:42:11.84  [clock] interviewer finished asking   <- it had just asked a question
02:42:12.0   [clock] silence after the goodbye — closing
```

The candidate got **0.16 seconds** to begin answering, and their interview was
submitted for them mid-question. The whole property the wait was built to have —
"a real goodbye is followed by four seconds of nobody saying anything" — was
silently absent on every path that ever deferred, which is most of them: the
directive turns `close` while the interviewer is still talking far more often
than not.

`decideClose` (`agents/screening/src/control.ts`, pure and tested) is now the
only thing that answers "may this call end", and it is asked at **firing** time
against the room as it actually is:

- **The clock is `quietSince`, stamped when speech genuinely stops**, from both
  parties' state events — tracked in the worker rather than read back off
  `session.agentState` / `session.userState`, because a handler running for one
  party cannot assume the session's copy of the other has already updated, and
  that error stamps the quiet clock EARLY, which is the direction that closes a
  live call.
- **A wait that elapses too soon re-arms for the REMAINDER**, so the total is
  always measured from the silence. A wait that elapses while somebody is
  talking still defers, as before.
- **A directive that is no longer `close` abandons the wait entirely**
  (`retryInMs: 0`), instead of leaving a timer running over an interview that
  has been handed another topic.
- **Speech state is recorded before ANY early return, and this is an invariant,
  not a detail** (found by review, 2026-08-25). `decideClose` defers while
  either party is speaking, so a speaking flag that sticks `true` makes the call
  unendable — the candidate sits on a finished interview until the half-hour
  backstop, never submits, and the expiry sweep rejects them for a call they
  completed. It shipped once exactly that way: `UserStateChanged`'s
  `moveOnPending` branch returned ahead of `markSpeaking`, and that branch
  handles the candidate FINALLY STOPPING, so one answer running its full minute
  while they were still talking poisoned the close for the rest of the call.
  Any new early return in either state handler must sit below the tracking.
- **A goodbye `end_interview` already cleared goes through the same settle**
  rather than closing on the next pause. It overrides only the directive check —
  a cleared close still ends the call when the app then goes unreachable,
  because trapping a real candidate in a room after the goodbye is worse.

**There are three windows, because there are three strengths of evidence that
the call is over**, and the default is the safe one:

| Window | When | Why |
| --- | --- | --- |
| `CLOSE_SETTLE_MS` (4s) | `end_interview` cleared the close | The interviewer declared the ending — a fact, in whatever language it settled on. |
| `CLOSE_UNANNOUNCED_SETTLE_MS` (8s) | it just stopped talking | A guess, and the common path since the tool is ignored as routinely as the others. |
| `CLOSE_ANSWER_SETTLE_MS` (20s) | its last words were a question | An answer is **owed**. Four seconds is a normal pause for deciding how to answer. |

- **The unannounced window is deliberately NOT decided from the text.** An open
  question is routinely an imperative — "Walk me through the migration", "Tell
  me about a time you disagreed" — which the prompt actively encourages, so
  reading a full stop as a goodbye would cut off precisely the questions this
  stage most wants answered. Only a trailing question mark is treated as
  evidence, and only in the direction of waiting longer.
- **A candidate turn since the question cancels the long window.** They have
  answered; holding the room for a second answer is dead air.
- **Dead air is not free, which is what bounds all three.** The candidate's
  BROWSER is what submits, on the finished packet — so somebody who gives up on
  a screen that looks frozen and closes the tab first is left at
  `screening_sent` with a completed interview behind them, the exact failure the
  automatic close exists to prevent. "Just wait a minute to be safe" trades one
  cut-off call for a different lost one.

##### The counter is on screen for the whole call, frozen when it is not their turn (decision 2026-08-25)

The countdown used to be REMOVED whenever no budget was running. That is most
of a screening call — the interviewer holds the floor for the greeting, every
question and every bridge — so a live call showed the counter for **about four
seconds per question** and nothing the rest of the time. Asked whether it
worked, the honest report from the chair was *"it doesn't show the countdown"*,
and that is a fair description of a counter you see for four seconds.

The browser was never at fault, which is worth recording because two rounds of
debugging went looking there. The candidate's console showed the whole chain
firing correctly — `data packet` → `answer clock {remainingMs: 60000}` →
`countdown shown {seconds: 60}` → `countdown hidden` a few seconds later. Every
publish was acknowledged by LiveKit. The counter appeared exactly when the code
said it should; the code said it should almost never.

**A counter is now on screen from the moment the room opens until the goodbye**,
in one of three states, and `AnswerClockPacket.paused` is what carries the
distinction:

| State | When | How it reads |
| --- | --- | --- |
| running | a question is outstanding and the budget is ticking | ink, counting down |
| frozen | the interviewer is talking, or no question is open yet | grey, standing still, "starts when they finish asking" |
| hidden | the call is over — `close`, or winding down | absent |

- **Freezing is not new; SHOWING the freeze is.** The interviewer's own airtime
  has never been allowed to drain the candidate's minute — that is
  `holdClockWhileSpeaking`, and it stays exactly as it was. What changed is
  that a stopped clock used to be expressed by taking the counter away, and
  "your minute is paused" and "you have no minute" looked identical.
- **The frozen number needs its caption.** A number standing still with no
  explanation reads as broken, which is the one way a paused counter is worse
  than none at all.
- **`ANSWER_BUDGET_MS` in the worker is a number to DISPLAY, never a deadline.**
  A primary question's clock is only armed once the interviewer stops speaking,
  so during the question there is no remaining value to freeze — the worker
  shows the minute that is *coming*. Every enforced deadline still arrives from
  the app on `answerDueInMs`. Tests assert both halves: that it equals
  `SCREENING_ANSWER_BUDGET_MS`, and that nothing in the worker ever arms a timer
  from it. Drift would be a lie on screen; it could never cut anyone off.
- **A frozen number may hold or fall, never rise, while the interviewer is
  talking.** Settling a topic mid-turn turns "what is left of their minute" into
  "a fresh minute", and the counter jumped `0:50 → 1:00` under an unfinished
  sentence. A clock that runs backwards reads as broken however generous it
  actually is — the same complaint that retired the speech-triggered budget. The
  old value is held until the turn ends; the fresh minute appears with the
  question it belongs to, which is the one moment a rise is explicable.
- **The heartbeat re-sends the frozen number verbatim** rather than re-deriving
  it from a deadline, which would let the interviewer's turn drain it again
  through the back door.
- **It is still the ONE counter.** `paused` is the same clock standing still,
  not a second one counting down to something else — the distinction that
  retired the wrap-up counter below. The packet's key list is pinned by a test
  so a third field has to argue for itself.
- **A question asked AFTER the rubric is covered gets its own minute**
  (`grantsClosingMinute`). This was the last hole, and the candidate found it:
  the interviewer routinely asks one more thing once every topic is done, no
  topic is open so the app sends no deadline and no stamp arms one, and the
  counter had just been dropped for the ending — so they answered a real
  question with a blank screen. Frozen at `0:55`, gone, then being asked
  something.

  The worker arms this one **itself**, from `ANSWER_BUDGET_MS`, and it is the
  only clock it owns outright. That is allowed here precisely because there is
  no ledger entry to disagree with: the app is not tracking this question and
  never will. A test pins it to exactly one call site.

  It is granted for **every** such question — never under a goodbye, never once
  `end_interview` has cleared the close, and never while anything is still on
  the rubric. A once-per-call cap shipped first and reproduced the original bug
  one exchange later: the interviewer asked a *second* closing question, the cap
  refused it a clock, and the candidate answered a real question with a blank
  screen again. The looping is the interviewer's fault and the candidate must
  not pay for it by losing the only thing telling them how long they have; the
  loop is bounded from the other end instead — staying silent runs the clock
  out, the close proceeds, and the worker forces the goodbye.

  The cost is that the call then waits for this minute rather than the 20s
  `CLOSE_ANSWER_SETTLE_MS` window, since `decideClose` defers while any answer
  clock runs — accepted, because a candidate who can SEE the minute knows the
  call has not frozen, and a screen that looks frozen is what makes people
  close the tab on a finished interview.

##### The wrap-up window is NOT on screen (decision 2026-08-25, reversed same day)

A "Wrapping up" counter was added on the close window, on the rule that a
deadline the product enforces is one the candidate is entitled to see. It was
removed the same day, on the candidate's own report, and the reasoning is worth
keeping because the rule that motivated it is still right — it just does not
reach this case.

The counter appeared the instant the candidate stopped talking on the last
question, replacing `YOUR ANSWER 1:00` with `WRAPPING UP 0:20`. Two things were
wrong with that, and neither is fixable by relabelling:

- **The minute on the last question is theirs.** They stopped to think, VAD
  ended the turn, the evaluator settled the topic, and a shorter clock took the
  screen — so the visible effect of pausing was being hurried off a call they
  had not finished. *"It has to wait for my last answer."*
- **It shipped under a real question.** A candidate was shown `WRAPPING UP 0:14`
  beneath "Can you share an example of a project where you collaborated with
  people from different teams?" — captioned "we'll close out the call when this
  reaches zero", while the worker was in fact waiting for them to answer.

**There is now exactly one counter on the screen, and it is the answer budget.**
The interview ends on the goodbye, with nothing counting down to it. The settle
windows still exist and still bound the ending — they are simply not displayed,
because the only action a countdown could prompt is "speak", and an interviewer
who has just asked something already prompts that far more clearly.

`AnswerClockPacket` therefore carries `remainingMs` and `expired` and nothing
else; `closeClockRemainingMs`, `refreshCloseClock` and the browser's
`answerClosing` are gone. A test asserts the packet's shape and that the browser
neither reads a `closing` field nor renders the label, because the two packages
deploy separately.

**The minute on the LAST question outlives the topic settling.**
`turn_completed` settles a topic the moment the candidate stops talking, so a
brief answer used to hand the whole remainder back: on a live call a
1.3-second answer ended a 60-second budget with 47 seconds unspent, the counter
vanished, and the call began closing. Between topics that is invisible — the
next question arms a fresh minute — but on the last one there is no next
question, so the loss IS the ending.

The ledger is right to clear its own `answerDueAt`; this is the worker holding
the candidate's side of the same minute. `armAnswerTimer` leaves the timer and
the counter alone when the app reports `null` while the directive is `close` and
a clock is still running, and `decideClose` refuses to close while
`answerClockRunning` — it outranks every settle window, so a room that has been
quiet long enough to close otherwise still waits.

**But it does NOT survive the interviewer's next turn** (decision 2026-08-25).
The leftover is paused for the whole of an interviewer turn, like any answer
clock, and used to be restored when that turn ended. With nothing left to ask,
that turn was the ENDING, so a live call put `0:36` back on screen underneath a
goodbye:

```
turn_completed settles the last topic -> their minute keeps running (36s)
interviewer speaks for 14s            -> clock paused, counter hidden
interviewer stops                     -> "hidden -> 36s  cause=question delivered"
6s later                              -> participant disconnect, CLIENT_INITIATED
```

Two failures from one restore. The counter is the **answer budget and nothing
else**, so 36s reads as the time allowed to answer whatever was just said —
which is how a question that had a full minute is reported as "the last answer
only gives me thirty seconds". And `decideClose` refuses to close while a clock
runs, so the room stayed open under a sign-off; the candidate closed the tab,
and **their browser is what submits**, so an interview they finished was left at
`screening_sent` — the exact failure the automatic close exists to prevent.

`heldClockSurvivesTurn` (`agents/screening/src/control.ts`, pure and tested) is
the one line of it: the remainder comes back while a question is outstanding,
and is dropped once the app's directive is `close`. A closing turn that DID end
on a question is not an exception — `CLOSE_ANSWER_SETTLE_MS` already buys twenty
seconds to answer it, granted once, and a stale remainder from a *different*
question is not a more honest number than none. An unknown task (a control call
that never landed) is read as a live question: their time comes back.

**An expired minute then goes straight to the goodbye.** `fireAnswerTimeout`
clears the timer and sets `answerWindowSpent`, so a candidate who has just spent
their full sixty seconds is not then held through the trailing-question window
on top — they have already had the time that window exists to give them. The
ending is therefore exactly: the last question, their whole minute, then the
goodbye.

##### The worker asks for the goodbye; it does not infer one (decision 2026-08-25)

A settle window can tell that the room went quiet. It cannot tell that anybody
said goodbye — and treating the two as the same thing ends a call that simply
trailed off. The candidate hears the interviewer stop mid-thought, the room
closes, and their answers are submitted into what sounded to them like a dropped
call. Every window above only changed *how long* that took.

**The call now ends on a goodbye the candidate actually heard.** When the settle
window elapses and nothing has said one, the worker asks for it —
`session.generateReply(GOODBYE_INSTRUCTIONS)` — and closes when THAT turn ends.
Submission always follows a sign-off.

- **Same pattern as every other repair on this worker.** `end_interview` is
  ignored as routinely as `next_topic`, so the thing the product cannot afford
  to lose is driven from observable state with the tool as a fast path. Here the
  thing being lost was the goodbye itself.
- **`awaitingGoodbye` is set BEFORE the reply is requested.** It is what makes
  `AgentStateChanged` close on the end of that turn, and it is what stops a
  second window elapsing into a second goodbye. A tool-cleared goodbye already
  sets it, so the worker never talks over one that is on its way.
- **It speaks only when nothing CAN have said goodbye — an ending on a
  question** (revised same day). The first version forced one on every
  unannounced ending, on the reasoning that a slightly redundant second line
  costs less than a call that just stops. A live call showed that is wrong in
  the ordinary case: the interviewer usually DOES sign off on its own, it just
  does not call `end_interview` to say so, so real calls got **two goodbyes
  eight seconds apart with a silence between them** — a worse ending than the
  thin one being guarded against. A turn ending on a question is the one ending
  that is definitively not a sign-off, so speaking there can never double up.
  The reading can be wrong in one direction only: an ending that was merely thin
  ("Great, thanks.") is accepted as the goodbye, and one thin sign-off the
  candidate heard beats two.
- **`awaitsAnswer` is the single predicate behind both halves**, deliberately
  shared so they cannot drift. The window that buys a candidate time to answer a
  trailing question and the goodbye that follows an unanswered one are one
  decision, and must never disagree about whether a question was asked.
- **The instruction is still written to work either way** ("If you have not
  already, thank them warmly…"), because the interviewer may have signed off
  inside the same turn as its question.
- **It forbids a further question**, because a question here restarts the exact
  problem the forced goodbye solves and the candidate has no window left to
  answer it in.
- **`GOODBYE_BACKSTOP_MS` (25s) bounds it**, deferring while anyone is still
  speaking. A reply that is produced but never spoken leaves no state change to
  close on, and without the bound the candidate sits on a finished interview
  until the half-hour call backstop while it rests at `screening_sent`. A
  `generateReply` that throws winds down immediately for the same reason: a
  goodbye we could not produce is bad, a room that never closes is worse.
- **Nothing counts down to it on screen.** The wrap-up counter that once did
  was removed the same day it shipped — see "The wrap-up window is NOT on
  screen" above. The candidate's only clock is the answer budget.
- **The pattern across all three is the same and worth stating once:** a
  Realtime voice model will not reliably call a tool because the prompt tells it
  to, no matter how the instruction is worded, where it sits in the prompt, or
  whether the easier path is removed. Anything the product cannot afford to lose
  must be driven by the worker from observable session state — `AgentStateChanged`,
  `UserStateChanged`, the app's own directive — with the tool as a fast path,
  never as the mechanism.

##### The candidate picks the language before the call, not in it (decision 2026-08-27)

Reported from the chair: *"why does it speak French?"*

The rule was *"greet in English, then match whatever language their FIRST real
answer is in"*. It was written to stop the interviewer flipping between Arabic,
French and English mid-call, and it did — but it left the CHOICE with the model,
which then made it before the candidate had said anything. The instructions
carry their name and a summary of their CV, so it read those, inferred French,
and greeted somebody who wanted English in French.

**The candidate picks on the page in front of them, before the room exists.**
Asking in the call was built first and rejected the same day: it made the answer
something a model had to hear correctly and act on, when the browser can simply
state it. Deterministic beats usually-right, and there is no reason to spend a
conversational turn on a question a form control answers.

- **The choice rides in on ROOM METADATA**, which is the second thing metadata
  has ever carried and a deliberate exception to "the application id and nothing
  else". That rule exists because LiveKit hands metadata to every participant —
  which is how the confidential topic guide once leaked into the candidate's
  browser. This costs nothing to expose for exactly the reason the id does: it
  came FROM that browser seconds earlier. It is their own choice handed back.
- **It belongs to the ROOM, not the application.** A re-record is a new call, so
  somebody who picked wrong gets to pick again by starting over — and no
  migration was needed to store a per-attempt setting.
- **`InterviewRoomMetadata` stopped being an alias of the screening one.** The AI
  interview has no such choice, and a field its worker never reads would be one
  more thing sitting in metadata that every participant receives.
- **A closed enum on BOTH sides, and this is a security property rather than
  tidiness.** The value is written into the interviewer's own instructions, so
  free text would let a candidate put their own directive in the prompt. The
  action parses it with `callLanguageSchema` and falls back to English on
  anything else; the worker re-checks with `readCallLanguage` because the two
  packages deploy separately. Tests cover an instruction dressed as a language.
  An unrecognised value **falls back rather than failing the call** — a language
  choice is not worth refusing an interview over.
- **The language is repeated on EVERY instruction, not set once** (`speakIn`).
  The questions reach the interviewer in English — that is the language they are
  STORED in — so every turn of a French call pulls it back toward English. The
  greeting, the goodbye and the technical-failure sentence all carry it, or the
  call changes language to say hello or goodbye.
- **`null` stays meaningful**: an older app opening a room without a language
  leaves it unpinned, which restores matching whatever the candidate speaks.
  Right when we do not know; wrong as a default, because pinning English would
  open an interview in a language somebody plainly is not using.
- **The prompt's blanket ban on the subject is back and stronger.** It now says
  the candidate already chose, so the interviewer never raises language at all —
  no asking, no offering to switch, no confirming. The flipping this area exists
  to prevent comes from raising it mid-call.
- This is the same division of labour as the questions: the model keeps the
  wording, the warmth and the accent, and has no discretion over the decision.

##### The greeting asks the audio check and waits (decision 2026-08-25)

The opening turn used to be told to greet **and** ask topic 1, with the worker
stamping topic 1 as that turn ended — the bootstrap that opened the first
question without needing the model to call `next_topic`.

On a live call the model did what those words actually invite:

```
"Hi Abdellah, great to have you here. I can hear you clearly—hope you can
 hear me well too."
```

…and stopped, waiting for the confirmation it had just asked for. **The stamp
fired anyway.** Topic 1 was marked asked without being asked, its sixty-second
clock started on a hello, and the candidate's "yes" was consumed as the answer
to a question nobody had put to them — the same "ledger says covered, transcript
holds nothing" failure that `stampSkippedTopic` was itself built to fix, only
now caused by it.

**An audio check nobody is allowed to answer is not a check.** The greeting is
therefore greeting-only — it asks whether they can hear you and stops — and
topic 1 belongs to the turn AFTER the candidate has spoken.

- **Three things can raise topic 1, in order of preference:** `next_topic` if
  the model calls it; `stampSkippedTopic` if it does not, which now bootstraps
  off the candidate having spoken (the honest signal, and reachable on exactly
  the call that needs it); and `armOpeningNudge` if the candidate never answers
  at all.
- **`OPENING_REPLY_GRACE_MS` (20s) is the one path out of a silent room.**
  Stopping after the check costs the call its old way forward: no topic is open,
  so no answer budget is running and the interviewer will not speak again on its
  own. The nudge opens topic 1 and THEN has the interviewer ask it — that order
  is the point, because opening a topic without asking it is the failure this
  whole area keeps producing. It is generous because the honest reading of
  silence here is somebody fighting a microphone permission dialog.
- **`toolChoice` is gone.** It was never observed to fire on @livekit/agents
  1.5.1 with `gpt-realtime` despite the plugin reporting
  `perResponseToolChoice`, and this turn must not raise a topic anyway.
- **The residual risk is accepted and named:** an interviewer whose second turn
  is a bare acknowledgement ("Great, glad you can hear me!") will have topic 1
  stamped against it. That costs one minute of clock, and the evidence still
  lands — `extractTranscriptEvidence` reads the whole transcript, not one
  answer. It is strictly better than the guaranteed misfire it replaces.

**The call has no clock; each QUESTION has one, and it only ever counts down
(decision 2026-08-25, superseding the speech-triggered scheme and both timing
schemes below).** There is no global call budget. Every question — a primary
topic or a follow-up — gets `SCREENING_ANSWER_BUDGET_MS` (**60s**), armed the
moment the interviewer finishes asking it, and the call ends when its topics are
covered, which the close guard already guarantees.

- **One clock, and it never goes up.** The budget used to start at the
  candidate's FIRST WORD, so thinking time was free and the counter therefore
  **jumped up** when they began speaking — from whatever the silence fallback
  had left to a fresh minute. That was deliberate and it was documented here as
  generous. It is also the first thing a real person watching a real call
  reported as a bug: *"when I speak it returns to 1"*. A timer that runs
  backwards reads as broken however generous it actually is, and a candidate
  mid-interview cannot be told "that's intentional".
- **The cost is real and was accepted.** Seconds spent deciding what to say now
  come out of the answer. A minute absorbs it — the competency answer this stage
  looks for runs 30-45 seconds — and one honest falling number beats two clocks
  that are individually correct and jointly incomprehensible.
- **`SCREENING_SILENCE_BUDGET_MS` is retired**, kept only as an alias. It
  existed because a candidate who never spoke never started the answer clock;
  a budget armed at the question already covers silence, because they simply run
  it out.
- **`answerStartedAt` is still recorded, as evidence, and moves nothing.** How
  long somebody took to start is worth having on the transcript. `applyAnswerStarted`
  therefore writes only that field — a test asserts the deadline is untouched.
- **The clock starts when the question has been DELIVERED, not when it was
  raised.** `next_topic` is called before the interviewer speaks, and an agent
  turn is finalized when its TEXT completes — both run ahead of the audio. On a
  live call the clock armed at `01:13:23` while the interviewer was still asking
  at `01:13:37`: thirteen seconds of the candidate's minute spent listening.
  `AgentStateChanged` leaving `speaking` is the only moment that means "they
  have heard the whole question", so the topic is stamped there.
- **The countdown is VISIBLE to the candidate**, published by the worker over
  the LiveKit data channel (`SCREENING_ANSWER_TOPIC`, `screening.answer`)
  whenever a question is outstanding — **including before they have said
  anything**. It carries REMAINING milliseconds, never an absolute deadline:
  the browser anchors to arrival, so a candidate whose system clock is wrong
  still sees the right number. It is **display only** — the interviewer moves on
  when the worker's timer says so, identically for a candidate whose tab is
  backgrounded and rendering nothing.
- **A deadline the product enforces is one the candidate is entitled to see.**
  The counter was briefly hidden until the candidate started speaking, to keep a
  clock off the pause while somebody decides what to say. That removed the
  *warning* rather than the pressure — the fallback was still a real deadline,
  so a candidate who sat thinking for fifty-five seconds was moved on with no
  notice at all. Do not reintroduce the gate.
- **At zero the interviewer asks the next question** (amended 2026-08-25 — see
  "The minute is the minute" below). The counter reaches 0:00, the label reads
  "Time's up — moving on to the next question", and it does. The 15s grace this
  bullet used to describe — sitting on the expired timer until the candidate
  stopped talking — is gone, along with `SCREENING_ANSWER_GRACE_MS` itself. The
  visible countdown is what makes that fair: nobody is cut off by a deadline
  they could not see coming.

**The countdown died after the candidate's first answer (fixed 2026-08-25).**
It appeared on question one and never came back. The cause was
`beginNextTopic`'s **duplicate-call guard**, and it was a race the guard could
not see:

```
+30.0s  candidate stops -> turn_completed posted (evaluator, 3-5s)
+30.5s  interviewer calls next_topic -> topic_started
        ledger still has topic 1 in_progress, followUpsUsed 0
        -> read as "asked twice for the same topic", swallowed
+34.0s  evaluator lands, settles topic 1 -> answerDueAt: null
        topic 2 was never raised; the tool call is spent
```

The guard exists for a real case — a retried control call must not burn a
second topic on one spoken question. But **the ordinary order is the one it
mistook for a duplicate**: the model calls `next_topic` about half a second
after the candidate stops, and `turn_completed` is an OpenAI round-trip three to
five seconds behind it. So on nearly every hand-off the next topic was never
raised. `answerDueAt` was never re-armed, and while nothing is open both
`applyAnswerStarted` and `applyAnswerTimeout` are no-ops — so the countdown
vanished, the answer had no deadline, and the topic stayed `pending` and scored
the candidate **0** on whatever the rubric graded it against.

`ledger.answerStartedAt` is the discriminator, and it is the whole fix: null
means nothing has happened since we raised the topic (a genuine duplicate,
still handed back unchanged); non-null means the candidate answered and the
interviewer is moving on, so the topic is settled and the next one raised in the
same step. It settles **`complete`**, not `insufficient` — the same call
`applyEvaluatorFailure` makes, for the same reason: they answered, and our
evaluator being slower than the conversation says nothing about what they said.
The verdict still lands moments later and fills the evidence summary through
`annotateSettledTopic`.

The regression test drives the real concurrency through
`applyScreeningControlEvent` against a store that **compare-and-swaps on the
ledger version**, the way `UPDATE ... WHERE topic_state->>version` does. A test
double that accepts every write hides this entire class of bug — the first two
attempts at reproducing it did exactly that and showed a healthy call.

Three smaller repairs shipped alongside it, each a different assumption about
who arms the clock:

- **A skipped `next_topic` took the clock down with it — for the whole call.**
  This is the one a live call actually showed: the candidate's console carried
  three `answer clock {remainingMs: null}` packets and nothing else, start to
  finish. The transport, the worker and the browser were all fine; the app was
  returning `answer_due_in_ms: null` on every response because **no topic was
  ever opened**. The interviewer never called `next_topic` — the same failure
  `deferTopicsToTool` was built for after it called the tool *zero times in 33
  turns*, and withholding the topic list turns out not to be enough on its own.

  It costs the countdown because the clock lives in the same place as coverage:
  `answerDueAt` is only ever set by opening a topic, and while nothing is open
  both `applyAnswerStarted` and `applyAnswerTimeout` are no-ops. So no answer
  had a deadline either.

  **Asking the model to call `next_topic` has now failed three times**, and the
  third attempt is worth recording so nobody spends the afternoon on a fourth.
  The greeting is a `generateReply` the worker controls, so it passes
  `toolChoice: {type: "function", function: {name: "next_topic"}}`. The plugin
  reports `perResponseToolChoice: true`, so this should bind that one response
  — and on a live call it **did not fire**: that very response ran
  `performToolExecutions` and called nothing. The line is kept because it is
  correct as written and costs nothing if a later SDK honours it, but **nothing
  may depend on it**. (A session-wide toggle is not available either:
  `AgentSessionUpdateOptions` carries no `toolChoice`.)

  What actually opens topic 1 is the stamp below, fired the moment the greeting
  finishes. That path needs no cooperation from the model at all, which is the
  only property worth having here.

  The worker notices an interviewer turn ending with a primary question
  outstanding and no timer armed, and stamps `topic_started` itself —
  `shouldStampSkippedTopic` in `agents/screening/src/control.ts`, pure and
  tested. **The bootstrap condition is `openingTurnComplete`, and that choice is
  the whole subtlety.** The obvious gate — "a topic has been opened properly at
  least once" — was written first and is unusable: if the tool is never called,
  no topic is ever opened, the condition is never met, and the repair never
  runs. It is a safety net for a failure that cannot happen, and it shipped
  once. Past the opening turn the same situation can only mean the interviewer
  asked without announcing. *During* it, an interviewer that greets and waits
  looks identical, so nothing is stamped there.

  **It also requires the turn to have ASKED something** (`lastTurnWasQuestion`,
  2026-08-25). Every interviewer turn ending with a primary question
  outstanding used to stamp a topic — bridges and acknowledgements ("That's
  okay.", "Thanks for that.") included. Each one burns a topic: marked asked,
  never asked, scored 0. The asymmetry decides it — a stamp MISSED is
  recoverable, since the topic stays outstanding, the next turn that does ask
  something stamps it, and the scorer reads the whole transcript anyway; a
  stamp made IN ERROR is not recoverable at all, because that topic is spent
  and nothing will ever put its question to the candidate.

  **`openingTurnComplete` is "the candidate has spoken", and nothing else
  (decision 2026-08-25).** It used to also accept "the greeting turn has
  finished", which made the guard vacuous — the greeting IS the opening turn,
  so the one turn the condition exists to exclude was the one it stamped, on
  every call. See the next section for what that cost.

  Fixing this in `reconcileAddressedTopic` instead was tried and reverted: it
  runs *after* the answer it was meant to time, so every path out of it either
  sets its own clock or clears one.
- **A follow-up never started the answer budget.** A follow-up is asked with no
  tool call, so the only response that re-arms is `turn_completed` — a 3-5s
  evaluator round-trip the candidate routinely starts talking inside.
  `UserStateChanged` had already fired and does not fire again until they stop,
  so `answer_started` was never sent and the follow-up ran on the *silence*
  fallback: the number never jumped up at the first word, and a long answer
  could time out mid-sentence. Arming a clock now re-checks `session.userState`
  and reports the onset if they are already speaking.
- **One packet per question, never re-sent.** LiveKit does not buffer data for
  anyone not in the room at the instant of the send, so a browser reconnecting
  after a blip, still finishing its join, or simply dropping the packet lost the
  countdown outright — and the next send was a whole question away. The worker
  re-publishes every 5s while a clock is armed. That heals reconnects, late
  joins and dropped packets with one mechanism, and each repeat doubles as a
  drift correction because the browser anchors to arrival. Heartbeats are not
  logged; only state changes are, so the log stays readable.

**The clock may only start once the question has been DELIVERED (2026-08-25).**
Both obvious trigger points run ahead of the audio the candidate is listening
to: `next_topic` is called *before* the interviewer speaks, and an agent turn is
finalized when its TEXT completes. On a live call the clock armed at `01:13:23`
and the interviewer was still asking at `01:13:37` — **thirteen seconds of the
candidate's minute spent on the interviewer's own airtime**, against a screen
that says the minute starts when they begin speaking.

`AgentStateChanged` leaving `speaking` is the only moment that means "they have
now heard the whole question", so the topic is stamped there. Two rules follow:

- **Candidate speech while the interviewer is talking never starts the budget.**
  It is an interruption, a backchannel, or an answer to the greeting — not the
  start of an answer to a question they have not finished hearing. This was a
  real regression from the "already speaking" repair: a candidate who talked
  over the greeting had their onset stamped before the question existed.
- **It is picked up again the instant the interviewer stops.** Somebody talking
  over the tail of a question still gets their full minute, measured from there.

The same transition is what lets the stamp bootstrap: the first time the
interviewer stops speaking, the opening turn is over by definition.

**The counter is also HELD off the screen for the whole of any interviewer turn
(2026-08-25).** A clock ticking at the candidate while it is not their turn is
the screen disagreeing with the call, and it reached a live call from two
directions:

- **A follow-up re-arms the budget from `turn_completed`,** which lands about
  two seconds after the candidate stops — while the interviewer is still asking.
  This is the same "clock started before the question was delivered" bug the
  stamp fixed for primary questions, and it had simply never been fixed for
  follow-ups: they raise no topic, so they pass through no stamp.
- **The last question's held-open minute** keeps running through the
  interviewer's closing turn, so the counter sat on screen underneath it.

`holdClockWhileSpeaking` / `releaseClockAfterSpeaking` own both, and **held
means PAUSED, not merely hidden.** Hiding alone still let the interviewer's own
airtime drain the budget: a ten-second closing turn took ten seconds off a
candidate's last answer, so a minute barely touched came back reading thirty
seconds. The timer is stopped for the duration and re-armed with exactly what
was left, so the clock still only ever counts down and never advances during a
turn that was not theirs. It is the same principle that arms a primary
question's clock at delivery rather than when it was raised, applied mid-clock.

Two things follow, and both are load-bearing:

- **`startAnswerTimer` is the only place a running answer clock is created**, so
  the app's number and a released pause cannot drift into different behaviours.
  It owns the "not over the interviewer's voice" rule for both.
- **A paused clock is still the candidate's time**, so `answerClockLive()` — not
  `answerTimer !== undefined` — is what the close guard, the skipped-topic stamp
  and the held-open last minute all read. A pause is the interviewer talking
  over their budget, not the budget ending.

The release runs ahead of every early return in the `AgentStateChanged` handler
— a held counter must come back whatever else that turn also settled or closed.

A fourth, smaller one: a response reporting an **already-expired** budget
published nothing and armed nothing, having just cleared the outstanding timer
— leaving the counter frozen at 0:00 with no "time's up" line and the topic with
no deadline left. It now publishes `(0, expired)` and settles once,
`expiredSettleFired` stopping a run of zero-valued responses from re-firing.

A single clock over a whole call was a guillotine in every version it had. The
cost of a slow first answer was paid by the LAST topic, which went unasked and
scored the candidate **0** on whatever the rubric graded it against — a penalty
for someone else's pacing. Stretching the clock (10 min) and shrinking it (5
min) both moved that penalty around instead of removing it. A per-answer budget
puts the cost of a rambling answer on that answer, where it belongs, and it
structurally cannot reach the topics behind it.

- **~~It never cuts anyone off mid-word.~~** Superseded 2026-08-25 — see "The
  minute is the minute" below. The budget expiring used to wait for the
  candidate to stop talking before moving on; it no longer waits at all. The
  reasoning below stands for the SHAPE of the budget — one clock per question,
  falling only — but not for what happens when it reaches zero.
- **The interviewer is told explicitly NOT to manage time.** It is the one
  participant that cannot perceive it, and every instruction that asked it to
  produced hurrying — a candidate rushed through an answer to protect a budget
  the app was already protecting for them. The prompt no longer quotes any
  duration at all; `realtime.test.ts` asserts that.
- **`SCREENING_CALL_BACKSTOP_MINUTES` (30) is a failure bound, not a duration.**
  Nothing quotes it, nothing displays it, and a behaving call never approaches
  it. It exists for the worker that dies mid-call and the tab abandoned in an
  empty room, both of which otherwise bill a Realtime session by the minute
  forever. It is 30 because eight topics with a follow-up each is sixteen
  questions, each of which may spend its minute AND its grace — twenty-four
  minutes before the interviewer has said a word. A bound below the worst
  legitimate case would start cutting real calls, which is the thing being
  removed.
- **This retired the `MAX_SCREENING_CALL_MINUTES <= INTERVIEW_DURATION_MINUTES`
  invariant.** That bound said the cheap filter must not outrun the deep stage,
  and it was right while screening had a fixed length. It no longer has one: the
  EXPECTED call is `screeningCallEstimateMinutes` (topics + 2, floor 5 — about
  seven minutes at five topics, still well under the interview), and the
  backstop is a failure bound. Asserting one against the other would compare two
  different kinds of thing and force the safety net below the point of being one.
- **The estimate is copy and enforces nothing.** It appears in the invitation
  email and on the pre-call screen so nobody starts a call not knowing what they
  are agreeing to. Before this, ONE function fed both the copy and the hard cut,
  so "about 5 minutes" was a promise and a threat in the same sentence.
- **An eight-topic rubric is a twenty-minute conversation in the worst case.**
  That is the honest read of the arithmetic above, and the remedy is fewer
  topics — the same one `checkScreeningQuestionCoverage` already pushes.

`answer_started` and `answer_timeout` are the fifth and sixth control events.
`applyAnswerStarted` starts the clock — idempotent per question, and a no-op
when no topic is open, so speech over the greeting starts nothing.
`applyAnswerTimeout` settles the
open topic on the evidence it already has (`complete` if any, `insufficient`
otherwise) and advances. It is deliberately a **no-op** when nothing is
outstanding: the worker's timer and the evaluator race constantly, and a
timeout able to settle a topic nobody was answering would cut the NEXT question
short.

**The five-minute flat call it replaced (decision 2026-08-24, superseded same
day):** `MIN_SCREENING_CALL_MINUTES` and
`MAX_SCREENING_CALL_MINUTES` are both **5**, so `screeningCallMinutes` returns a
flat five whatever the topic count. The range described below was correct for
the world it was written in and is kept because the reasoning still explains the
shape of the code — but the lever it depended on has been replaced.

The stretch existed because a flat five was a **guillotine**: nothing tracked
what had actually been asked, so a call that ran out of time died mid-sentence
and every unraised topic scored the candidate 0 on whatever the rubric graded it
against. Widening the clock was the only remedy available. Runtime topic
coverage is a better one — the wrap-up reserve stops probing and raises whatever
is left, and the close guard refuses to end the call while anything is `pending`
— so the call now fits its topics by covering them faster rather than by running
longer.

What is given up is **depth**, and it is a real cost: five minutes minus the
60-second reserve is four minutes of interviewing, roughly 48 seconds a topic at
five topics and about 30 at the eight-topic ceiling. At the top of that range
follow-ups will be scarce. The remedy is fewer topics, which is the same thing
`checkScreeningQuestionCoverage` already pushes. `screeningCallMinutes` stays a
function and the two constants stay separate, so restoring a range is one line.

**The rubric-sized range it replaced (decision 2026-08-24, superseded same day):**
`screeningCallMinutes(topicCount)` in `src/lib/constants.ts` — ~1.2 minutes a
topic plus two of overhead, clamped to **5-10**. Three things read it and must
never disagree: the client's hard cut (`voice-screening.tsx`), the length quoted
to the candidate (the pre-call copy **and** the invite email), and the pacing
`buildScreeningInstructions` gives the interviewer.

It was a flat **5** in all three places, and that was a guillotine rather than a
target. The question set is sized from the rubric
(`screeningQuestionCountForRubric`, 3-8) while the cap was not, so five minutes
fitted three topics and cut eight off half-finished — and an unreached topic
leaves its rubric dimension with no evidence, scoring the candidate **0** on it.
The prompt made it worse by asking for 1-2 follow-ups on every topic: at the
ceiling that is 24 exchanges in 300 seconds.

- **A function, not a constant, because one number cannot honestly serve the
  range.** A flat ten would quote a ten-minute call to someone facing three
  questions — a promise that costs completions at the top of the funnel.
- **The ceiling is `MAX_SCREENING_CALL_MINUTES` (10) and must never exceed
  `INTERVIEW_DURATION_MINUTES`** (asserted in `constants.test.ts`): screening is
  the cheap filter, the AI interview is the deep stage, and a screen that outran
  the interview would have the funnel upside down. Where the clamp bites, the
  instructions tell the interviewer to **drop the follow-up, never the topic**.
  A recruiter wanting more depth per topic should trim the rubric — the same
  remedy `checkScreeningQuestionCoverage` already pushes.
- **The cap is a backstop, not the expected length.** The interviewer is told to
  stop as soon as it has covered everything and never to pad, so the headroom
  costs nothing on a normal call.
- **The invite email was fixed in the same change.** It still described the
  typed form #161 deleted — "15-25 minutes to complete them", a button reading
  "Answer the questions" — so a candidate budgeted twenty minutes of typing and
  landed on a live call needing a microphone and a quiet room.

##### The worker is one finite state machine (refactor 2026-08-27)

The push protocol below is unchanged — the app still decides every question and
the worker still only speaks it. What changed is **how the worker holds its own
state**: `agents/screening/src/machine.ts` is now the single source of truth for
the conversation, and `agent.ts` is only the adapter into it.

Seven states (`IDLE`, `GREETING`, `ASKING`, `LISTENING`, `FINISHING`, `DONE`,
`FAILED`), one `turnOwner`, one **pure reducer**, and one **synchronously
drained event queue**. Every asynchronous source — LiveKit session events,
timers, backend replies — is converted into an `InterviewEvent` and enqueued; a
callback may record what only it can observe, and may not decide.

- **The problem it solves is not a missing feature, it is concurrency.** The
  worker kept its state in a dozen loose booleans (`windingDown`,
  `awaitingGoodbye`, `goodbyeInterrupted`, `clockArmPending`, `budgetExpired`,
  `agentSpeaking`, `degraded`) each written from whichever callback happened to
  observe the thing it described. Callbacks fire concurrently, so "the state"
  was whatever combination a given interleaving produced — and every bug in
  this worker's history is a combination nobody had enumerated. They are now
  either in the transition table or unreachable.
- **`turnOwner` is what makes "never interrupt the candidate" checkable.** The
  agent speaks only while it is `"AGENT"`. A question decided while the
  candidate is still talking is held in `pendingQuestion` and asked on
  `CANDIDATE_SPEECH_STOPPED`, bounded by `SPEAK_HOLD_MS`. The one exception is
  `budgetExpired` — holding a question until they pause is exactly the grace
  "the minute is the minute" removed.
- **`openingQuestion` is a separate field from `pendingQuestion`, and it has to
  be.** Both are questions the machine is holding, but they are asked on
  different signals: a deferred question the instant the candidate pauses
  (their answer was already banked), the opening question only once the audio
  check has SETTLED. Sharing one field gave topic 1 the deferred trigger, which
  asks the first real question over a candidate who said "yes —" and kept going.
- **The goodbye waits for a pause, exactly like a question does** (reported from
  the chair: *"while speaking it submits"*). The close branch used to enter
  `FINISHING` the instant the directive arrived, with no check on who held the
  floor — while the question branch immediately below it checked. So the
  ORDINARY end of a call cut people off: the candidate answers the last
  question, pauses, `turn_completed` goes out, the evaluator takes its three to
  five seconds, the candidate resumes ("…and yeah, that's basically it"), the
  `close` directive lands, and the sign-off plays over the top of them. Their
  speech cancels it, the one redelivery is spent, and `screening.finished`
  publishes mid-sentence — and since the browser submits on that packet and the
  server finalizes from the reported draft, whatever they were saying reaches no
  transcript at all. `pendingClose` holds the ending until they stop.
- **`budgetExpired` does NOT override that wait, and this is the one place it
  does not.** It exists so running out of time cannot delay the NEXT QUESTION,
  because delaying that is the grace period the visible countdown promises does
  not exist. At the close there is no next question: nothing is delayed but the
  ending of a call that is already over.
- **`CLOSE_HOLD_MS` (20s) is longer than `SPEAK_HOLD_MS` (10s)** for the same
  reason — a held question delays the interview, a held goodbye delays nothing.
  Both are bounded, because a candidate who never stops would otherwise hold the
  room open, give up on a screen that looks frozen, close the tab, and be
  rejected by the expiry sweep for an interview they actually sat.
- **`LISTENING` has exactly one timer.** `questionDelivered` — set by
  `QUESTION_FINISHED` and nothing else — decides whether it is the candidate's
  minute (with the visible countdown) or the silence watchdog (without one).
  Both expire into `ANSWER_TIMER_EXPIRED`. The app's `wait` directive re-arms
  the WATCHDOG, never a second minute: their budget was already spent.
- **There is no improvisation and no kill switch.** `SCREENING_TOPIC_CONTROL`
  and the `improvise` move are gone. The switch's off position restored
  `create_response: true` and handed the call back to the model's own topic
  guide — which is the failure mode, not the fallback: an interviewer choosing
  its own questions holds a normal-sounding conversation that evidences no
  rubric dimension, so the candidate is scored 0 across the board and nothing
  in the record says why. A kill switch whose off position reinstates the bug
  is not a safety measure. An unusable directive now reaches `FAILED`, which
  says one short technical sentence and closes the room; the recruiter re-sends
  the link.
- **`FAILED` is nearly terminal, with exactly one edge out.** `GOODBYE_FINISHED`
  carries it to `DONE`. Without that the room sits open until the half-hour
  backstop, the browser is never told to submit, and the expiry sweep rejects a
  candidate for an interview they actually sat.
- **`shouldRedeliverGoodbye` moved into the reducer** — same decision (an
  interrupted goodbye is not a goodbye; say it again, exactly once), now a field
  of one state rather than two booleans two callbacks write. `decideNextMove`
  keeps its `wait` move, which is deliberately NOT an error: the ledger reports
  `ask_follow_up` for any open topic, including the seconds before a candidate
  draws breath.
- **`BACKEND_RESPONSE` carries a `kind`.** It is the one field added to the
  event shape, and it is load-bearing: a primary question is reported to the app
  as `topic_started` (which stamps `askedAt`, and is therefore what "this topic
  was covered" means) and a probe must not be, or every follow-up burns a topic
  nobody asked.
- **The app's API is untouched.** Same routes, same events, same wire shapes —
  only how the worker calls them changed.

##### The app pushes the conversation; the interviewer only speaks it (decision 2026-08-25)

**`create_response: false`.** The screening worker's Realtime session no longer
lets OpenAI start a turn. Nothing is said on a screening call unless the worker
asked for it with `generateReply`, and the worker only ever asks for the
question the app's directive named. The call is one loop:

```
greet -> candidate speaks -> POST turn_completed -> the app names the next
question -> generateReply(it) -> POST topic_started -> arm the candidate's
minute -> ... -> directive `close` -> generateReply(goodbye) -> wind down
```

**Everything below this section describes the PULL protocol it replaces, and is
kept for the reasoning rather than the facts.** The mechanisms named there —
`next_topic`, `end_interview`, `stampSkippedTopic`, `takeBackWrongStamp`,
`shouldCountFollowUp`, `decideClose`, `closeSettleMs`, `needsSpokenGoodbye`,
`heldClockSurvivesTurn`, `grantsClosingMinute`, `closeOnUnreachableApp`, the
`CLOSE_*_SETTLE_MS` windows and the `INTERVIEW CONTROL` block — **no longer
exist in the worker.** The app-side ledger is unchanged.

- **Every one of them existed to observe and correct a second controller.** With
  auto-reply on, the model chose when to speak, what to ask and when to stop, so
  the worker had to infer all three from session state after the fact. Remove
  its ability to speak unbidden and there is nothing left to infer: it cannot
  raise an unannounced topic, so nothing has to guess which one; it cannot
  improvise a probe, so nothing has to detect one; it cannot trail off instead of
  saying goodbye, because the worker asks for the goodbye.
- **This is the fourth attempt at the same problem and the first that worked.**
  The prompt was reworded, the tool protocol was moved to the top, the topic
  list was withheld, and `toolChoice` was pinned per response. The model called
  `next_topic` zero times in 33 turns through all of it. A Realtime model will
  not reliably call a tool because it was asked to — but it also cannot ignore
  a turn it was never allowed to start.
- **The worker now owns the answer clock, reversing the old rule that its
  `ANSWER_BUDGET_MS` was "a number to display, never a deadline".** That rule
  existed because the app armed the deadline when it opened a topic — which is
  before the question is spoken, so the candidate's minute started while they
  were still listening (thirteen seconds, on one call). Only the worker can see
  when an asking turn ended. The DURATION is still single-sourced from
  `SCREENING_ANSWER_BUDGET_MS` and pinned by a test; the app's `answerDueAt`
  stays as a record and enforces nothing. `topic_started` is also posted AFTER
  the question is asked, so `askedAt` means what it says.
- **The topic list is withheld from the prompt again** (`withholdTopics`),
  restoring docs/voice-screening.md mitigation #2. Withholding was tried under
  the pull protocol and was a disaster — the model invented a whole interview —
  but that failure required it to be able to start a turn. An interviewer with
  nothing to ask now says nothing, which a watchdog recovers, rather than making
  something up. The fallback guide (`buildScreeningTopicFallback`) survives for
  a worker that loses the app mid-call, and is the only circumstance in which
  this interviewer chooses its own questions.
- **Silence is the failure this buys, and it is the only new mechanism.** If the
  worker does not speak, nothing will. `SILENCE_NUDGE_MS` (20s with no answer
  clock running) posts `answer_timeout` and advances — which also covers an
  unanswered greeting, since `applyAnswerTimeout` is a no-op with nothing open
  and the directive comes back "ask topic 1". `SPEAK_BACKSTOP_MS` (45s) bounds
  one turn, because `generateReply` resolves on playout and the drive chain is a
  single lane: a hung reply would otherwise stop every later turn, every answer
  timeout, and the watchdog itself.
- **The close waits for an answer already spoken (`createFinalAnswerBarrier`).**
  Speech and transcription are two different events. `onInputSpeechStopped`
  fires when the candidate stops; the finalized `ConversationItemAdded` lands
  later, and only then is the answer in the transcript and queued for
  reporting. Anything closing in between publishes `screening.finished` over a
  draft missing the last thing they said — and since the browser submits on
  that packet and the server finalizes from the draft, nothing recovers it.
  - **The ordinary path was never exposed**: the transcript item is what posts
    `turn_completed`, so a `close` directive cannot exist before the item that
    produced it. **The answer timeout is**, because it advances the ledger from
    a timer that knows nothing about a transcript in flight.
  - The barrier opens on speech, closes on the finalized item, and is awaited
    before the goodbye, before the timeout may settle a topic, and again in
    `windDown` as a backstop. A timeout whose answer turns up **stands down**
    rather than settling the topic a second time.
  - **`FINAL_TURN_SETTLE_MS` (8s) bounds it.** Waiting forever is the
    mirror-image failure — the candidate sits on a finished call, closes the
    tab, nothing submits, and the expiry sweep rejects them for an interview
    they sat. Giving up logs `screening.worker.final_turn_unsettled` with the
    application id, and records both halves of the fact: speech WAS observed,
    the transcript was NOT. Those need different investigations.
- **An interrupted goodbye is not a goodbye (decision 2026-08-25).**
  `generateReply` resolves on a CANCELLED playout exactly as it does on a
  completed one, so its returning meant "the sign-off stopped", not "the
  sign-off was delivered". With `interrupt_response: true`, a candidate who
  starts talking over it cancels the turn — and on a live call the room shut
  120ms later:

  ```
  21:17:59.296  the goodbye starts playing
  21:18:01.369  the candidate begins talking over it
  21:18:01.370  response cancelled, reason=turn_detected
  21:18:01.488  generateReply resolves -> wind down
  21:18:01.49   screening.finished published, browser submits
  21:18:01.894  candidate disconnects, still mid-sentence
  ```

  From the chair that is the product hanging up on you, and whatever they were
  saying reached no transcript at all. The worker now hears them out
  (`finalAnswer.wait`), says goodbye ONCE more, and only then winds down —
  `shouldRedeliverGoodbye`, bounded at one retry with `GOODBYE_BACKSTOP_MS`
  outside it.
- **The barrier opens for speech during the CLOSE, not only during an answer.**
  Gating it on the answer clock excluded the one case that actually fired: the
  clock is deliberately stopped for the close, so somebody talking over the
  sign-off opened no barrier and the room shut before their item arrived.
- **A transcript is attributed to the question that was on the floor when the
  candidate STARTED speaking**, not when the words came back. Reading the
  sequence at arrival was a real hole in `questionSeq`, not a theoretical one:
  a late item from a topic that had already timed out arrives once the next
  question has been asked, at which point the arrival-time sequence matches the
  current one, the guard waves it through, and one answer is graded against a
  question the candidate had not yet heard.
- **A redelivered `ConversationItemAdded` is dropped by item id.** The app is
  idempotent on `event_id`, but the worker's `turns` array is not — a duplicate
  would show the answer twice in the transcript the scorer reads.
- **`turn_completed` is now on the audio path**, which is the honest cost. The
  evaluator's 3-5s round-trip used to hide behind the model's instant auto-reply
  and is now silence the candidate hears between their answer and the next
  question. The reply to the audio check is exempt — it is not an answer to
  anything, and that latency would land at the worst possible moment.
- **A queued report is dropped if the call has moved past the question it
  belongs to** (`questionSeq`). The race is routine: a candidate who over-runs is
  given their grace, `answer_timeout` settles the topic and the next question is
  asked, and only then does their final fragment finish transcribing. It costs
  the evidence summary on that answer — the topic was already settled — where
  the alternative is grading it against a question they had not heard.
- ~~**The kill switch restores auto-reply in the same move.**~~ **Retired
  2026-08-27 with the FSM refactor** — see the section above. The reasoning here
  was sound as far as it went (a state where nothing pushes and nothing
  auto-replies is a permanently silent room) but it took the wrong exit:
  `SCREENING_TOPIC_CONTROL=0` set `create_response: true` and handed the
  conversation back to the model, so the switch's off position reinstated the
  second controller this whole design exists to remove. Silence is now answered
  by the watchdog and by `FAILED`, both of which keep the app in charge.
- `SCREENING_PROMPT_VERSION` is `sc-v6`. The app still accepts `close_requested`,
  `follow_up_asked` and a `stamped` topic flag, because **workers deploy before
  the app** and an older one mid-rollout still speaks the old protocol. Nothing
  new should send them.

##### A finalized turn is not a finished answer (decision 2026-08-25)

Reported from the chair, mid-QA: *"it doesn't let me finish the answer"* — with
**time still on the counter**, which is what rules out the budget and points at
turn detection.

Turn detection runs on OpenAI's server-side VAD, so a beat of silence mid-answer
ends the turn and lands a finalized `ConversationItemAdded`. Under the push
protocol that item is the event that drives the entire call: the worker posts
`turn_completed`, the app settles the topic on what it has, and the next
question is asked. **So a detector that reads a thinking pause as an ending does
not merely interrupt somebody — it spends their topic on half an answer**, and
the rubric dimension behind that topic is then graded on the fragment they had
reached.

`eagerness: "low"` was the first attempt and is not enough on its own: it tunes
how long the DETECTOR waits, and the detector is reading one utterance rather
than deciding whether an ANSWER is over. Two additions finish the job, and both
are the worker declining to act for a moment:

- **The answer is held** (`ANSWER_SETTLE_MS`, 3s, `SCREENING_ANSWER_SETTLE_MS`
  to tune, `0` to switch off). If they start again inside the window it was one
  answer all along — `createAnswerAssembly` joins the fragments, the window is
  re-armed by each one, and nothing was spent. Their clock keeps running
  throughout, because it is still their minute, and **the budget expiring
  flushes the held answer as a `turn_completed` rather than an
  `answer_timeout`** — they answered; only the hold was still open.
- **The interviewer never starts a turn over the candidate** (`SPEAK_HOLD_MS`,
  10s). The window cannot cover the whole race: the evaluator is a
  three-to-five-second round trip, so somebody who resumes while it is in flight
  has already had their topic settled, and the worker would come back with a
  question and put it over the top of them. It costs more than rudeness —
  `interrupt_response` is on, correctly, so speaking across them gets the
  question CANCELLED partway through and the clock is then armed on a question
  they only half heard.

- **`flushAnswer` is the one place a turn becomes a `turn_completed`**, so the
  two things that can decide an answer is over — the window elapsing, the budget
  running out — cannot report it twice or report half of it. Pinned by a test.
- **The greeting reply is held, but for a second rather than three (revised
  2026-08-27).** A candidate who says "yes —" and keeps going must not be asked
  topic 1 over the top of themselves, so the hold stays — but "can you hear me?"
  is answered in one word, and the window an interview answer needs is pure dead
  air at the very top of the call. Reported from the chair as a delay after
  *"do you hear me"*, and it was about five seconds all in: this hold, plus
  transcription, plus the model generating the first question. A candidate who
  has just joined cannot tell a thinking interviewer from a broken one, and this
  is the moment they are most likely to decide it is broken.
  `greetingSettleMs` takes the SMALLER of the two, so switching the hold off
  switches it off everywhere and lengthening it for interview answers does not
  lengthen the one pause where a longer hold buys nothing. It still skips the
  evaluator: it is not an answer to anything.
- **A fragment is keyed on the question that was on the floor when they started
  speaking**, and one for a question the call has left behind starts a fresh
  answer rather than being appended — the same hazard `questionSeq` guards
  everywhere else.
- **The cost is dead air on every answer**, this window and then the evaluator
  behind it, and it is the honest price of not cutting people off. It is bounded
  from both ends: the hold can never outlive the question, and the override is
  clamped to 10s so a typo cannot turn a call into silence.
- **The budget is untouched at 60s.** The complaint was not that the minute was
  short; the counter still had time on it.
- **A pause no longer ends a barely-started answer; the candidate does
  (decision 2026-08-27).** A fixed window asks whether the UTTERANCE is over,
  and the ANSWER was being treated as over with it: somebody who said "I don't
  know." and paused to think had their topic settled on three words, with
  fifty-five seconds still showing on their screen. That is the counter
  promising a minute and a three-second pause spending it.

  `answerHoldMs` returns **`null`** below `SUBSTANTIAL_ANSWER_WORDS` (12) — no
  early settle at all, their countdown carries the answer and the budget
  expiring flushes whatever is held — and the ordinary window above it, so a
  normal call stays snappy. Re-read on every fragment, so somebody who opens
  with "Hmm." waits on their clock and drops to 3s the moment they have actually
  answered. The interviewer is forbidden from asking anything answerable with
  yes or no, so a handful of words is the START of an answer, not a short one.
- **That default is only affordable because of the "I'm done" button**
  (`SCREENING_DONE_TOPIC`, the one packet that travels browser → worker).
  Without it, somebody who genuinely finished in eight words sits through fifty
  seconds of unskippable silence watching a counter — and a screen that looks
  frozen is what makes people close the tab on a call that is nearly over. With
  it, the generous default costs nobody anything: a pause is never read as an
  ending, and anyone who has actually finished says so.
  - **It carries no content and could not be trusted with any.** The transcript
    is what the worker reported and the app decides every question, so the most
    a forged packet can do is end the sender's own answer early — which is the
    button's entire purpose.
  - **Best-effort.** If the packet never lands, the countdown runs to zero and
    the call moves on by itself, so a failure is a slower answer rather than a
    lost one. Nothing is surfaced to the candidate.
  - **Pressing it with nothing transcribed yet posts `answer_timeout`, not an
    empty turn.** That path already waits on the final-answer barrier, so words
    still in transcription are reported rather than lost.
  - **The button returns on a fresh minute, keyed on the number going UP.** The
    clock heartbeat re-sends the same value every five seconds, so keying on a
    packet merely arriving put the button back mid-answer, seconds after it was
    pressed.
- **This made a latent duplicate-report bug reachable, and it is now closed.**
  `ANSWER_TIMER_EXPIRED` while `awaitingBackend` used to return a CHANGED state
  (setting `budgetExpired`), and the side-effect pass — which is what posts —
  runs on any change. Two presses, or a press racing the budget, would have
  posted twice for one answer and come back as two questions, the second asked
  over the first. It now returns the state UNCHANGED, and the identity is the
  guard: the runner skips side effects when nothing moved. What is given up is
  bounded — a question arriving while they are still talking is held politely
  for up to `SPEAK_HOLD_MS` even though their minute has run out.

##### An answer we could not hear is counted, not scored as silence (decision 2026-08-28)

Found by reading production: **84% of every screening ever scored came out 0**,
and on 12 of 24 rubric-era calls the transcript held FEWER answers than the
interviewer asked questions. The clearest one is a whole call in four lines:

```
[0] AGENT: Hi Abdellah, can you hear me clearly?
[1] CANDIDATE: Yes.
[2] AGENT: <question 1>
[3] AGENT: "Merci pour ta réponse."   <- thanks for an answer that IS NOT RECORDED
[4] AGENT: goodbye
```

The candidate answered. The interviewer heard it and thanked them for it. The
transcript has nothing, so `extractTranscriptEvidence` honestly reported
`not_present` for every rubric dimension and the call scored **0**.

**The scoring was never at fault, and this is worth stating plainly because the
number looks exactly like a scoring bug.** Driving a real transcript through the
live pipeline scores it correctly — `very_strong` 100 × 0.6 + `strong` 80 × 0.4
= **92**, every quote verified against the candidate's own speech. The rubric
path has been live and correct since 2026-08-24. What failed is upstream of it.

**The cause is that the interviewer and the record come from two different
places.** OpenAI Realtime is speech-to-speech: the model understands the audio
NATIVELY, so the conversation carries on perfectly whatever else breaks. The
TEXT comes from a separate transcription sidecar (`gpt-4o-mini-transcribe`, the
plugin default), and when that fails the plugin logs an error and emits an
**empty** transcript — which `ConversationItemAdded` drops on `if (!text)
return`. Silently: no log, no counter, nothing that distinguishes it from a
candidate who said nothing.

- **The barrier already knew, and threw it away.** `createFinalAnswerBarrier`
  holds the only state that can tell "they said nothing" from "we failed to hear
  them" — speech observed against words arrived — and its own comment said *"A
  previous question's turn never arrived"* at the exact point of the loss. It
  now books that as a `LostAnswer` and warns `screening.worker.answer_unheard`
  with the application id. No new module: a second one tracking the same state
  is how the two drift.
- **The detection point is race-free, and that is why it is trusted.** Every
  path that could leave a transcript legitimately in flight has already been
  awaited by the time the candidate answers a NEW question — the timeout waits
  on this barrier before settling a topic, and the ordinary hand-off is driven
  BY the transcript item itself. So an outstanding older question at that moment
  is genuinely lost, not merely late.
- **It is counted per CALL, never attributed to a topic.** The worker only
  learns an answer was lost once the call has moved on, so `currentTopicId` by
  then is the wrong topic — and a stamp made in error is the one kind of mistake
  this area has twice learned nothing downstream can undo. `unheardAnswers` on
  the ledger is the honest unit.
- **`answer_unheard` is not a quieter `answer_timeout`.** That one says nobody
  spoke in the time allowed — a fact about the candidate. This says somebody DID
  and we lost it — a fact about us. They produce the same 0 and demand opposite
  readings of it.
- **It settles nothing, advances nothing, and touches no clock.** Writing our
  own outage onto a candidate's coverage record is the thing
  `applyEvaluatorFailure` already refuses to do; this follows the same rule.
  Fire-and-forget at the worker, because a candidate is mid-conversation and a
  report about a lost answer is not worth a round-trip of their time.
- **The recruiter is told before they read a number.** An amber notice sits
  ABOVE the rubric breakdown, says the score may be understated, says the
  failure is ours and not the candidate's, and points at the transcript or a
  fresh link — never at a rejection on a score we have just called unreliable.
- **It is a diagnostic and never an input.** Nothing in
  `src/lib/screening-scoring/` reads it, and no rule branches on it.

The count does **not** repair the score, and deliberately so: the words are gone
and inventing evidence for them is the one thing worse than the 0. What it buys
is that a 0 can no longer quietly mean two opposite things.

##### The minute is the minute (decision 2026-08-25)

Stated from the chair, as the rule: *"if that 1 min finished we move to the next
question, that is it."*

It did not. The budget expiring **armed a second timer** and sat on it until the
candidate stopped talking — `SCREENING_ANSWER_GRACE_MS`, 15s. So the deadline
the counter had been showing for a minute was not a deadline: a candidate still
going at zero got a quarter of an answer more than one who finished at 0:59, and
the person handed the extra time was by definition the one who had already used
all of theirs.

**Zero now moves the call on, whoever is talking**, and both halves of the wait
had to go or the grace comes back under another name:

- **The grace timer is deleted**, along with `moveOnPending`,
  `ANSWER_GRACE_MS` and `SCREENING_ANSWER_GRACE_MS`. A constant naming a rule
  that no longer exists is worse than no constant — the same reason
  `is_required` was dropped and Must-Have left the interview stage. A worker
  test asserts the app exports no grace, so it cannot come back on one side
  alone.
- **`budgetExpired` stands the politeness down.** The worker otherwise never
  starts a turn over the candidate (`SPEAK_HOLD_MS`), which is right for an
  answer that ended by itself and is exactly the removed wait when applied to an
  expiry. Set before the flush branch too: a held answer at zero is still an
  expiry.
- **It waits for words already SPOKEN, never for words not yet said.** The
  timeout is the one path where a timer rather than a transcript item moves the
  call on, so an answer finishing transcription can be outrun — they stopped at
  0:59, the item is milliseconds away, and posting a timeout over it would
  record a topic they answered as one they did not. A candidate **mid-sentence**
  at zero has nothing in flight, so that case skips the barrier entirely. Their
  words are not lost either way: every finalized item joins the transcript the
  scorer reads, whenever it lands.
- **The screen was changed in the same breath.** "Time's up — finish your
  thought and we'll move on" was an instruction the call no longer honours; it
  now reads "Time's up — moving on to the next question". A countdown that lies
  at zero is worse than either being strict or being generous.
- **What makes this fair is the counter, and only the counter.** The candidate
  watches the minute fall for its whole length, so nobody is cut off by a
  deadline they could not see coming. If the visible countdown is ever removed,
  this decision has to be revisited with it.
- **This is not in tension with holding a pause.** A pause INSIDE the minute is
  still not an ending — the fragments are one answer and the hold above still
  applies. The minute ending is a different event, and it ends the answer.

**Topic coverage is enforced at runtime, not asked for in a prompt (decision
2026-08-24).** "Cover every topic" used to be a sentence in
`buildScreeningInstructions` and nothing else: the interviewer was handed a
confidential numbered guide and told to raise all of it, and nothing observed
whether it did. That mattered more than a missed question usually would, because
the overall is the weighted mean over **every** rubric dimension and a dimension
with no evidence scores 0 — so a topic the interviewer *skipped* cost the
candidate exactly what refusing to answer it would have, for a decision nobody
made and nobody could see. `checkScreeningQuestionCoverage` could not catch it:
it runs at campaign creation, against the *question list*, not against the call.

The app now owns a **topic ledger** (`src/lib/screening/topic-ledger.ts`, pure)
recording per topic: status (`pending` | `in_progress` | `complete` |
`insufficient`), `askedAt`, follow-ups used, and a one-line evidence note. It is
persisted on `screening_question_responses.topic_state` and driven by the worker
through `POST /api/agent/screening/control` (`AGENT_API_SECRET`, same guard as
the other agent routes).

- **Two constraints decide the whole shape.** The Realtime model runs on OpenAI
  **server-side VAD**, so LiveKit never calls `onUserTurnCompleted` and the model
  is already generating its reply by the time a turn is finalized — **nothing can
  gate an individual response**. But a **function tool's result is fed back into
  the same generation**, so `end_interview()` returning a refusal genuinely stops
  a close. Tools are therefore the enforcement and `updateInstructions` is only
  steering. Do not "simplify" this into prompt text: the prose version is what
  was already there, and it is what failed.
- **`next_topic` is the only way to raise a topic**, and it returns the topic
  text — never an id. The interviewer is never given a UUID, so "never mention
  internal topic IDs" holds by construction rather than by instruction.
- **`end_interview` refuses while a question is still owed an answer** and
  answers with what to do instead. The refusal never explains itself: no "I
  forgot", no "the system requires". A candidate must only ever hear an
  interviewer thinking of one more thing to ask, or giving them a moment.

  **It refuses on two grounds, and the second was missing until 2026-08-25.**
  A topic still `pending` — never raised — has always blocked it. A topic
  `in_progress` — asked, and not yet answered — did not, which made the LAST
  question of every call the one most likely to be cut short:

  ```
  interviewer raises the final topic   -> answerDueAt armed, 60s, countdown on screen
  control block now reads "topics not yet raised: 0"
  interviewer calls end_interview      -> no pending topics, so ALLOWED
                                       -> answerDueAt nulled, countdown vanishes
  interviewer: "Goodbye!"              -> over a question nobody answered
  ```

  It also produced the wrap-up counter appearing "again and again" mid-call: an
  early allowed close leaves `outstandingTask` at `close` and `awaitingGoodbye`
  set for the rest of the call, so the counter armed, was cancelled by the
  candidate speaking, and armed again after every exchange. One bug, both
  symptoms.

  **`answerStartedAt` is the discriminator**, exactly as it is in
  `beginNextTopic`. Null means nothing has happened since the question was
  raised, so nobody has answered it — refuse. Non-null means they DID answer
  and the interviewer is closing ahead of the evaluator, which is the ordinary
  order (three to five seconds of OpenAI round-trip behind the conversation);
  refusing there would deadlock the close on our own latency.

  **Nothing is written on the refusal path** — no version bump, and above all
  not `answerDueAt`, so the minute keeps running straight through it.

  **The refusal has its own wording**, keyed on the directive coming back as
  `ask_follow_up`: *"they have not answered your last question yet — give them
  a moment"*, explicitly forbidding a repeat or rephrase. The topic-shaped
  refusal would have pointed the interviewer at the very question the candidate
  was in the middle of thinking about, and it would have re-asked it over them.
- **The evaluator (`services/screening-turn.ts`) advises; the rule decides.** It
  reports whether one answer needs a probe, and reconciles which topic an
  exchange actually covered — the self-healing net for an interviewer that
  raised a topic without calling the tool, which would otherwise deadlock the
  close guard forever. Its `nextAction` field is captured for the audit trail
  and **overridden** by `decideNextInterviewAction`. Candidate speech reaches it
  fenced and labelled untrusted.
- ~~**Follow-ups are a counted budget.**~~ **Follow-ups were REMOVED entirely
  (decision 2026-08-27)** — see "One question, one answer, the next question"
  below. Every answer settles its topic, however thin.
- **`SCREENING_WRAP_UP_RESERVE_MS` (60s) buys the last minute back.** Crossing
  it stops probes and raises whatever is left, once each. Since the per-answer
  budget landed this is carved out of `SCREENING_CALL_BACKSTOP_MINUTES` rather
  than out of the call, so it only ever matters on a call that has already gone
  wrong — but it still matters there: arriving at the backstop having raised the
  remaining topics beats arriving mid-sentence with three of them unasked.
- **`insufficient` is a coverage word, not a score.** Nothing in
  `src/lib/screening-scoring/` reads `topic_state`, and
  `extractTranscriptEvidence` still reads the WHOLE transcript per dimension —
  narrowing evidence to "that topic's answer" would recreate the per-question
  bug retired on 2026-08-22.
- **Every failure path resolves to a usable directive; a candidate is on the
  phone.** A dead evaluator retries once then settles the topic **`complete`**
  (not `insufficient` — our outage must not land on their file) and advances,
  degrading a whole broken call to "every topic asked once, no follow-ups,
  clean close". An unreachable control route sends the interviewer back to the
  guide in its own instructions, and **`end_interview` fails open — but not on
  the first blip** (bounded 2026-08-25). A refusal the app actually returned is
  always honoured.

  Failing open on the FIRST unreachable request ended interviews outright: one
  six-second timeout on the tool budget at question two of five closed the call,
  and because the worker sets `awaitingGoodbye` on that path — which overrides
  `decideClose`'s directive check — nothing downstream could stop it. Three
  topics went unasked and scored the candidate 0, for an outage of ours.
  `closeOnUnreachableApp` keeps the reason the fail-open was chosen (nobody is
  held in a room by a service of ours being down) without spending a whole
  interview on one blip:

  - the app already said `close` before it went dark → end the call; this is the
    ordinary goodbye that happened to race an outage;
  - otherwise refuse, up to `UNREACHABLE_CLOSE_REFUSAL_LIMIT` (**1**) times,
    then end it regardless. A blip costs one more topic; an outage costs the
    same one topic and then lets go.

  **The tool's answer and the wind-down come from ONE decision.** A tool that
  says "close the call warmly and stop" while the worker declines to wind down
  leaves the candidate sitting in a room after a goodbye — worse than either
  failure alone. A refused close also runs `applyControl(null, …)` so the
  degraded path hands over the topic guide; skipping that was right while the
  null branch always closed, but an interviewer told to carry on needs a list to
  carry on from.
- `SCREENING_PROMPT_VERSION` is `sc-v5`; `SCREENING_TOPIC_RULES_VERSION` is
  `v4_correctable_stamp` and is stored in the ledger. `topic_state` is NULL
  for every call taken before this and is not back-filled — a coverage record
  should show what was observed, not what today's code would have observed.
  `SCREENING_TOPIC_CONTROL=0` on the worker restores the previous behaviour
  exactly; it is an operational kill switch, not a feature flag, so it defaults
  **on**.

##### One question, one answer, the next question (decision 2026-08-27)

**Follow-up probes are gone from the screening call**, on both sides of the
wire. A call is now: ask the question, wait for the answer, ask the next one,
close. Nothing probes, nothing drafts a probe, nothing counts one.

What was deleted, and it is a lot: `maxFollowUpsForTopicCount` /
`TWO_FOLLOWUP_TOPIC_LIMIT`, `followUpsUsed` / `maxFollowUps` on every topic,
`applyFollowUpAsked` and the `follow_up_asked` control event,
`decideNextInterviewAction`'s probe branch, the evaluator's `needs_follow_up`
status / `follow_up_question` / `next_action` fields, the worker's
`ask_follow_up` move and its wording, and the control block's probe lines.

- **The prompt was the half that mattered.** *"After each answer, ask 1–2 SHORT,
  UNSCRIPTED follow-up questions"* was unconditional, needed no tool call, and
  fired three to five seconds ahead of the verdict that would have counted it —
  which is why the budget bounded nothing (`followUpsUsed` read 0 on calls
  carrying four probes). Removing the machinery without removing the invitation
  would leave the model probing exactly as before, with nothing left to observe
  it. The prompt now says so outright: *"Never probe, never ask a spontaneous
  follow-up."*
- **The cost is depth on a vague answer, and it is real.** What it buys is a
  call with nothing to reason about — the probe machinery was the single
  largest source of complexity in this area, and most of it existed to observe
  and correct probes the model asked without being told to. It also buys time:
  a probe spent a whole extra minute re-asking a topic already covered, and
  evidence for a rubric dimension is read from the WHOLE transcript, never from
  one answer.
- **`ask_follow_up` became `await_answer`.** The ledger returned `ask_follow_up`
  for ANY open topic, so it covered both "probe this thin answer" and "they have
  not spoken yet" — and a separate `awaitingAnswer` boolean existed only to tell
  them apart. With one meaning left, the task says it and the boolean is gone.
  The worker still accepts `ask_follow_up` as a synonym for a mid-rollout app.
- **The evaluator got smaller, and it is on the audio path.** The candidate
  hears it as the gap between their answer and the next question, so every field
  it is asked to write is latency they sit through. It now reports two statuses
  and a one-line summary, and nothing else.
- **`BACKEND_RESPONSE` lost its `kind`.** Every question is a topic now, so
  `topic_started` is posted unconditionally — there is no probe that must not
  burn one.
- **`enterWrapUp`'s `complete` branch was unreachable and is gone.** It read
  `evidenceSummary ? "complete" : "insufficient"`, and only the probe path ever
  left a topic open *with* evidence recorded on it.

##### The interviewer is never cut off mid-question (decision 2026-08-27)

Barge-in was on, on the reasoning that *"a candidate who talks over a question
is answering it, and cutting the interviewer off is correct"*. On a live call
they far more often are not: a cough, a backchannel, somebody else in the room.
And the cost of reading one of those as an answer is the worst failure this
worker has.

```
question starts playing -> topic_started already posted (the topic is spent)
candidate coughs        -> OpenAI cancels the response mid-sentence
                        -> the machine hands the floor over
cough is transcribed    -> assembled as their ANSWER, reported as turn_completed
                        -> the app settles the topic and sends the next question
```

They never heard the question, their minute armed on the half of it that played,
and the rubric dimension behind it is scored on a cough. What barge-in bought
was a candidate skipping a question they had already understood — a convenience,
against a silent wrong answer on somebody's file.

- **It takes TWO settings, because two different parties do the cancelling**,
  and the first was shipped alone and did not work — reported straight back from
  the chair as *"i still can interrupt it and talk while it speaks"*.
  - `interrupt_response: false` on OpenAI's turn detection stops the MODEL
    cancelling its own response when its server-side VAD hears speech.
  - `handle.allowInterruptions = false` on the `SpeechHandle` stops the
    FRAMEWORK, which runs its own interruption on top:
    `onInputSpeechStarted` calls `activity.interrupt()` unconditionally on every
    `input_speech_started` event, which stops the playout locally no matter what
    OpenAI was told. The only thing that stops THAT is
    `currentSpeech.interrupt(false)` throwing, which the caller wraps in a
    try/catch — the framework anticipates it, its own comment reading *"this
    is going to raise when allow_interruptions is False"*.
- **The option and the setter share a name and only the setter works.**
  `allowInterruptions` passed to the session or to `generateReply` is silently
  forced back to `true` for a RealtimeModel with server-side turn detection,
  with nothing but a log warning — so passing it reads as a guarantee and
  provides none. A contract test pins both working assignments and pins that the
  useless option is never passed.
- **Expect one framework error line per attempt**, worded as though it were
  impossible: *"RealtimeAPI input_speech_started, but current speech is not
  interruptable, this should never happen!"*. It is expected here; it is the
  sound of a question surviving a cough.
- **Turn DETECTION is untouched.** The worker still hears every word, and
  anything said over a question still reaches the transcript the scorer reads —
  evidence extraction works off the whole transcript, so a real answer given
  over the tail of a question still counts. It simply cannot end the question or
  be mistaken for the answer to it.
- **The flag alone is not enough; the machine had to stop handing over the
  floor.** `GREETING`/`ASKING` + `CANDIDATE_SPEECH_STARTED` used to enter
  `LISTENING`, which with an uninterruptible turn would have the machine believe
  it was listening while the interviewer was still talking — and, worse, would
  let the cough be assembled as the answer anyway, since the transcript handler
  assembles only while `LISTENING`. That guard is now the whole defence, so the
  transition is load-bearing rather than cosmetic.
- **Their minute still starts at `QUESTION_FINISHED`**, so somebody who talks
  over the tail gets the full sixty seconds from the moment the audio stops.
- **The goodbye redelivery is gone with it.** `goodbyeInterrupted` /
  `goodbyeRedelivered` recorded that a sign-off had been CANCELLED and owed the
  candidate a second one. It cannot be cancelled now, so the flag could only
  ever be a false positive — and "thanks, bye!" over the sign-off is the most
  natural thing a candidate says, which would have earned every polite one of
  them a redundant second goodbye. What survives is the part that mattered: the
  room does not close while they are talking.
- **The residual hole is small and named.** A cough that STARTS during the
  question but ENDS after it lands while the machine is listening, so it can
  still be assembled as the answer. The window is the length of the cough rather
  than the length of the question.

##### The goodbye may not end on a question, and the prompt is only half of that (decision 2026-08-27)

Reported from the chair: *"at the end it asks a follow-up and it submits."*

With `create_response: false` the model cannot start a turn, so exactly one turn
can speak at the end of a call — the **goodbye**, which the worker asks for. Its
words are still the model's, and closing an interview by inviting questions is
one of the strongest habits it has. So the sign-off ended *"…before we wrap up,
is there anything you'd like to add?"* — and that is the worst possible moment
for a question, because `GOODBYE_FINISHED` takes the machine straight to `DONE`,
`windDown` publishes `screening.finished`, and **the browser submits on that
packet**. The candidate is asked something real and hung up on mid-thought, and
what they were about to say reaches no transcript at all.

- **The prompt already forbade it, in the weakest available form.** *"Do not ask
  them anything further"* had been in `GOODBYE_INSTRUCTIONS` for the whole time
  the bug was live. A negation is a poor way to argue with a habit that strong,
  so the instruction is now positive — the last sentence must **be a
  statement** — names the two forms it actually took, and gives the impulse
  somewhere to go: a real question from the candidate is answered by the hiring
  team, by email.
- **And the prompt is still only the first half.** This is the same lesson as
  `next_topic` and `end_interview`: anything the product cannot afford to lose
  is driven from observable state, with the wording as the fast path.
  `endsOnAQuestion` reads the goodbye's own transcript turn at the moment its
  playout ends — an agent turn is finalized when its TEXT completes, which runs
  ahead of the audio, so the words are always there to read — and the room is
  held open (`CLOSING_ANSWER_MS`, 20s) instead of closing.
- **It reads the GOODBYE's own turn, never "the interviewer's last turn".** The
  obvious call is wrong by a hair of timing: an agent turn is finalized when its
  TEXT completes, which normally beats the end of its own audio — but on a run
  where it does not, the most recent interviewer turn is still the previous
  QUESTION, and a question ends in a question mark by definition. Every call
  would then hold its room open at the end, waiting for an answer to something
  asked and answered a minute ago. So `sayGoodbye` snapshots the transcript
  length before requesting the sign-off and reads only what came after
  (`interviewerTurnSince`). Nothing after it means the words never arrived,
  which is read as "no question asked" — the safe direction, because a miss
  costs a question the prompt already forbids while a false positive costs
  twenty seconds of dead air on every call that ever ends.
- **A trailing question mark, and nothing cleverer.** An open question is
  routinely an imperative ("Tell me about a time you disagreed"), and the
  interviewer is explicitly told to ask that way, so anything reading for intent
  would fire on half the questions on the call. The mark is read **only in the
  direction of waiting longer**: a false positive costs seconds of dead air on a
  call that is over, a false negative costs somebody their answer. Arabic and
  full-width marks count — the call settles into whatever language the candidate
  answered in, and an ASCII-only check would hold for English and quietly fail
  for every Arabic call.
- **Their answer ends the wait**, so a candidate who does answer never sits
  through the window. Bounded at two windows for one who never pauses, because
  dead air is not free either: a screen that looks frozen is what makes people
  close the tab on a finished interview, and nothing submits when they do.
- **And the close itself must not run over the candidate**, which is the half
  the first version missed. Reported from the chair: *"it asked the last
  question, I answered I DON'T KNOW, and instead of submitting it asks another
  follow-up question — while speaking it submits."* The ordinary end of a
  redelivery reaches it: the sign-off probes instead of closing, the candidate
  starts answering the probe, that cancels the turn, the redelivery branch runs
  FIRST (so `askedSomething` is never consulted), the second goodbye is spoken,
  they are still talking, and the second `GOODBYE_FINISHED` falls through to
  `beginDone` with `candidateSpeaking` still true. The browser submits on it,
  and what they were saying reached no transcript at all. `GOODBYE_FINISHED`
  now routes a speaking candidate into the same wait as a question — it was the
  last close in the machine that did not check who held the floor, and being
  terminal it was the most expensive one to get wrong. **A test was asserting
  the bug**: it drove two interruptions, never let the candidate stop, and
  expected `DONE`. Its real property — bounded at one redelivery, no loop — is
  kept; the close over a live speaker is not.
- **The prompt names the trigger, because "I don't know" is what produces it.**
  A non-answer is the strongest possible invitation for a model to help — to
  rephrase, offer a hint, try an easier angle — and that is what the "follow-up"
  was. The goodbye now says a short answer or a flat "I don't know" is complete,
  and to close exactly as it would after their best answer.
- **Answering the sign-off is not interrupting it.** `CANDIDATE_SPEECH_STARTED`
  in `FINISHING` sets `goodbyeInterrupted`, which re-says the goodbye once — the
  right reading for somebody talking OVER it, and exactly wrong for somebody
  answering the question it just asked. `awaitingClosingAnswer` separates them.
  An interrupted goodbye is still re-said first, and it is the RE-SAID one whose
  words are read for a question: the first was cut off, so what it would have
  ended on is unknown.
- **`beginDone` is now the single door into `DONE`**, because four things reach
  it — a delivered goodbye, a redelivered one, an answered closing question, and
  a window running out — and they must leave the same state behind.
- The nearest thing in the pull protocol was `CLOSE_ANSWER_SETTLE_MS` (*"its
  last words were a question — an answer is owed"*), retired with that protocol
  because the model could no longer start a turn. The hazard survived it: the
  worker stopped choosing *when* the interviewer speaks, never *what* it says.

##### The follow-up budget is spent by the interviewer, not asked for by the app (decision 2026-08-25, superseded 2026-08-27)

**Superseded — follow-ups no longer exist; see the section above.** Kept for the
reasoning, which is the clearest statement of why a prompt instruction is not a
bound.

The budget was a rule the code stated and never applied. `followUpsUsed` read
**0** on calls carrying four probes, `evaluateTurn` was told the whole allowance
remained, and the thing the budget exists to prevent — a call spending its
minutes improving one answer while topics nobody has raised score 0 — was
bounded by nothing at all.

Two causes, and the prompt is the larger one:

1. **The prompt ordered a probe after every answer.** *"After each answer, ask
   1–2 SHORT, UNSCRIPTED follow-up questions"* — unconditional, and paired with
   *"Follow-up probes are yours alone and need no tool"*. So the interviewer
   probed constantly, and never told anyone.
2. **The only path that spent a probe could not be reached.**
   `decideNextInterviewAction` spends one when the evaluator says
   `needs_follow_up` AND the topic is still open when that verdict lands. The
   interviewer calls `next_topic` about half a second after the candidate stops;
   `turn_completed` is an OpenAI round-trip three to five seconds behind it. So
   `beginNextTopic` settles the topic `complete` first and the verdict arrives
   to a closed topic, where it may only annotate. The suggested probe was
   discarded on every hand-off.

**The candidate felt the second half of this before anyone noticed the first.**
An improvised probe raised no topic and re-armed no clock, so it inherited
whatever was left of the PREVIOUS question's minute: somebody who spent fifty
seconds on their first answer got ten to answer the follow-up, with the counter
to match — or none at all, if the topic had already settled.

**The count now comes from the worker, which is the only party that can see a
probe happen.** `shouldCountFollowUp` reads: a topic is open, the candidate has
ALREADY answered it, and the turn that just ended asked something. That can only
be a probe. It posts `follow_up_asked`, and `applyFollowUpAsked` spends one from
the allowance and arms a fresh minute — the same rule the app applies to a probe
it asked for itself.

- **This is the pattern, not a new one.** A Realtime voice model will not call a
  tool because the prompt says to, so anything the product cannot afford to lose
  is driven from observable session state with the tool as a fast path. The
  stamp, the goodbye and the close all work this way; the probe count is the
  fourth.
- **`answerRunning` is the discriminator.** A question the candidate has not
  answered yet is the interviewer repeating or rephrasing itself. Counting it
  would exhaust the allowance without the candidate being asked anything new,
  and the fresh minute would reset on every restatement — the budget meaning
  nothing at all.
- **Mutually exclusive with the stamp by construction.** The stamp needs
  `ask_primary_question` (nothing open), this needs `ask_follow_up` (a topic
  open). One interviewer turn is one question and cannot be both; a test pins
  it, because a turn that both spent budget and burned a topic would be the
  worst of the two.
- **A misfire here is cheap, unlike the stamp's**, which is why it needs none of
  the rollback machinery. If the turn was really a new main topic asked without
  the tool, this spends one probe on a topic the reconciler is about to settle
  anyway. Nothing is burned and no question goes unasked.
- **The count is not capped.** An interviewer that asks a third probe against an
  allowance of two has asked three, and a record that capped the number would
  hide exactly the behaviour this event exists to make visible.

**The count is deliberately incomplete, and the gap is the evaluator's
latency.** A probe on a turn longer than that round-trip arrives to find its
topic settled, where `applyFollowUpAsked` is a no-op — the worker's stamp fires
instead, which is what still gets the candidate a minute and a countdown, and
`takeBackWrongStamp` credits the probe to the topic the reading names. So the
record is right in both orders; only the *steering* reaches the fast case, since
a settled topic has nothing left to steer.

**`SCREENING_PROMPT_VERSION` is `sc-v5`, and the prompt change is the load-bearing
half.** Probing is conditional again — it happens when an answer is vague,
generic or sounds read off a script, which the next line already said — and the
prompt no longer names a number: *"How many probes a topic may draw is counted
for you and is none of your concern."* `TWO_FOLLOWUP_TOPIC_LIMIT` is gone from
`realtime.ts` entirely; the allowance still comes from
`maxFollowUpsForTopicCount`, it is simply never narrated. This is the same
treatment pacing got in v4, for the same reason: a number this model cannot
count is not a bound, it is a suggestion.

The control block gained the state the old prompt had no way to reach — with the
allowance spent it says *"No probes left on this topic. Do not ask another — let
them finish, then move on to what you are given next."* A refusal with no
alternative is how the interviewer ends up improvising.

##### The stamp is a guess, and the evaluator may take it back (decision 2026-08-25)

`stampSkippedTopic` opens a topic when an interviewer turn ends on a question
with a primary question outstanding and no clock running. It exists because the
model ignores `next_topic`, and the clock lives in the same place as coverage —
`answerDueAt` is only ever set by opening a topic — so without it no answer on
such a call carries a deadline and the countdown never appears.

**It cannot hear WHAT was asked, and the interviewer's own prompt guarantees
most of those turns are follow-ups.** `buildScreeningInstructions` says
"Follow-up probes are yours alone and need no tool" and "after each answer, ask
1–2 short, unscripted follow-up questions". So the routine sequence is:

```
candidate answers topic 1
+0.3s  interviewer starts an improvised follow-up (no tool call)
+4s    the evaluator lands, settles topic 1 -> task becomes ask_primary_question,
       the clock is cleared
+5s    that follow-up turn ends -> stamped -> TOPIC 2 IS MARKED ASKED
```

Topic 2 was never spoken. The answer to the follow-up is filed against it,
`reconcileAddressedTopic` cannot rescue it (it only ever marks `pending` topics
raised, and topic 1 is already `complete`), and the rubric dimension behind
topic 2 scores **0** for a question nobody heard.

**So the stamp stays optimistic and becomes reversible.** `takeBackWrongStamp`
hands a topic back to `pending` when the turn evaluator reports the exchange
addressed a topic that is already settled while the ledger believes a
different, stamp-opened topic is in progress. That is the same division of
labour as everywhere else on this call: the worker acts on what it can observe,
the reading corrects it.

- **The worker says which topics were guesses.** `topic_started` carries
  `stamped: true` from the stamp path and nothing from either `next_topic`
  path; the ledger records it as `openedByStamp`. Only the worker knows how an
  event was raised. An older worker sends no flag, which reads as "the tool
  asked for it" — the direction that withholds a correction rather than
  inventing one.
- **A topic the tool asked for is never second-guessed.** That is a stated
  intention, not a guess.
- **Bounded by the WRAP-UP PHASE, not by a per-topic count**, and getting that
  wrong shipped a topic burn. It was one rollback per topic first, reasoning
  that a candidate whose answer wanders back to an earlier topic looks exactly
  like an interviewer probing one, so an unlimited correction would loop the
  call. That priced the trade backwards: **two long improvised probes in a row**
  — the interviewer's turn outrunning the evaluator twice — spent the allowance
  and burned the next topic outright, `complete` and never asked. A stall is the
  better failure and this file says so everywhere else: the topic stays
  `pending`, the close guard holds the call open, the block keeps handing the
  topic over, and whatever was said is still in the transcript the scorer reads.
  Correcting stops at wrap-up because its reserve exists to raise whatever is
  left, once each, and a rollback there would fight the one mechanism
  guaranteeing coverage — and because a stamp is far likelier to be genuine by
  then, the interviewer having been told to raise the remaining topics and
  nothing else. `rolledBack` stays as a record that it happened.
- **The clock goes back with it.** Nothing is outstanding once a question is
  un-asked, so a deadline left armed would time out an answer to a question
  that no longer exists.
- **Making the stamp reluctant instead was rejected.** Every gate that
  distinguishes a follow-up from a main question from session state alone also
  suppresses the stamp on the call it exists for — the one where `next_topic` is
  never called and every topic would otherwise run with no clock at all.

**`pendingDirective` is dropped by the stamp, in the same change.** It holds the
last evaluation's "ask topic N next", and the stamp is what OPENS topic N — so
serving the cache afterwards told the interviewer to ask a topic already marked
asked, while the background write advanced the ledger to N+1. The conversation
and the ledger then ran a topic apart for the rest of the call, each topic
settled by the answer to the one before it, and the last one never asked.

##### `ask_follow_up` also means "they have not answered yet" (decision 2026-08-25)

`currentDirective` returns `ask_follow_up` for **any** open topic, so it is what
the ledger reports in the seconds between a question being asked and the
candidate starting to speak — which is exactly when a late verdict on the
PREVIOUS topic lands and pushes a fresh control block. The block rendered
`Follow-up probes left on this topic: 2` at an interviewer whose candidate had
not drawn breath: an instruction to talk over somebody deciding what to say.

The ledger has always known the difference — `answerStartedAt`, which
`resolveCloseRequest` already uses to refuse a close over an unanswered
question, and which `endInterviewToolResult` already turns into "give them a
moment". The control block was the one place steering the interviewer that
could not see it.

- `ScreeningDirective.awaitingAnswer` carries that fact, and
  `buildInterviewControlBlock` renders "They have not answered this yet. Wait."
  in place of the probe lines — including the same "do not repeat or rephrase"
  the close refusal uses, so the two cannot drift.
- **It is not a new task value.** A directive that hands over a question or a
  probe is never awaiting an answer, so the flag is false on every
  `beginNextTopic` and every real follow-up. Adding a fourth `ScreeningTask`
  would have changed the wire enum the worker keys its stamp guard and its
  close refusal off, across two packages that deploy separately; an additive
  boolean leaves an older worker behaving exactly as it does today.

##### A guessed `complete` is corrected by the verdict that follows it

`beginNextTopic` settles the open topic `complete` the moment `next_topic`
arrives with an answer behind it, because reading the ordinary order as a
duplicate swallowed the next topic entirely. It has to guess, and it guesses in
the candidate's favour — but the verdict lands three to five seconds later and
knows what the answer was actually like. Leaving the guess standing recorded a
thin answer as `complete`, which is a lie in a record a person reads.

`annotateSettledTopic` now downgrades such a topic to `insufficient` when the
late reading says the answer was thin. **`complete` with no summary is the
signature of the guess, and only of it** — every other settle writes one,
including the two that must never be downgraded: the evaluator-failure fallback
(our outage stays off the candidate's file) and the wrap-up settle, which
records `insufficient` outright when it has nothing.

This is a coverage record, not a score: nothing in `src/lib/screening-scoring/`
reads `topic_state`, and the follow-up the verdict asked for is still not asked,
because the interviewer has already moved on. What changes is that the stored
record stops disagreeing with the transcript.

**Room metadata is candidate-visible (decision 2026-08-24).** Both workers used
to read their interviewer instructions off LiveKit room metadata, and three
separate code comments claimed the candidate "can't touch them". Only half of
that was true: the server alone can **set** metadata, but LiveKit **delivers**
it to every participant — it arrives in the JOIN response and is exposed as
`room.metadata` on the client SDK. A candidate with the network tab open read
the entire instruction string before being asked anything: the confidential
screening topic guide (defeating "questions never shown in advance",
docs/voice-screening.md mitigation #2) and, at the interview stage, the
condensed copy of their own résumé plus the campaign's `interview_persona` — so
they knew how hard they were about to be pressed.

- **Metadata now carries `application_id` and nothing else.** It is the one
  thing the worker cannot learn any other way, and the one thing that costs
  nothing to expose: the candidate's own signed token already encodes it.
- **Each worker fetches its own instructions** from
  `GET /api/agent/{screening,interview}/instructions?application_id=…`, guarded
  by the same `AGENT_API_SECRET` it already holds to report transcripts — so
  the boundary gained no new trust. The composers are
  `src/lib/{screening,interview}/instructions.ts`: orchestration on an injected
  `db`, no auth of their own (the route's secret is the gate), no decisions.
- **Nothing is stored.** The instructions are rebuilt from the database on
  demand rather than persisted at grant time — `buildScreeningInstructions` and
  `buildInterviewInstructions` are pure, so there is no second copy to drift or
  to migrate.
- **A missing instruction set is fatal, loudly.** The routes 404 rather than
  return an empty string, and the worker throws. An interviewer improvising its
  own questions would hold a full-length conversation that evidences no rubric
  dimension, scoring every one of them 0 — worse than a visible failure.
- **Deploy the workers BEFORE the app.** Each worker fetches first and falls
  back to metadata, so a new worker runs against either version of the app; an
  old worker against the new app finds no instructions and strands the candidate
  in a silent room. The legacy `instructions?` field in each worker's metadata
  type is dead once the app ships and can then be deleted.

**The AI interview is not recorded.** LiveKit Egress, the `interview-recordings` bucket, `interview_sessions.recording_url` and the `SUPABASE_S3_*` env vars were all removed on 2026-08-04 (migration `20260804140000_drop_interview_recordings.sql`). The candidate's camera exists only as a live track: the agent worker samples frames in memory for proctoring and discards them. **Do not reintroduce recording** without revisiting the decision recorded in "AI Interview" above — the absence of stored video is a deliberate privacy posture, not missing work.

**Proctoring (Phases C + C2)** — `src/lib/proctoring/`. Runs on **both** candidate-facing live stages, but they can carry different evidence:

- **Voice screening** (`/respond/[token]`) — browser tab-focus only; there is no camera at this stage. Worth having because screening is where a candidate has the most reason to game (the question is asked before the answer is given, and "hold on a second" costs nothing), but it is the *self-reported* half with nothing to corroborate it: a candidate who edits their submit payload produces a clean report. Treat a clean screening report as weak evidence. Stored on `screening_question_responses.proctoring`.
- **AI video interview** (`/interview/[token]`) — browser signals *plus* server-side camera vision, which the candidate's machine cannot forge. Stored on `interview_sessions.proctoring`.

Both stages run the same `summarizeProctoring` rules and render through one shared component (`src/components/candidates/proctoring-report.tsx`), so a report reads identically wherever it came from and the fallibility wording can't drift between stages.

Interview evidence comes from two independent streams, and the distinction is load-bearing:

- **Browser signals (Phase C)** — **tab focus** (`visibilitychange` + window `blur`/`focus`) and **camera presence** (LiveKit local video track muted / unpublished). Only the browser can see these, so the trust boundary is drawn carefully: the client (`collector.ts`) buffers raw open/close intervals and flushes them **once, on submit**, reporting only *what happened and for how long*. It never asserts severity. `collector.ts` is typed against `ProctoringEventType`, which deliberately excludes the vision types — a candidate's browser cannot post (or suppress) a camera finding.
- **Camera vision (Phase C2)** — the interview agent worker (`agents/interview/src/vision.ts`) samples a frame from the candidate's published video track, runs a **local YOLOX-tiny detector** over it (`agents/interview/src/detector.ts` + `postprocess.ts`, weights committed under `agents/interview/models/`, Apache-2.0), and reports `{at, person_count, confidence, phone_count}` to `POST /api/agent/interview/proctoring` (guarded by `AGENT_API_SECRET`, admin-client write, draft-only while the session is open). Detection is in-process: frames are scored in memory and discarded, so no image is stored or sent to a third party. This is **server-side** evidence the candidate's machine cannot forge. It is kept strictly **out of the Realtime interviewer session** — feeding frames to the interviewer would make it react to what it sees mid-call, turning monitoring into a live accusation delivered by the interviewer. The interviewer remains audio-only.
- **Live overlay (decision 2026-08-04)** — detection boxes are ALSO published to the candidate's own browser over the LiveKit data channel (topic `proctoring.boxes`) and drawn on their self-view. This knowingly gives up the "don't tip them off" property: the candidate sees what was detected and when, and can time around it. It does **not** affect the record — boxes flow worker → browser only, the reporting route accepts no incident types from a browser, and the report is assembled server-side from the worker's readings. Turn it off with `VISION_OVERLAY=0` on the worker. The overlay runs a faster cadence (`VISION_OVERLAY_INTERVAL_MS`, default 1s) than the report (`VISION_SAMPLE_INTERVAL_MS`, default 5s); the two are deliberately separate knobs so overlay smoothness can never change what a stored report means or blow the 500-observation schema bound. Overlay geometry (`object-fit: cover` crop + mirrored preview) lives in `src/lib/proctoring/overlay.ts`, pure and tested.

Both streams report raw readings only; `summarizeProctoring` (`incidents.ts`, pure + versioned via `PROCTORING_REPORT_VERSION`, now `proctoring-v4`) owns all judgement — it drops sub-threshold noise, run-length-encodes vision samples into durations **per condition** (a frame can be both `multiple_people` and `phone_visible`, so runs are tracked independently), and classifies what survives as `warning` / `critical`, tagging each incident with its `source` (`client` | `vision`). Vision incident types are `person_absent` / `multiple_people` / `phone_visible`. The report lands on `interview_sessions.proctoring`; raw vision samples live on `interview_sessions.proctoring_observations` until submit folds them in.

Vision inference is deliberately **biased toward missing incidents rather than inventing them**, because wrongly accusing a real candidate is the expensive failure — and with no recording, nobody can check a finding against footage. Samples below `VISION_MIN_CONFIDENCE` are discarded rather than believed, a single stray frame spans zero time and can never clear a threshold, `multiple_people` and `phone_visible` each need two consecutive sightings (lowered from three on 2026-08-28 — see below), box-area floors reject a person on a poster or a background monitor, and a gap over `VISION_MAX_SAMPLE_GAP_MS` breaks a run so a stalled worker can't read as a minute of absence. `confidence` is **frame usability** (luminance + contrast, capped by the weakest counted box) rather than a model's self-report — a detector cannot say "I couldn't see", and without this an unlit room would read as an abandoned one. Phone detection uses COCO `cell phone` + `remote` (detectors routinely label a held phone as a remote); `laptop` / `tv` / `book` are deliberately excluded because a second screen is normal on a desktop-only interview.

**Evidence snapshots (decision 2026-08-04)** — when a frame is flagged, the worker encodes *that one frame* as a small annotated JPEG (`agents/interview/src/snapshot.ts`) and posts it to `POST /api/agent/interview/snapshot`; the app uploads it to the private `proctoring-snapshots` bucket (owner-scoped RLS keyed on the campaign id in the first path segment, same convention as `resumes`) and keeps only the object **key** on `interview_sessions.proctoring_snapshots`, resolved to a short-lived signed URL at read time. This deliberately reintroduces stored candidate images — but narrowly, and it is what makes a camera finding checkable now that there is no recording. The guardrails are load-bearing: only flagged frames are encoded (a clean interview stores nothing), one still per condition per `VISION_SNAPSHOT_INTERVAL_MS` (default 30s), and at submit `attachSnapshots` attaches the earliest still inside each **confirmed** incident and **deletes every other key** — so the frames behind the detector's own false positives are precisely the ones thrown away. The route accepts no severity or incident type, like every other agent report. `VISION_SNAPSHOTS=0` disables capture.

##### A still is filed under everything it shows, and the cadence is what made findings visible (decision 2026-08-28)

Reported from the chair: a phone was never captured. Nothing was broken — the
whole chain worked, and the evidence was being thrown away one step later.

**`VISION_SAMPLE_INTERVAL_MS` is the RESOLUTION of every stored finding, and at
10s it was discarding most of them.** An incident's duration is measured first
flagged sample to last, so the cadence rounds every finding DOWN to a multiple
of itself: a phone in view for 18 seconds landed on two samples, measured 10s,
fell under `PHONE_VISIBLE_MIN_MS` (15s), and was dropped — taking its snapshot
with it, since a still outside a confirmed incident is pruned as an orphan. A
condition had to hold ~20s+ to be seen at all, so an ordinary glance left no
evidence whatsoever.

- **The fix was the cadence, not the thresholds.** 5s halves the measurement
  error without touching a single bar: 15 seconds still means fifteen seconds of
  a condition genuinely holding, a lone stray frame still spans zero time, and
  the anti-false-positive bias this whole area is built on is untouched. What
  changed is only how accurately a real fifteen seconds can be measured.
- **It is close to free.** The overlay already runs the detector every second,
  so this decides how often a reading is KEPT, not how often one is computed.
- **Bounded by the schema, which is why it is not lower still.** A report caps
  at 500 observations and `INTERVIEW_DURATION_MINUTES` is 10 — 120 samples at
  5s. The two knobs stay separate for exactly this reason.
- The thresholds were then lowered outright — see the next section.

**A still is now filed under every condition its frame satisfied, not the most
serious one.** `primaryCondition` picked one label per image, so a frame showing
a second person AND a phone was stored as `multiple_people` — and the
`phone_visible` incident then rendered as a bare automated accusation with no
picture behind it, precisely when a recruiter most needs something to check. It
is deleted; `conditionsOf` is what the route calls.

- **It stores no extra image.** One frame, one JPEG, attached to both findings
  it depicts — `used` (any incident) is what saves a still from the prune, while
  `claimed` (per condition) keeps "the earliest still, once" deterministic.
- **`LegacyProctoringSnapshot` is its own type, not an optional field.** A write
  path that could compile without saying what a frame shows would produce a
  still that attaches to nothing and is silently deleted as an orphan — losing
  the evidence this feature exists to keep. Rows written before this are read
  through `snapshotConditions` and **not back-filled**: a stored report should
  say what was observed, not what today's code would have observed.

##### A glance is now reported, and the bar is two sightings (decision 2026-08-28)

Directed by the product owner, over a stated objection, after the cadence fix
above still left an ordinary phone glance invisible. **`PHONE_VISIBLE_MIN_MS`
and `MULTIPLE_PEOPLE_MIN_MS` are 5s**, down from 15s — at the 5s cadence, two
consecutive sightings. `PROCTORING_REPORT_VERSION` is `proctoring-v4`.

The objection, recorded because it is the thing to revisit if reports get noisy:
this weakens the bias toward missing incidents rather than inventing them, which
matters more here than almost anywhere because there is **no recording** to
check a finding against. A person genuinely walking past behind the candidate
now registers, where before it did not.

What keeps it proportionate, and what must not be quietly removed:

- **The single-frame invariant is untouched, and it is why 5s was the floor
  rather than something lower.** A run spans first sample to last, so one frame
  is always zero-length and can clear no threshold at all. One bad inference
  still cannot accuse anybody. A test asserts this for both conditions.
- **Two sightings is a `warning`, never `critical`.** Both `*_CRITICAL_MS` stay
  at 30s, so the severity ladder — not the reporting bar — is what separates a
  glance from working off a phone throughout.
- **It arrives with the frame attached.** The threshold change and the snapshot
  work above are one feature: a low bar would be indefensible if it produced
  bare accusations, and the recruiter is judging a picture instead.
- **`PERSON_ABSENT_MIN_MS` stays 15s, deliberately.** The bar tracks how
  ORDINARY the behaviour is, not how serious the finding sounds. Leaning out of
  frame is something nearly every candidate does; a phone or a second person in
  shot is not baseline behaviour. Lowering it would fill honest reports with
  noise and teach recruiters to skim the section — which costs more than the
  findings it would add.
- **`VISION_SNAPSHOT_INTERVAL_MS` halved to 15s with it.** A finding can now be
  two samples long, and an image only attaches if a still falls INSIDE the
  incident's window — so at 30s a second brief sighting soon after the first was
  throttled out and rendered with no picture, reproducing the original
  complaint. It costs uploads, not stored images: `attachSnapshots` still keeps
  one still per incident and deletes the rest.
- **Proctoring is still observational.** Nothing here gates, transitions, or
  feeds a score, which is what makes a more sensitive bar a reporting change
  rather than a decision change.

Proctoring is **observational only**: it never terminates an interview, never transitions an application, and is never fed into the interview score — the recruiter reads it as independent evidence beside the score, with camera findings labelled and carrying an explicit fallibility note in the UI. It is also best-effort: a malformed browser payload is logged and discarded *without* dropping the worker's vision evidence (otherwise a candidate could erase the one signal they don't control), and the interview still completes. Absent proctoring is rendered distinctly from a clean run, and `summary.vision_sampled` distinguishes "watched and clean" from "never watched". Gaze direction and identity matching remain out of scope; the report shape accommodates them without a schema change.

Gmail integration (`src/lib/services/gmail.ts`) uses the `googleapis` SDK and is **outbound-only** — it sends candidate emails (screening/interview links) from the recruiter's connected inbox.

**Inbox resume ingestion is retired and will not be built (decision 2026-08-23).** Candidates enter exclusively through the public apply page `/apply/<slug>`; PRD 3.2.1 is amended in place to say so, and issue #163 was closed against this decision. The reason is routing: an inbox cannot say which campaign a CV is for, so it needs a rule the recruiter maintains by hand — a label, an alias, a plus-address — and every such rule is a way for a real applicant to land nowhere. The apply link carries the campaign in the URL, so an application is bound to a campaign by construction rather than by inference, and the candidate gets a confirmation instead of silence. **Do not reintroduce an inbound sweep** without revisiting this; `ingestResumeDocument` still takes a `source` tag, and its presence is not an invitation. The one loose end is the OAuth scope: `gmail.modify` grants whole-mailbox read and was sized for the retired sweep — sending needs only `gmail.send` (plus `openid email` for the callback's address lookup, which currently uses `users.getProfile`). The OAuth **app** credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) live in env; the per-recruiter **refresh token** is obtained via the consent flow and stored in the `gmail_connections` table (one row per `user_id`). A recruiter connects/changes their inbox under **Settings → Integrations**, which drives the OAuth round-trip through the route handlers in `src/app/api/integrations/gmail/{connect,callback}/route.ts`. Outbound sends (`src/lib/actions/gmail-sender.ts`) read the stored token (server-side only) to build the Gmail client. The refresh token is a secret: protected by owner-only RLS, never returned to the browser; encryption-at-rest (pgcrypto / Supabase Vault) is a future hardening step. **Setup:** in the Google Cloud OAuth client, register the redirect URI `<origin>/api/integrations/gmail/callback` (e.g. `http://localhost:3000/...`) and allow the `gmail.modify` scope (a superset of `gmail.send`).

Resume text extraction (`src/lib/services/marker.ts`) uses the hosted Datalab Marker API for all document types — it replaced the legacy `pdf-parse` (PDF) and `mammoth` (DOCX) extractors. The OpenAI resume parser classifies each document (`document_type`: `cv` | `motivation_letter` | `other`); only CVs are ingested.

**Contact links are harvested, not asked for (decision 2026-08-23).** Marker
preserves a PDF's hyperlink annotations, so a CV whose contact block is three
icons arrives as `[LinkedIn](https://www.linkedin.com/in/alice)`. The extractor
is told to read the document and invent nothing — and a URL hidden behind the
word "LinkedIn" is not prose, so it returned `null` for links that were sitting
in the text. `harvestContactLinks` (`src/lib/resume-ingest/contact-links.ts`) is
the deterministic reader that fixes it, and the same rules apply as everywhere
else AI meets code:

- **It only ever fills a blank.** A value the model did find is never
  overwritten, so the harvest can add a link but not change one. Self-declared
  apply-form links still beat both.
- **It cannot invent.** Every URL returned appears verbatim in the document.
  A bare domain counts only for LinkedIn and GitHub, where the shape is
  unmistakable; a portfolio must spell out its own `http(s)://`, because
  "Node.js" and `_page_0_Picture_0.jpeg` are also a word, a dot and a suffix.
- The audit row keeps the **raw** extraction, links unfilled, so the evidence
  still says what the model actually returned.

`applications` ingested before this keep their nulls: there is no re-parse path,
and the ingest audit row stores only the resume text's *length*, so the markdown
is not recoverable from the database. `/api/cron/backfill-contact-links` repairs
them by re-reading the stored file.

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
