# Screenr AI — Architecture

A reading map for the whole project. The goal of this document is one thing: make it possible for a new contributor (or future-you) to open any file and know **why it exists, what layer it belongs to, and what it is allowed to do**.

Last reviewed **2026-08-20** against `main`. If you only read one section, read [Core principles](#core-principles) and [The layers](#the-layers). Everything else follows from those.

---

## Core principles

Four rules shape every design decision in this codebase. When in doubt, resolve ambiguity in the order below.

1. **Control > AI > Data.** Screenr is a controlled state machine. AI produces evidence (scores, rationale, classifications); rules decide what happens. AI never mutates state directly.
2. **One chokepoint per invariant.** Anything that must not be bypassed lives behind a single function. Application state changes go through `transitionApplication()`. Auth is checked in the action layer. No parallel paths.
3. **Layers have one direction.** UI → Actions → (Rules | Pipelines) → (Data | Services) → external world. Never the reverse. A data-layer function never calls a service; a service never calls Supabase directly; a rule calls nothing at all.
4. **AI output is evidence, not truth.** Every AI call persists `{raw_output, normalized_fields, model_version, prompt_version, rationale}`. Old outputs are appended, never overwritten.

---

## The layers

This started as three layers (actions / data / services). It is now six. The
three extra ones were not added for tidiness — each exists because something
kept ending up in the wrong place:

- **Rules** came out of actions, because a decision buried in an `if` inside a
  Server Action cannot be tested without a database and a session.
- **Pure domain packages** came out of rules, because some logic is too big for
  one decision function but must still never touch I/O.
- **Pipelines** came out of actions, because one flow can have more than one
  entry point — a candidate's request today, a cron sweep tomorrow — and it
  cannot live inside either one of them.

```
┌─────────────────────────────────────────────────────────────────┐
│  UI  (src/app, src/components)                                  │
│  - React Server + Client Components                             │
│  - Forms submit to Server Actions                               │
│  - Never imports from src/lib/data or src/lib/services          │
└───────────────────────────┬─────────────────────────────────────┘
                            │  calls
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Actions  (src/lib/actions)                                     │
│  - Entry point for mutations and reads from React               │
│  - Auth guard: requireUserId() / verified candidate token       │
│  - Input validation: Zod schemas in src/lib/validations.ts      │
│  - Rate limiting: src/lib/rate-limit.ts                         │
│  - Ends with redirect() or revalidatePath()                     │
└──────┬──────────────────┬───────────────────┬───────────────────┘
       │                  │                   │
       ▼                  │                   ▼
┌──────────────────┐      │      ┌─────────────────────────────────┐
│  Rules           │      │      │  Pipelines (src/lib/screening,  │
│  (src/lib/rules) │      │      │  resume-ingest, scheduling,     │
│  - PURE          │      │      │  interview)                     │
│  - evidence in,  │      │      │  - Multi-step use-cases         │
│    decision out  │      │      │  - Run on an INJECTED db client │
│  - no I/O, no    │      │      │    so a cron with no session    │
│    clock, never  │      │      │    can reuse the same flow      │
│    transitions   │      │      │  - No auth, no Zod, no rate     │
└──────────────────┘      │      │    limiting — the caller's job  │
                          │      └──────────────┬──────────────────┘
       ┌──────────────────┴──────────────┐      │
       ▼                                 ▼      ▼
┌─────────────────────────────┐   ┌──────────────────────────────┐
│  Data  (src/lib/data)       │   │  Services (src/lib/services) │
│  - Pure Supabase queries    │   │  - Third-party integrations  │
│  - No auth, no validation   │   │  - OpenAI, Gmail, Calendar,  │
│  - Functions ending in `Tx` │   │    LiveKit, Marker, email    │
│    do multi-table writes    │   │  - No DB writes              │
└─────────────┬───────────────┘   └──────────────────────────────┘
              ▼
          Supabase / Postgres

  Pure domain packages (src/lib/resume-scoring, proctoring, talent-pool,
  scoring, candidates) sit beside the rules layer: versioned, dependency-free
  logic that is too big for a single rule and must never touch I/O.
```

### Why the split matters

- **Actions** is the only layer that knows who is asking. Auth, validation, rate limiting.
- **Rules** is where "Control > AI > Data" is enforced. A rule reads evidence and returns a decision; the action executes it. A rule that imports Supabase has stopped being a rule.
- **Pipelines** are an action body lifted out so several callers can share it. `ingestResumeDocument` is the canonical one — driven today by the public apply action, reusable tomorrow by a cron sweep. They still route every status change through `transition()`.
- **Data** is deliberately boring. One query, or one `Tx` bundle. No branching on user identity.
- **Services** are boundaries with the outside world, so the rest of the code can pretend a third-party API is a typed function.

The old heuristic ("does this file know about the logged-in user?") still works,
but it no longer separates everything. Ask in this order:

1. **Does it decide something, with no I/O?** → `rules/` (or a pure domain package if it's a whole module).
2. **Does it know who is asking?** → `actions/`.
3. **Does it run several steps, on a db client handed to it?** → a pipeline.
4. **Does it talk to Supabase and nothing else?** → `data/`.
5. **Does it talk to an external API?** → `services/`.

---

## Directory map

```
src/
├── app/                           Next.js App Router
│   ├── (dashboard)/              Auth-gated pages (campaigns, candidates, admin)
│   ├── api/                      The ONLY route handlers — everything else
│   │   ├── agent/                  is a Server Action
│   │   │                         Agent workers report in (AGENT_API_SECRET)
│   │   ├── cron/                 Scheduled sweeps (CRON_SECRET, fail closed)
│   │   ├── integrations/         Gmail + LinkedIn OAuth round-trips
│   │   └── webhooks/             Google Calendar push notifications
│   ├── auth/callback             Supabase OAuth return
│   ├── login/ signup/            Public auth pages
│   ├── apply/[slug]              Public application page (resume intake)
│   └── respond|interview|schedule|prep/[token]
│                                 Candidate-facing token pages (no login)
│
├── components/
│   ├── ui/                       Primitives (Button, Card, Modal, …)
│   ├── campaigns/ candidates/    Domain-scoped components
│   ├── realtime/ scheduling/     Live interview client, slot picker
│   └── admin/ settings/          Audit log view, integrations
│
├── lib/
│   ├── actions/                  ★ Server Actions — auth, Zod, rate limit
│   │   ├── campaigns.ts  candidates.ts  respond.ts (token-authed)
│   │   └── …
│   │
│   ├── rules/                    ★ PURE decisions — evidence in, decision out
│   │   ├── transitions/scoring/expiry/sla/bulk-actions/…
│   │   └── README.md             The full contract. Read before adding one.
│   │
│   ├── resume-ingest/ screening/ scheduling/ interview/
│   │                             ★ Pipelines — multi-step use-cases on an
│   │                               injected db client (works session-less)
│   │
│   ├── resume-scoring/ proctoring/ talent-pool/ scoring/ candidates/
│   │                             ★ Pure domain packages — versioned,
│   │                               dependency-free, no I/O and no clock
│   │
│   ├── data/                     ★ Supabase queries
│   │   ├── transitions.ts        ⚠ Sole entry point for status writes
│   │   └── …
│   │
│   ├── services/                 ★ External APIs
│   │   ├── openai.ts  gmail.ts  calendar.ts  livekit.ts  linkedin.ts
│   │   ├── marker.ts             Resume text extraction (Datalab)
│   │   └── email.ts  email-templates/
│   │
│   ├── auth/                     guards.ts, screening-token.ts (HMAC tokens)
│   ├── supabase/                 server.ts, client.ts, admin.ts (service role)
│   ├── constants.ts              Domain types + state transition table
│   ├── validations.ts            Zod schemas (mirrors constants enums)
│   ├── flags.ts                  Feature flags — default off, held server-side
│   ├── rate-limit.ts             In-memory bucket (TODO: Redis)
│   └── utils.ts                  cn(), small helpers
│
├── types/
│   └── database.types.ts         Auto-generated by `supabase gen types`
│
└── middleware.ts                 Route protection + cookie refresh

agents/                            Standalone workers — their own packages,
├── screening/                     their own pnpm install, deployed to
└── interview/                     LiveKit Cloud. NOT part of the Next build.
```

### The agent workers are outside the app

`agents/screening/` and `agents/interview/` are separate Node packages that join
a LiveKit room and run the live conversation. They are worth understanding as a
trust boundary, not just a deployment detail:

- The app sets the agent's instructions **server-side**, via room metadata. The
  candidate's browser never supplies them.
- The worker reports the transcript (and, for the interview, camera-vision
  proctoring readings) **server-to-server**, guarded by `AGENT_API_SECRET`.
  The candidate's submit carries only their token.
- That split is the whole point: anything the candidate's machine could forge is
  kept out of the record.

---

## Domain model: Candidate vs. Application

This is the single most important distinction to internalize. Getting it wrong is what makes ATS codebases turn into mud.

- **Candidate** — a _person_. Stable across campaigns. Holds identity only: name, email, phone, links.
- **Campaign** — a hiring process for one role.
- **Application** — a Candidate applying to a Campaign. _All pipeline state, scores, stage timestamps, disposition, and transitions belong to the Application._

```
Candidate  1 ─── * Application * ─── 1  Campaign
   (person)          (pipeline)         (role)
```

One Candidate has many Applications over time. A rejection in one campaign is a property of that Application, not of the Candidate. When the same person applies to a new role, the new Application starts fresh.

**Anti-pattern**: storing `stage`, `score`, or `rejection_reason` on the Candidate row. All of that belongs on the Application.

---

## The state machine

An Application is always in exactly one of the states listed in `ApplicationState` ([src/lib/constants.ts:209](../src/lib/constants.ts#L209)). No other value is legal — the DB enum `candidate_stage_enum` enforces this at the storage layer.

### Canonical flow

```
new
 ├─► screening_review_pending ─► screening_approved ─► screening_sent
 └─► screening_approved        ─────────────────────────────▲
                                                            │
            ┌───────────────────────────────────────────────┘
            ▼
 screening_sent ─► screening_completed ─► screening_scored
                                               │
                                               ▼
                      interview_scheduling ─► interview_scheduled
                                                     │
                                                     ▼
                      interview_completed ─► interview_scored
                                                     │
                                                     ▼
                            [reference_check] ─► manager_review
                                                     │
                                                     ▼
                              final_interview_scheduling ─► hired
```

### Failure & terminal states

Every failure path is explicit — never silent.

- `screening_expired` — candidate missed the response window
- `interview_no_show` — candidate didn't attend
- `processing_failed` — pipeline error (parse, score, etc.)
- `rejected` — terminal non-hire
- `hired` — terminal success
- `archived` — the only state all the above can transition into

### The single chokepoint

`transitionApplication()` in [src/lib/data/transitions.ts](../src/lib/data/transitions.ts) is the _only_ function allowed to mutate `applications.status`.

```ts
await transitionApplication({
  applicationId,
  toState: "screening_approved",
  actor: "system",              // or "ai" | "recruiter"
  rationale: "Score 87 >= threshold 80",
});
```

What it guarantees:

1. The `from → to` transition is legal per `APPLICATION_STATE_TRANSITIONS`.
2. Recruiter actors must supply a written rationale (override logging).
3. State change + audit-log row are atomic (Postgres RPC `transition_application`).

**Forbidden:** `.update({ status: ... })` anywhere outside `transitions.ts`. `updateApplicationStage` and `advanceApplicationStatus` delegate here — preserve that.

---

## AI: evidence vs. decision

Every AI-influenced stage is split into two functions with different responsibilities. The resume-scoring flow is the reference example for every future AI stage.

```ts
// 1. AI layer — produces evidence. Never transitions.
async function scoreApplicationResume(appId, campaignId, parsedResume) {
  const result = await scoreResumeAgainstCriteria(...);   // OpenAI call
  await saveResumeScore(appId, result.score, ...);        // persist evidence
  return { result, config };
}

// 2. Rule layer — reads evidence, decides next transition. Never calls AI.
async function evaluateResumeScoringOutcome(appId, result, config) {
  if (config.automation_mode === "human_in_loop") {
    await transition(appId, "screening_review_pending", ...);
  } else if (result.score >= config.threshold) {
    await transition(appId, "screening_approved", ...);
  } else {
    await transition(appId, "rejected", ...);
  }
}
```

See `scoreApplicationResume` and `evaluateResumeScoringOutcome` in [src/lib/actions/candidates.ts](../src/lib/actions/candidates.ts).

The separation makes two things possible:

1. You can re-run evidence generation (re-score) without re-triggering transitions.
2. You can change the decision policy (threshold, HITL rules) without touching the AI code.

### Mandatory persistence

For every AI call, persist: `raw_output`, `normalized_fields`, `model_version`, `prompt_version`, `rubric_version`, `confidence`, `rationale`. Old outputs are versioned, never overwritten.

---

## Auth model

Two distinct authentication contexts coexist:

### 1. Recruiter / Manager (account-based)

- Supabase Auth (email/password or OAuth).
- Enforced at two layers: `middleware.ts` redirects unauthenticated users out of `/campaigns/*`, and every action calls `supabase.auth.getUser()` again as a defense-in-depth check.
- Route protection logic: [src/middleware.ts](../src/middleware.ts).

### 2. Candidate (token-based, never account-based)

- Candidates never log in. They receive links with signed tokens.
- Token creation/verification: [src/lib/auth/screening-token.ts](../src/lib/auth/screening-token.ts).
- Candidate pages live under `src/app/respond/` and the corresponding actions in [src/lib/actions/respond.ts](../src/lib/actions/respond.ts).
- PRD constraint: candidate flows must stay token-based forever. Do not add candidate login.

---

## Input validation

Every Server Action that accepts user input runs it through a Zod schema before doing anything else. Schemas live in [src/lib/validations.ts](../src/lib/validations.ts).

**Rule**: every enum in `constants.ts` has a matching Zod enum in `validations.ts`. When you add a new status value, update both in the same commit — otherwise form submissions will reject the new value with a confusing error.

Covered in [src/lib/validations.test.ts](../src/lib/validations.test.ts).

---

## End-to-end flow: application → scored candidate

A single representative path, stitched through every layer. Note where the
action stops and the pipeline starts — that boundary is the point of the
example.

```
Candidate uploads a CV at /apply/<slug>        (public, no account)
           │
           ▼
(Action) submitApplication()                        src/lib/actions/apply.ts
           │  Zod validation                ← the action's concerns, and only
           │  checkRateLimit(ip)              the action's: a pipeline never
           │                                  does auth, Zod or rate limiting
           ▼
(Pipeline) ingestResumeDocument()      src/lib/resume-ingest/ingest-resume.ts
           │  runs on an INJECTED db client, so a session-less caller
           │  (a cron sweep) could drive the very same flow
           │
           │    ├── extractMarkdownWithMarker()    ↓ services/marker.ts
           │    ├── extractResumeData()              services/openai.ts
           │    │     └─ classifies cv | motivation_letter | other;
           │    │        only a CV is ingested
           │    ├── uploadResumeToStorage()        ↓ data/candidates.ts
           │    ├── upsertCandidate()
           │    ├── createApplicationIfNotExists()
           │    └── logAiAudit()                   ← evidence, always persisted
           │
           │  if the campaign has resume criteria:
           │    scoreResumeAgainstCriteria()       — AI: reports EVIDENCE per
           │      │                                  criterion, never a number
           │      └─ src/lib/resume-scoring/       — pure: derives every score
           │            from the evidence, deterministically
           │    saveResumeScore()                    data/candidates.ts
           │    evaluateResumeScoringOutcome()     — RULE: decides
           │      └─ transitionApplication()         data/transitions.ts
           │            └─ RPC transition_application (atomic)
           │                  ├─ UPDATE applications.status
           │                  └─ INSERT application_transitions
           ▼
      the candidate sees a confirmation; the recruiter sees a scored row
```

Three things in that diagram are the whole architecture in miniature:

1. **The model never returns a number.** It reports an evidence level and
   verbatim quotes per criterion; `src/lib/resume-scoring/` derives the score
   from a fixed table. Ask a model for a number twice and you get two answers.
2. **Scoring is separate from deciding.** The AI produces evidence, a rule reads
   it, and only the rule calls `transitionApplication()`.
3. **Scoring is best-effort; ingest is not.** A scoring failure is logged and
   the application still exists. The reverse ordering would lose a candidate's
   CV because OpenAI had a bad minute.

Read this flow once, then read [ingestResumeDocument](../src/lib/resume-ingest/ingest-resume.ts) — everything else follows the same shape.

---

## Testing architecture

One test runner: **Vitest**. Tests live next to the file they test (`foo.ts` + `foo.test.ts`).

| Layer | What we assert | What we mock |
|---|---|---|
| Pure logic (`validations.ts`, `constants.ts`, `utils.ts`) | All branches, edge cases | Nothing |
| Services (`openai.ts`, `gmail.ts`, …) | Prompt construction, response parsing, error handling | The SDK itself |
| Data (`data/*.ts`) | Correct query is built, results shaped correctly | The Supabase client chain |
| Actions (`actions/*.ts`) | Auth rejects anon, Zod rejects bad input, correct collaborators called | `createClient`, data, services |

**Not tested**: React components, pages. UI correctness is manual (`pnpm dev`). We'll adopt `@testing-library/react` if and when component tests become necessary — not preemptively.

Rules covered in depth in [CLAUDE.md](../CLAUDE.md#testing).

---

## CI gates

`.github/workflows/ci.yml` runs on every push and PR:

```
pnpm install  →  pnpm lint  →  pnpm typecheck  →  pnpm test  →  pnpm build
```

Any failing step blocks merge. The same four commands are the local pre-push check.

---

## Anti-patterns (forbidden)

The short list of things that break the architecture. If a PR does one of these, send it back.

1. Calling `.update({ status: ... })` on `applications` outside [transitions.ts](../src/lib/data/transitions.ts).
2. UI components importing from `src/lib/data/*` or `src/lib/services/*` — they must go through an action.
3. Data-layer functions calling services, or services calling Supabase — layers are one-directional.
4. Using AI output as the final decision without a rule branch in between.
5. Merging `Candidate` and `Application` concepts — pipeline state belongs on the Application.
6. Overwriting a prior AI output or rubric — append/version instead.
7. Non-versioned AI prompts or rubrics.
8. Silent failures — every error path ends in an explicit failure state (`screening_expired`, `interview_no_show`, `processing_failed`, `rejected`).
9. Adding a new enum value to `constants.ts` without adding it to `validations.ts` in the same commit.

---

## Known coupling hotspots (migration work)

These are the places where today's code falls short of the architecture above. They are tracked in [CLAUDE.md](../CLAUDE.md#current-compliance-status). Do not extend them — migrate them when you touch the surrounding code.

- **Legacy states** (`screening`, `screening_q`, `interview`) still bridge into the canonical track. A future migration re-maps rows and drops them.
- **Candidate-submit path** (`submitScreeningAnswers`) cannot call `transition_application` directly because the RPC requires `auth.uid()`. The recruiter's `scoreScreeningAnswers` catches up with a double transition. Fix: a token-scoped RPC.
- **`upsertCandidate` auto-merges on email**; PRD requires flagging duplicates for HR review instead.
- **Screening Q&A is text-based.** PRD 3.4.3 requires video/audio. Treat the current form as a shortcut.
- **Missing first-class stages**: interview scheduling, reference check, final interview scheduling. The states exist; the flows don't.
- **`interview_no_show`, `processing_failed`** have no emission paths yet.
- **`src/lib/data/campaigns.ts` is 530 lines** — mixes campaigns, applications, and stage queries. Split planned alongside Candidate/Application separation.

---

## Where to put new code (cheat sheet)

| You're adding… | Goes in… |
|---|---|
| A new UI primitive | `src/components/ui/` |
| A new page | `src/app/(dashboard)/` or a token page under `src/app/` |
| A form submit handler | `src/lib/actions/` |
| A new Supabase query | `src/lib/data/` |
| A new OpenAI / Gmail / Calendar / LiveKit call | `src/lib/services/` |
| A decision with no I/O | `src/lib/rules/` — read its README first |
| A multi-step flow that more than one caller could drive | a pipeline (`src/lib/resume-ingest/`, `screening/`, `scheduling/`, `interview/`) |
| A whole module of pure logic (scoring, matching, summarising) | a domain package (`src/lib/resume-scoring/`, `proctoring/`, `talent-pool/`) |
| A scheduled job | `src/lib/<area>/*-sweep.ts` + a guarded route in `src/app/api/cron/` + `vercel.json` |
| A feature that is not ready | `src/lib/flags.ts` — default off, and hold the flag server-side too |
| A new domain enum | `src/lib/constants.ts` + `src/lib/validations.ts` (same commit) |
| A new application state | `candidate_stage_enum` (migration) + `constants.ts` + `validations.ts` |
| A new transition | `APPLICATION_STATE_TRANSITIONS` in `constants.ts` |

If you cannot decide, walk the five questions under [Why the split matters](#why-the-split-matters), in order. The first one that answers yes is your layer.

---

## Further reading

- [CLAUDE.md](../CLAUDE.md) — working agreements, state-machine rules, testing policy
- [docs/prd.md](./prd.md) — product requirements
- [docs/README.md](./README.md) — what every file in `docs/` is, and whether it is current
- [docs/onboarding.md](./onboarding.md) — intern onboarding walkthrough
- [src/lib/rules/README.md](../src/lib/rules/README.md) — the rules-layer contract
