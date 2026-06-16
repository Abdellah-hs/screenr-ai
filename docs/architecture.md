# Screenr AI — Architecture

A reading map for the whole project. The goal of this document is one thing: make it possible for a new contributor (or future-you) to open any file and know **why it exists, what layer it belongs to, and what it is allowed to do**.

If you only read one section, read [Core principles](#core-principles) and [The three layers](#the-three-layers). Everything else follows from those.

---

## Core principles

Four rules shape every design decision in this codebase. When in doubt, resolve ambiguity in the order below.

1. **Control > AI > Data.** Screenr is a controlled state machine. AI produces evidence (scores, rationale, classifications); rules decide what happens. AI never mutates state directly.
2. **One chokepoint per invariant.** Anything that must not be bypassed lives behind a single function. Application state changes go through `transitionApplication()`. Auth is checked in the action layer. No parallel paths.
3. **Layers have one direction.** UI → Actions → (Data | Services) → external world. Never the reverse. A data-layer function never calls a service; a service never calls Supabase directly.
4. **AI output is evidence, not truth.** Every AI call persists `{raw_output, normalized_fields, model_version, prompt_version, rationale}`. Old outputs are appended, never overwritten.

---

## The three layers

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
│  - Auth guard: supabase.auth.getUser()                          │
│  - Input validation: Zod schemas in src/lib/validations.ts      │
│  - Rate limiting: src/lib/rate-limit.ts                         │
│  - Orchestration: calls data + services, enforces rules         │
│  - Ends with redirect() or revalidatePath()                     │
└─────────────┬──────────────────────────────────┬────────────────┘
              │                                  │
              ▼                                  ▼
┌─────────────────────────────┐   ┌──────────────────────────────┐
│  Data  (src/lib/data)       │   │  Services (src/lib/services) │
│  - Pure Supabase queries    │   │  - Third-party integrations  │
│  - No auth, no validation   │   │  - OpenAI, Gmail, PDF, email │
│  - Functions ending in `Tx` │   │  - No DB writes              │
│    do multi-table writes    │   │                              │
└─────────────┬───────────────┘   └──────────────────────────────┘
              ▼
          Supabase / Postgres
```

### Why the split matters

- **Actions** is where the hard thinking lives — auth, validation, orchestration, business rules. It's also the most test-worthy layer.
- **Data** is deliberately boring. Each function is one query or one `Tx` bundle of queries. No branching on user identity. That is the action's job.
- **Services** are boundaries with the outside world. They exist so the rest of the code can pretend OpenAI and Gmail are synchronous, typed functions that don't fail the way real HTTP APIs do.

You can always tell which layer a file belongs to by asking: _"Does this file know about the logged-in user?"_

- **Yes** → it's an action.
- **No, and it talks to Supabase** → it's data.
- **No, and it talks to an external API** → it's a service.

---

## Directory map

```
src/
├── app/                           Next.js App Router
│   ├── (dashboard)/              Auth-gated pages (campaigns, candidates)
│   ├── auth/callback             Supabase OAuth return
│   ├── login/ signup/            Public auth pages
│   └── respond/                  Candidate-facing token pages (no login)
│
├── components/
│   ├── ui/                       Primitives (Button, Card, Modal, …)
│   ├── campaigns/                Campaign-scoped components
│   └── candidates/               Candidate-scoped components
│
├── lib/
│   ├── actions/                  ★ Layer 1 — Server Actions
│   │   ├── campaigns.ts
│   │   ├── candidates.ts
│   │   ├── screening-questions.ts
│   │   ├── respond.ts            Candidate-facing (token-authed)
│   │   └── ai-generate.ts        AI-powered content generation
│   │
│   ├── data/                     ★ Layer 2a — Supabase queries
│   │   ├── campaigns.ts
│   │   ├── candidates.ts
│   │   ├── screening-questions.ts
│   │   └── transitions.ts        ⚠ Sole entry point for status writes
│   │
│   ├── services/                 ★ Layer 2b — external APIs
│   │   ├── openai.ts
│   │   ├── gmail.ts
│   │   ├── pdf.ts
│   │   ├── email.ts
│   │   ├── screening-questions.ts
│   │   └── email-templates/
│   │
│   ├── auth/                     Token helpers (screening-token.ts)
│   ├── supabase/                 Client factories (server.ts, client.ts)
│   ├── constants.ts              Domain types + state transition table
│   ├── validations.ts            Zod schemas (mirrors constants enums)
│   ├── rate-limit.ts             In-memory bucket (TODO: Redis)
│   └── utils.ts                  cn(), small helpers
│
├── types/
│   └── database.types.ts         Auto-generated by `supabase gen types`
│
└── middleware.ts                 Route protection + cookie refresh
```

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

## End-to-end flow: Gmail → scored application

A single representative path, stitched through every layer:

```
User clicks "Sync Gmail" on a campaign
           │
           ▼
   (UI)  src/components/candidates/gmail-sync-button.tsx
           │ formAction
           ▼
(Action) syncResumesFromGmail()                     src/lib/actions/candidates.ts
           │  auth.getUser()              ← Layer 1 concerns
           │  checkRateLimit()
           │  orchestrate:
           │    ├── fetchUnreadGmailResumes()       ↓ src/lib/services/gmail.ts
           │    ├── parsePdf()                        src/lib/services/pdf.ts
           │    ├── extractResumeData()               src/lib/services/openai.ts
           │    ├── uploadResumeToStorage()         ↓ src/lib/data/candidates.ts
           │    ├── upsertCandidate()
           │    ├── createApplicationIfNotExists()
           │    └── logAiAudit()
           │
           │  if criteria exist:
           │    scoreApplicationResume()           — AI layer (evidence)
           │      └─ saveResumeScore()               src/lib/data/candidates.ts
           │    evaluateResumeScoringOutcome()     — Rule layer (decision)
           │      └─ transitionApplication()         src/lib/data/transitions.ts
           │            └─ RPC transition_application (atomic)
           │                  ├─ UPDATE applications.status
           │                  └─ INSERT application_transitions
           ▼
      revalidatePath("/campaigns/[id]")
```

Read this flow once, and then read [syncResumesFromGmail](../src/lib/actions/candidates.ts) — everything else in the project follows the same shape.

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
| A new page | `src/app/(dashboard)/` or `src/app/respond/` |
| A form submit handler | `src/lib/actions/` |
| A new Supabase query | `src/lib/data/` |
| A new OpenAI/Gmail/PDF call | `src/lib/services/` |
| A new domain enum | `src/lib/constants.ts` + `src/lib/validations.ts` (same commit) |
| A new application state | `candidate_stage_enum` (migration) + `constants.ts` + `validations.ts` |
| A new transition | `APPLICATION_STATE_TRANSITIONS` in `constants.ts` |

If you can't decide, ask: _does this file know about the logged-in user?_ The answer tells you the layer.

---

## Further reading

- [CLAUDE.md](../CLAUDE.md) — working agreements, state-machine rules, testing policy
- [docs/prd.md](./prd.md) — product requirements
- [docs/onboarding.md](./onboarding.md) — intern onboarding walkthrough
