---
name: screenr-ai-project-context
description: Read this skill at the start of EVERY task on this project, before writing any code, SQL, or making any architectural decision. This is the source of truth for what Screenr AI is, what it must do, what the rules are, and what is explicitly out of scope. If something in this file conflicts with a user instruction, flag it — do not silently override the architecture.
---

# Screenr AI — Project Context

## What this project is

Screenr AI is an **internal** Applicant Tracking System (ATS) and AI-powered interview platform.
It automates the full hiring pipeline for one company — from the moment a candidate emails their CV
to the moment the final interview is scheduled with the hiring manager.

The system replaces every manual hiring workflow with automation and AI. Hiring managers set up
the rules once, the AI runs the pipeline, and managers only step back in to review shortlists and
make final decisions.

This is a **greenfield build** — no legacy system to integrate with or migrate from.

---

## Repository

```
GitHub:     github.com/MatiousCorp/screenr-ai
PRD:        docs/prd.md              <- source of truth for features
Onboarding: docs/onboarding.md
Migrations: supabase/migrations/
```

---

## Who uses it

| User | Type | How they access it |
|---|---|---|
| Hiring Manager | Internal | Web dashboard — authenticated via Supabase Auth |
| HR / Recruiter | Internal | Web dashboard — authenticated via Supabase Auth |
| Admin | Internal | Web dashboard — authenticated via Supabase Auth |
| Candidate | External | Email links only — token-based, NO account, NO login |
| Reference Contact | External | Email links only — token-based, NO account, NO login |

**Candidates never create accounts.** They interact only through unique tokenised links sent by
email. Never build any feature that requires a candidate to register, log in, or create a password.

---

## The hiring pipeline — in order

Every candidate moves through these stages sequentially:

```
1.  Resume Collection         — email / LinkedIn DM / LinkedIn bulk import
2.  AI Resume Screening       — scored 0-100 against campaign criteria
3.  Screening Questions       — video responses via tokenised email link
4.  Answer Scoring            — AI transcribes and scores each video response
5.  AI Interview Scheduling   — candidate picks a slot from available times
6.  AI Interview              — live real-time video call with the AI agent
7.  Interview Scoring         — AI scores the full interview session
8.  AI Reference Check        — optional, triggered by manager
9.  Manager Review            — manager views all scores, decides what happens
10. Final Interview           — scheduled via Google Calendar, human-led
```

Each stage produces an **independent score**. There is **no composite score** — never combine
scores across stages into a single number. Managers see each stage score separately.

---

## Tech stack

Use exactly these. Items marked TBD are not yet decided — do not hardcode an alternative
without confirming with the team. Wrap TBD providers behind an abstraction in lib/ so they
can be swapped without rewriting feature code.

| Layer | Technology | Status |
|---|---|---|
| Frontend | Next.js (App Router, React, TypeScript) | confirmed |
| Backend / API | Next.js Route Handlers + Server Actions | confirmed |
| Database | Supabase (PostgreSQL) | confirmed |
| Authentication | Supabase Auth | confirmed |
| AI Engine | OpenAI (e.g., gpt-4o) — no any | confirmed |
| Language | TypeScript strict mode — no any | confirmed |
| Hosting | Hetzner Cloud (VPS + Docker) | confirmed |
| Calendar | Google Calendar API | confirmed |
| Email | Resend / Postmark / SendGrid | TBD — treat as Resend |
| Real-Time Video | LiveKit / Daily.co / Twilio | TBD — treat as LiveKit |
| Speech-to-Text | Deepgram / Whisper | TBD — treat as Deepgram |
| Text-to-Speech | ElevenLabs / Google TTS | TBD — treat as ElevenLabs |

---

## Repo structure — exact paths

This is a monorepo. The Next.js app lives at apps/web/ — not at the repo root.
All file paths must account for this.

```
screenr-ai/
├── apps/
│   └── web/                         # Next.js application
│       ├── src/
│       │   ├── app/                 # App Router — pages and API routes
│       │   │   ├── admin/           # Admin dashboard (hiring managers, HR)
│       │   │   ├── auth/            # Authentication flows
│       │   │   ├── api/             # Route Handlers (webhooks only)
│       │   │   ├── interview/[token]/    # Candidate AI interview room
│       │   │   ├── screening/[token]/    # Candidate screening questions form
│       │   │   ├── schedule/[token]/     # Candidate scheduling page
│       │   │   └── prep/[token]/         # Interview preparation guide
│       │   ├── components/
│       │   │   ├── ui/              # Primitive components
│       │   │   ├── campaigns/       # Campaign-specific components
│       │   │   └── candidates/      # Candidate-specific components
│       │   ├── lib/
│       │   │   ├── actions/         # Server Actions grouped by domain
│       │   │   ├── supabase/        # server.ts, client.ts, admin.ts
│       │   │   ├── ai/              # Claude API helpers and prompt builders
│       │   │   ├── email/           # Email helpers and React Email templates
│       │   │   └── tokens.ts        # JWT token creation and verification
│       │   └── types/
│       │       └── database.ts      # Generated by: supabase gen types typescript
├── supabase/
│   └── migrations/                  # One SQL file per schema change
├── docs/
│   ├── prd.md
│   ├── onboarding.md
│   └── skills/                      # Agent skill files live here
└── ...
```

---

## Database rules — always follow these

- Primary keys: always uuid using uuid_generate_v4()
- Timestamps: always timestamptz, never timestamp
- Soft deletes: use deleted_at timestamptz — never hard DELETE user-facing records
- JSON columns: always jsonb, never json
- Scores and weights: always numeric(precision, scale), never float
- updated_at: every table with updated_at must have the auto-update trigger
- RLS: Row Level Security must be enabled on every table — no exceptions
- Foreign keys: every FK column must have a manual index (Postgres does NOT auto-index FKs)
- Audit log: ai_audit_log is append-only — RLS must block UPDATE and DELETE permanently
- Rubric versioning: every edit creates a new version row — never overwrite in place
- Migrations: every schema change gets its own file in supabase/migrations/
  Never edit the database directly without a migration file.

---

## Build order — one module at a time

Do not jump ahead to a later phase.

```
Phase 1 — Campaign Management      <- CURRENT FOCUS
Phase 2 — Candidate Pipeline       (resume intake, parsing, dedup, AI screening)
Phase 3 — Screening Questions      (video form, upload, AI scoring)
Phase 4 — AI Interview System      (LiveKit, Deepgram, ElevenLabs, Claude)
Phase 5 — Manager Review Dashboard
Phase 6 — Reference Checks
Phase 7 — Final Interview Scheduling
Phase 8 — Analytics and Compliance (bias auditor, skill fingerprint, experience score)
```

Within each phase, always in this order:
1. Database migration (SQL file in supabase/migrations/)
2. Generate TypeScript types (supabase gen types typescript)
3. Server Actions and Route Handlers
4. UI components and pages
5. AI integration layer
6. Tests

---

## Campaign Management — current phase scope

- Campaign creation: title, description, department, location, positions_count, deadline
- Campaign status lifecycle: draft -> active -> paused -> closed -> archived
- Screening criteria: AI suggests from job description; manager accepts / edits / adds own
- Evaluation rubrics: per pipeline stage (resume, screening_q, interview); versioned; AI can generate
- Rubric dimensions: name, weight (0-1), is_mandatory, min_score, max_score, sort_order
- Campaign reviewers: multiple users assigned with roles (lead / reviewer / observer)
- SLA timers: configurable time limits per stage with alert and escalation thresholds
- Template library: campaigns and rubrics saved as reusable templates
- Campaign cloning: copy config only (not candidates) to a new draft
- Automation mode: fully_auto or human_in_loop
- Screening threshold: integer 0-100; candidates below are auto-rejected
- Interview persona: neutral | pressure | collaborative | socratic
- Audit log: every campaign change recorded in campaign_audit_log (append-only)

---

## Architectural decisions — always respect these

**Candidate pages are token-based, not session-based.**
Screening forms, scheduling pages, interview rooms, and prep guides use signed JWT tokens
in the URL. There is no Supabase session on these pages.
Always validate via lib/tokens.ts — never assume the user is authenticated.

**Server Components by default.**
Only add "use client" when the component genuinely needs browser APIs, event handlers,
or React hooks. Data fetching always happens in Server Components or Server Actions.

**Server Actions for all mutations.**
Form submissions, data writes, and state changes go through Server Actions in lib/actions/.
Never POST to an API route from a client component when a Server Action works.

**Route Handlers only for external systems.**
Use app/api/ only for webhooks (email provider, calendar) and endpoints consumed by
non-Next.js systems. Not for internal data fetching.

**All AI calls are server-side.**
OPENAI_API_KEY is server-only. It must never appear in the client bundle.
All OpenAI API calls happen in Server Actions, Route Handlers, or background jobs.

**Every AI decision must be logged.**
Before shipping any AI feature, confirm it writes a row to ai_audit_log containing:
campaign_id, candidate_id, stage, model (gpt-4o), prompt_version,
input_snapshot (jsonb), raw_output, parsed_score, rationale, action_taken.

**Scoring is always transparent.**
Every AI score must include a factor-level breakdown (score_factors table).
For interview scoring, each dimension must link to a transcript excerpt (transcript_evidence table).
Never produce an opaque score with no explanation.

**Rubrics are versioned.**
When a rubric is edited mid-campaign: set archived_at on the old row, insert a new row
with version + 1 and is_active = true.
Always record which rubric version scored each candidate.

**TBD providers are abstracted.**
Email, real-time video, STT, and TTS providers are not finalised.
Wrap all calls behind interfaces in lib/ so the provider can be swapped without touching
feature code. Example: lib/email/send.ts, lib/stt/transcribe.ts, lib/tts/speak.ts.

---

## Git and code workflow

Branching strategy:
```
main (production)
  └── feature/your-feature-name
  └── fix/bug-description
  └── chore/task-description
```
- Always branch off main
- One feature or fix per branch — keep branches small and focused
- Open a PR with a clear description (what changed, why, how to test)
- Request a review before merging — all PRs merge into main

Commit messages follow Conventional Commits:
```
feat: add campaign creation form
fix: resolve screening score display for edge case
docs: update API documentation for interview endpoints
chore: upgrade supabase-js to v2.x
refactor: extract scoring logic into shared utility
```

Code quality:
- TypeScript strict mode — no any unless absolutely unavoidable and commented
- ESLint and Prettier are configured in the repo — run pnpm lint before every PR
- Meaningful variable and function names — code should read like prose
- Comments explain why, not what — the code shows what

---

## What is explicitly OUT OF SCOPE for V1

Never build these. If asked, flag as post-V1 and do not implement:

- Candidate self-service portal or accounts of any kind
- Live coding environment / in-browser IDE
- Multi-company / SaaS mode
- Slack or any other messaging integrations
- Mobile app (AI interview is desktop-only; screening form is mobile-compatible)
- Composite scores across pipeline stages
- Automated job board posting (LinkedIn, Indeed, etc.)
- Offer letter generation
- Background check integration
- Onboarding workflow
- Advanced analytics dashboards beyond the manager review dashboard
- Candidate-facing status tracker

---

## Environment variables

```bash
# Public — safe for browser bundle
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_LIVEKIT_URL=
NEXT_PUBLIC_APP_URL=

# Server-only — NEVER expose to client or browser bundle
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
RESEND_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
DEEPGRAM_API_KEY=
ELEVENLABS_API_KEY=
TOKEN_SECRET=
```

If any server-only key is referenced in a "use client" component or any file that
ends up in the browser bundle — stop immediately and restructure. This is a critical
security vulnerability.

---

## Useful commands

```bash
# Development
pnpm dev                                  # start Next.js dev server
pnpm build                                # production build
pnpm lint                                 # run ESLint
pnpm type-check                           # run TypeScript compiler check

# Supabase
supabase start                            # start local Supabase (requires Docker)
supabase db reset                         # wipe and re-run all migrations from scratch
supabase migration new <name>             # create a new migration file
supabase gen types typescript --local     # regenerate TypeScript types after schema changes

# Claude Code
claude                                    # launch Claude Code in the project directory
```

---

## Before writing any code — check these 5 things

1. Is this feature in the PRD? If not, flag it as out of scope before building.
2. Is this in the current build phase (Campaign Management)? If not, note it but don't build it yet.
3. Does this require a candidate account or login? If yes, reject the approach entirely.
4. Is this an AI score without logging to ai_audit_log? If yes, add the logging first.
5. Am I using a server-only env variable in a client component? If yes, stop and restructure.
