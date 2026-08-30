# Screenr AI

**Internal ATS & AI Interview Platform**

Screenr AI is an internal Applicant Tracking System (ATS) and AI-powered
interview platform. A candidate applies through a campaign's public link and can
reach a hiring decision without a manual step that was not chosen deliberately.

It is a **controlled state machine, not an AI agent**: the AI reads, scores and
explains; explicit rules decide; every state change is logged with an actor and a
rationale. See [CLAUDE.md](CLAUDE.md) — it is the working agreement, and it wins
over anything in `docs/`.

## Hiring Pipeline

```
Public apply link → Resume scoring → Voice screening (AI, live call) →
Screening scoring → AI interview invitation (on-demand) → AI interview →
Interview scoring → Manager review →
Final human interview (calendar-booked)
```

Two properties of that line are deliberate and worth knowing before reading the
code:

- **The AI interview is on-demand, not slot-booked.** The interviewer is
  available 24/7, so there is no calendar to coordinate against. Slot booking is
  reserved for the final *human* interview, where a real person's calendar is
  genuinely the constraint.
- **The interview is not recorded.** The durable record is the transcript, the
  score, and the proctoring report. The camera is live-only.

## What is built

- **Campaigns** — a five-step wizard for create and edit, clone, bulk status,
  deadlines, automation mode, SLA timers, and a public apply link per campaign.
- **Intake** — `/apply/<slug>`. Layout-aware text extraction, AI parsing and
  document classification, then scoring and a rule-driven advance. Duplicates are
  flagged for human review rather than auto-merged.
- **Evidence-based scoring** — for resumes and screening answers the model never
  returns a number. It reports an evidence level per criterion with verbatim
  quotes, the quotes are verified against the source document, and the score is
  derived deterministically. Resume must-haves are gates, not weights.
- **Voice screening** — a live LiveKit call with an OpenAI Realtime agent,
  scored against the campaign's screening rubric from a server-side transcript.
- **AI interview** — desktop-only, real-time, with per-dimension scores tied to
  verified transcript excerpts.
- **Proctoring** — browser signals plus server-side camera vision (a local
  detector; frames are scored in memory and discarded). Observational only: it
  never transitions an application and is never folded into a score.
- **Manager review** — advance, hire or reject, each with a written rationale
  recorded against the AI's recommendation.
- **Final interview scheduling** — availability rules, candidate slot booking,
  Google Calendar events with push-notification sync and reminders.
- **Talent pool** — an automatic directory plus a curated, opt-in pool with tags,
  notes and search.
- **Compliance** — every AI call persists its raw output, model, prompt version,
  rubric version and rationale; there is an audit log view. There is **no**
  bias auditor — PRD 3.14 was retired on 2026-08-30, and nothing in the
  product monitors adverse impact today.
- **Integrations** — Gmail (outbound candidate email only) and LinkedIn (social
  post publishing).

Deferred, tracked on the issue board rather than described here as though they
ship: live skill simulations, multi-language interviews and adaptive
difficulty. Reference checks, skill fingerprinting, candidate coaching mode,
predictive analytics, team-fit prediction and candidate-experience scoring
were **retired** on 2026-08-30 rather than deferred — see "3.13–3.19 —
Retired" in docs/prd.md.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4 |
| Server logic | Server Actions (route handlers only for agents, cron and OAuth) |
| Database / Auth / Storage | Supabase (PostgreSQL, Auth, Storage) |
| AI | OpenAI — generation, scoring, and the Realtime voice agents |
| Real-time | LiveKit rooms with standalone agent workers (`agents/`) |
| Resume extraction | Datalab Marker (PDF + DOCX) |
| Email | Gmail API, sent from the recruiter's own connected inbox |
| Calendar | Google Calendar API |
| Hosting | Vercel, including the cron schedules in `vercel.json` |
| Tests | Vitest, co-located, 128 files |

## Getting Started

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm typecheck && pnpm test
```

The voice screening and interview agents are separate packages under `agents/`
with their own `pnpm install`; without a worker running, candidates join a silent
room. Required environment variables are listed in
[CLAUDE.md](CLAUDE.md#environment-variables).

## Documentation

- [CLAUDE.md](CLAUDE.md) — the working agreement: state-machine rules,
  architecture boundaries, design system, testing policy, and every recorded
  decision. **Start here, and note that it wins over anything in `docs/`.**
- [docs/README.md](docs/README.md) — what is in `docs/` and which parts you can
  trust. Roughly half of that folder is dated planning material, and each stale
  file says so at the top.
- [Architecture](docs/architecture.md) — the layer map and reading order
- [Product Requirements (PRD)](docs/prd.md) — amended in place, with dated entries
- [Intern Onboarding Guide](docs/onboarding.md)

## License

Private — MatiousCorp internal use only.
