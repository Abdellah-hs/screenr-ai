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

### Reference Checks — removed (decision 2026-08-30)

**There is no reference-check stage.** PRD 3.19 is retired and
`reference_check` has been dropped from `ApplicationState`, from the Zod
enum, and from `candidate_stage_enum` in the database
(`20260830120000_drop_reference_check_state.sql`).

It previously read "optional but first-class in architecture — do not bolt on
later", and the state existed on that instruction. Nothing was ever built
behind it, which made it worse than absent: `interview_scored ->
reference_check` was a legal transition, so the stage dropdown could move an
application into a stage with **no screen, no action and no rule to move it
on**. A candidate sent there would sit until a person noticed by hand — the
silent failure this file forbids everywhere else.

What was proposed (3.19) was a second conversational-AI product: a form for
the candidate to submit referees, AI-run chat or voice calls with each of
them, a consistency analysis against the candidate's own interview claims,
and its own consent regime — all for a stage the PRD itself marked optional.

**A recruiter phoning a referee is unaffected and needs no stage.** That
happens while the application sits in `manager_review`, which is the decision
point and already waits for a person. Do not reintroduce the state to model
it: a stage that only a human drives, with no artifact of its own, is a
status label, and `manager_review` is already that label.

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
| `NEXT_PUBLIC_ENABLE_TEAM_REVIEWERS` | off | The team-reviewers editor on `/campaigns/new`, and the reviewer rows `createCampaign` writes. **One of its two blockers is gone: `campaign_reviewers` now grants real access** (#132, decided 2026-08-30 — see "Campaign access roles" below). It stays off for the other one: the editor mints placeholder identities (`user-temp-<timestamp>`) for people with no account, so it writes rows for users who cannot log in. Those rows are inert rather than dangerous — `campaign_role()` matches on `auth.uid()`, which a placeholder id never is — but a reviewer list full of people who can never see the campaign is worse than no list. Stays off until reviewer invites create real accounts. |

### Campaign access roles (decision 2026-08-30)

`campaign_reviewers` and `reviewer_role_enum` shipped in the first schema
migration and **nothing referenced them for five months**. Every campaign-scoped
policy tested `campaigns.user_id = auth.uid()`, so assigning a teammate granted
them the ability to read the row saying they were a reviewer, and nothing else —
while the editor implied otherwise. That was issue #132.

There is now one ladder, and every level includes the ones beneath it:

| Role | May |
| --- | --- |
| `observer` | read everything on the campaign |
| `reviewer` | + decide: transition an application, re-score, write audit rows |
| `lead` | + configure: rubrics, questions, SLA timers, availability, the reviewer list |
| `owner` | + delete the campaign |

- **The database is the boundary.** `can_view_campaign` / `can_decide_campaign`
  / `can_manage_campaign` are `SECURITY DEFINER` SQL functions, and definer is
  load-bearing rather than convenience: a policy ON `campaigns` that queries
  `campaigns` re-enters its own policy and recurses.
- **`transition_application` had to change too**, and missing it would have made
  the rest cosmetic. It is `SECURITY DEFINER`, so RLS does not apply to it — it
  did its own owner check and would have refused a reviewer with "Access denied"
  no matter how the policies read. It now calls `can_decide_campaign`.
  `transition_application_system` is untouched: the cron and agent path has no
  session and therefore no role to check.
- **An observer is refused twice** — by `meetsCampaignRole` at the top of the
  action, and by the policy underneath. The rules layer
  (`src/lib/rules/campaign-access.ts`) is pure and exists so an action fails
  with a readable error instead of surfacing a policy violation as an empty
  result set three calls later. It is defence in depth, never the boundary.
- **Reading and configuring are different authorities.** A reviewer decides
  about a candidate; changing the rubric everyone is judged against is a lead's.
  `screening-questions.ts` splits on exactly that line.
- **`verifyCampaignOwnership` still exists and is still owner-only.** Use
  `fetchCampaignRole` for anything a reviewer should also reach.

---

## Voice Screening — the live call

The screening stage is a **live voice call**, not a form. After token
verification the server opens a **per-attempt** LiveKit room and mints the
candidate's join grant (`src/lib/services/livekit.ts`) — per-attempt because a
re-record is a new call, which is also what lets somebody who picked the wrong
language pick again by starting over. The candidate talks to an OpenAI Realtime
agent run by a standalone worker (`agents/screening/` — its own package, its own
`pnpm install` / `pnpm dev`, deployable to LiveKit Cloud). The worker must be
running or candidates join a silent room; see `agents/screening/README.md`.

The transcript is the durable record and **audio is never stored**. The
candidate's browser never supplies transcript content: it submits only the
token, and the server finalizes from the draft the worker reported to
`POST /api/agent/screening/transcript` (`AGENT_API_SECRET`, admin-client write,
draft-only while the response is `sent`).

> **The reasoning behind every rule below — including several designs that were
> tried and reversed, and the whole pull-protocol era that preceded the current
> one — is in
> [docs/decisions/voice-screening-worker.md](docs/decisions/voice-screening-worker.md).**
> That file is the record; this section is the contract.

### The app decides every question; the worker only speaks it

**`create_response: false`.** OpenAI cannot start a turn. Nothing is said on a
screening call unless the worker asked for it with `generateReply`, and the
worker only ever asks for the question the app's directive named:

```
greet → candidate speaks → POST turn_completed → the app names the next
question → generateReply(it) → POST topic_started → arm the candidate's
minute → … → directive `close` → generateReply(goodbye) → wind down
```

- **There is no improvisation and no kill switch.** An interviewer choosing its
  own questions holds a normal-sounding conversation that evidences no rubric
  dimension — so the candidate scores 0 across the board and nothing in the
  record says why. A kill switch whose off position reinstates that is not a
  safety measure. An unusable directive reaches `FAILED`, which says one short
  technical sentence and closes the room; the recruiter re-sends the link.
- **The topic list is withheld from the prompt** (`withholdTopics`), so it is
  not readable from the browser. A worker that loses the app mid-call falls back
  to `buildScreeningTopicFallback` — the only circumstance in which this
  interviewer picks its own questions.
- **A Realtime model will not reliably call a tool because it was asked to.**
  `next_topic` and `end_interview` were tried four ways — reworded, moved to the
  top of the prompt, made the only channel, pinned with `toolChoice` — and
  called **zero times in 33 turns**. `contracts.test.ts` now asserts both
  strings are absent from the worker. Anything the product cannot afford to lose
  is driven from observable state, never from the model's cooperation.

### The worker is one finite state machine

`agents/screening/src/machine.ts` — seven phases (`IDLE`, `GREETING`, `ASKING`,
`LISTENING`, `FINISHING`, `DONE`, `FAILED`), one `turnOwner`, one **pure
reducer**, one **synchronously drained** event queue. Every asynchronous source
— LiveKit session events, timers, backend replies — becomes an `InterviewEvent`.
A callback may record what only it can observe; it may not decide.

This replaced a dozen loose booleans, each written by whichever callback
happened to observe the thing it described. Callbacks fire concurrently, so "the
state" was whatever combination a given interleaving produced — and every bug in
this worker's history is a combination nobody had enumerated. They are now
either in the transition table or unreachable.

`FAILED` is nearly terminal, with exactly one edge out: `GOODBYE_FINISHED`
carries it to `DONE`. Without that the room sits open until the backstop, the
browser is never told to submit, and the expiry sweep rejects a candidate for an
interview they actually sat.

### The interviewer never talks over the candidate

- **`turnOwner` gates every utterance.** A question decided while the candidate
  is still talking is held in `pendingQuestion` and asked when they stop,
  bounded by `SPEAK_HOLD_MS` (10s). The close is held the same way by
  `pendingClose`, bounded by `CLOSE_HOLD_MS` (20s) — longer, because a held
  question delays the interview while a held goodbye delays nothing.
- **`openingQuestion` is a separate field from `pendingQuestion`.** Both are
  held questions, but they fire on different signals: a deferred question the
  instant the candidate pauses, the opening question only once the audio check
  has settled. Sharing one field asks topic 1 over a candidate who said "yes —"
  and kept going.
- **Barge-in is OFF, and it takes two settings**, because two different parties
  do the cancelling:
  - `interrupt_response: false` stops **OpenAI's** VAD cancelling its own
    response.
  - `handle.allowInterruptions = false` on the `SpeechHandle` stops the
    **framework**, which runs its own interruption on every
    `input_speech_started` no matter what OpenAI was told.

  The `allowInterruptions` **option** — passed to the session or to
  `generateReply` — is silently forced back to `true` for a RealtimeModel with
  server-side turn detection. It reads as a guarantee and provides none. A
  contract test pins both working assignments and pins that the option is never
  passed. Expect one framework error line per attempt, worded as though it were
  impossible (*"…current speech is not interruptable, this should never
  happen!"*): that is the sound of a question surviving a cough.
- Turn **detection** is untouched — every word still reaches the transcript the
  scorer reads. Speech simply cannot end a question or be mistaken for the
  answer to it.
- The one exception is `budgetExpired`, which stands the politeness down so
  running out of time cannot delay the **next question**. It does **not**
  override the wait at the close, where nothing is delayed but the ending of a
  call that is already over.

### One clock, and it is the candidate's minute

`ANSWER_BUDGET_MS` is **60s**, single-sourced against
`SCREENING_ANSWER_BUDGET_MS` and pinned by a test.

- **Armed at `QUESTION_FINISHED`** — when the audio stops, not when the question
  was decided. Both earlier trigger points run ahead of the audio; one live call
  spent thirteen seconds of a candidate's minute on the interviewer's own voice.
- **It only ever counts down.** An earlier scheme started it at the candidate's
  first word, so thinking time was free and the counter jumped *up* when they
  began speaking. A timer that runs backwards reads as broken however generous
  it actually is.
- **It is visible to the candidate**, published over the LiveKit data channel
  (`SCREENING_ANSWER_TOPIC`), carrying REMAINING milliseconds rather than a
  deadline — so a wrong system clock cannot mistime it — and re-sent every 5s,
  which heals reconnects, late joins and dropped packets with one mechanism. It
  is **frozen** (grey, with a caption) while the interviewer holds the floor: a
  stopped clock and no clock must not look alike, and a frozen number may hold
  or fall but never rise.
- **Zero moves the call on, whoever is talking.** There is no grace period; the
  constant that provided one is deleted, and a test asserts the app exports no
  grace. What makes that fair is the countdown itself — nobody is cut off by a
  deadline they could not see coming. **If the visible countdown is ever
  removed, this decision has to be revisited with it.**
- **A pause is not an ending.** `ANSWER_SETTLE_MS` (3s) holds a finished turn in
  case they resume, and `answerHoldMs` returns **`null`** below
  `SUBSTANTIAL_ANSWER_WORDS` (12) — so "I don't know." plus a think does not
  settle a topic on three words. `GREETING_SETTLE_MS` (1s) is deliberately
  shorter: "can you hear me?" is answered in one word, and a three-second hold
  there is dead air at the moment a candidate is most likely to decide the thing
  is broken.
- **The "I'm done" button is what makes that generosity free**
  (`SCREENING_DONE_TOPIC`, the one packet travelling browser → worker). It
  carries no content and could not be trusted with any: the app decides every
  question, so the most a forged packet can do is end the sender's own answer
  early. Best-effort — if it never lands the countdown runs out and the call
  moves on by itself.

### Ending the call

- **The goodbye's last sentence must be a statement.** Closing an interview by
  inviting questions is one of the model's strongest habits, and it is the worst
  possible moment for one: `GOODBYE_FINISHED` goes straight to `DONE`,
  `windDown` publishes `screening.finished`, and **the browser submits on that
  packet**. `endsOnAQuestion` reads the sign-off's own transcript turn —
  snapshotted before the request (`interviewerTurnSince`), so it can never read
  the *previous* question by mistake — and holds the room open
  (`CLOSING_ANSWER_MS`, 20s) instead of closing. A trailing question mark only,
  because an open question is routinely an imperative; the mark is read only in
  the direction of waiting longer. Arabic and full-width marks count.
- **`beginDone` is the single door into `DONE`.** Four things reach it — a
  delivered goodbye, a redelivered one, an answered closing question, a window
  running out — and they must leave the same state behind.
- **A finalized turn is not a finished answer.** Speech and transcription are
  different events, so `createFinalAnswerBarrier` holds the close until words
  already spoken have finished transcribing. Anything closing in between
  publishes over a draft missing the last thing they said, and nothing recovers
  it. Bounded by `FINAL_TURN_SETTLE_MS` (8s); giving up logs
  `screening.worker.final_turn_unsettled` and records both halves — speech WAS
  observed, the transcript was NOT.
- **An answer we could not hear is counted, never scored as silence.** OpenAI
  Realtime understands audio natively, while the TEXT comes from a separate
  transcription sidecar — so when that sidecar fails the conversation carries on
  perfectly and the transcript is simply empty. The barrier books it as a
  `LostAnswer` and warns `screening.worker.answer_unheard`; the ledger counts
  `unheardAnswers` **per call, never per topic**, because by the time the worker
  learns of it the call has moved on and a stamp made in error cannot be undone.
  It is a diagnostic and **never an input** — nothing in
  `src/lib/screening-scoring/` reads it, and no rule branches on it. The
  recruiter gets an amber notice above the breakdown saying the score may be
  understated and that the failure is ours, pointing at the transcript or a
  fresh link — never at a rejection.
- **Watchdogs, because silence is the failure a push protocol buys:**
  `SILENCE_NUDGE_MS` (20s), `SPEAK_BACKSTOP_MS` (45s), `GOODBYE_BACKSTOP_MS`
  (25s), and `SCREENING_CALL_BACKSTOP_MINUTES` (30) as a failure bound that
  nothing quotes, nothing displays, and a behaving call never approaches.

### One question, one answer, the next question

**Follow-up probes do not exist**, on either side of the wire. Every answer
settles its topic, however thin.

The prompt is the half that matters and it says so outright — *"Never probe,
never ask a spontaneous follow-up."* The old prompt ordered a probe after every
answer, unconditionally, needing no tool call; deleting the machinery without
deleting the invitation would leave the model probing exactly as before with
nothing left to observe it. What this gives up is depth on a vague answer; what
it buys is a call with nothing to reason about, and a minute not spent re-asking
a topic already covered. Evidence is read from the WHOLE transcript, never from
one answer.

### The candidate picks the language before the call, not in it

Chosen in the browser, carried in **room metadata**. That is the second and only
other thing metadata has ever held (see the trust-boundary section below), and
it is allowed for exactly the reason the application id is: it came *from* that
browser seconds earlier.

- **A closed enum on both sides** — `callLanguageSchema` in the app,
  `readCallLanguage` in the worker, which deploy separately. This is a security
  property, not tidiness: the value is written into the interviewer's own
  instructions, so free text would let a candidate put a directive in the
  prompt. An unrecognised value **falls back to English rather than failing the
  call**.
- **It belongs to the room, not the application**, so somebody who picked wrong
  gets to pick again by starting over. `null` leaves it unpinned, which restores
  matching whatever the candidate speaks — right when we do not know, wrong as a
  default.
- **Repeated on every instruction** (`speakIn`), because the questions are
  stored in English and pull each turn back toward it. The greeting, the goodbye
  and the technical-failure sentence all carry it.
- The prompt forbids the interviewer raising language **at all**: no asking, no
  offering to switch, no confirming. Raising it mid-call is what produced the
  flipping this area exists to prevent.

### Topic coverage is enforced at runtime, not asked for in a prompt

The app owns a **topic ledger** (`src/lib/screening/topic-ledger.ts`, pure)
recording per topic: status (`pending` | `in_progress` | `complete` |
`insufficient`), `askedAt`, and a one-line evidence note. It is persisted on
`screening_question_responses.topic_state` and driven by the worker through
`POST /api/agent/screening/control` — the only agent route that is a round-trip
rather than a report.

- **The evaluator advises; the rule decides.** `services/screening-turn.ts`
  reports on one answer and reconciles which topic an exchange actually covered.
  Its `nextAction` is captured for the audit trail and **overridden** by the
  rule layer. Candidate speech reaches it fenced and labelled untrusted.
- **`insufficient` is a coverage word, not a score.** Nothing in
  `src/lib/screening-scoring/` reads `topic_state`, and evidence extraction
  still reads the WHOLE transcript per dimension — narrowing it to "that topic's
  answer" would recreate the per-question bug retired on 2026-08-22.
- **Every failure path resolves to a usable directive; a candidate is on the
  phone.** A dead evaluator retries once, then settles the topic **`complete`**
  — not `insufficient`, because our outage must not land on their file — and
  advances.
- `SCREENING_PROMPT_VERSION` is `sc-v6`. `topic_state` is NULL for every call
  taken before the ledger and is not back-filled: a coverage record should show
  what was observed, not what today's code would have observed.

---

## AI Interview

A real-time conversational interview on a **desktop-only** client, run by a
second standalone worker (`agents/interview/`). Questions are improvised from
the candidate's own CV — "you said you rebuilt the ingest pipeline, what broke?"
is hard to bluff in a way "tell me about system design" is not — which is why
there is deliberately no mechanism aiming a question at each rubric dimension,
and why the scorer drops dimensions the interview never reached rather than
scoring them 0. See "The interview is scored the same way as screening".

`INTERVIEW_DURATION_MINUTES` is **10**. The PRD asks for 30–45 (3.5.3); the
divergence is real and unrecorded as a decision — treat it as an open question
rather than as settled.

**The AI interview is not recorded.** LiveKit Egress, the `interview-recordings` bucket, `interview_sessions.recording_url` and the `SUPABASE_S3_*` env vars were all removed on 2026-08-04 (migration `20260804140000_drop_interview_recordings.sql`). The candidate's camera exists only as a live track: the agent worker samples frames in memory for proctoring and discards them. **Do not reintroduce recording** without revisiting the decision recorded in "AI Interview" above — the absence of stored video is a deliberate privacy posture, not missing work.

---

## Worker Trust Boundary & Instructions

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

---

## Proctoring

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

---

## Integrations

### Social publishing (LinkedIn)

Social publishing (`src/lib/services/linkedin.ts`) lets a recruiter publish a "we're hiring" post to their own LinkedIn feed from a campaign's **Share on social** panel. It mirrors the Gmail integration: the OAuth **app** credentials (`LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`) live in env; the per-recruiter **access token** is obtained via consent (Settings → Integrations → Connect LinkedIn) and stored in the `social_connections` table (one row per `user_id` + `provider`, owner-only RLS, read server-side only). Connect/callback route handlers live in `src/app/api/integrations/linkedin/{connect,callback}/route.ts`; publishing goes through `publishLinkedInPost` (`src/lib/actions/social-publish.ts`). **Setup:** create a LinkedIn app, request the *Sign In with LinkedIn using OpenID Connect* + *Share on LinkedIn* products (approval required), set the two env vars, and register the redirect URL `<origin>/api/integrations/linkedin/callback`. Until then the Connect flow fails closed and nothing else breaks. AI **only drafts** the post copy; the recruiter reviews/edits and clicks Publish — the app never posts on its own. LinkedIn access tokens are long-lived (~60 days) and are not silently refreshed; an expired token surfaces as "Reconnect needed."

### Gmail (outbound only)

Gmail integration (`src/lib/services/gmail.ts`) uses the `googleapis` SDK and is **outbound-only** — it sends candidate emails (screening/interview links) from the recruiter's connected inbox.

**Inbox resume ingestion is retired and will not be built (decision 2026-08-23).** Candidates enter exclusively through the public apply page `/apply/<slug>`; PRD 3.2.1 is amended in place to say so, and issue #163 was closed against this decision. The reason is routing: an inbox cannot say which campaign a CV is for, so it needs a rule the recruiter maintains by hand — a label, an alias, a plus-address — and every such rule is a way for a real applicant to land nowhere. The apply link carries the campaign in the URL, so an application is bound to a campaign by construction rather than by inference, and the candidate gets a confirmation instead of silence. **Do not reintroduce an inbound sweep** without revisiting this; `ingestResumeDocument` still takes a `source` tag, and its presence is not an invitation. The one loose end is the OAuth scope: `gmail.modify` grants whole-mailbox read and was sized for the retired sweep — sending needs only `gmail.send` (plus `openid email` for the callback's address lookup, which currently uses `users.getProfile`). The OAuth **app** credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) live in env; the per-recruiter **refresh token** is obtained via the consent flow and stored in the `gmail_connections` table (one row per `user_id`). A recruiter connects/changes their inbox under **Settings → Integrations**, which drives the OAuth round-trip through the route handlers in `src/app/api/integrations/gmail/{connect,callback}/route.ts`. Outbound sends (`src/lib/actions/gmail-sender.ts`) read the stored token (server-side only) to build the Gmail client. The refresh token is a secret: protected by owner-only RLS, never returned to the browser; encryption-at-rest (pgcrypto / Supabase Vault) is a future hardening step. **Setup:** in the Google Cloud OAuth client, register the redirect URI `<origin>/api/integrations/gmail/callback` (e.g. `http://localhost:3000/...`) and allow the `gmail.modify` scope (a superset of `gmail.send`).

### Resume extraction (Datalab Marker)

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

---

## Scheduled Jobs (Cron)

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
