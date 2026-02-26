# Screenr AI — Intern Onboarding Guide

Welcome to the Screenr AI team! This document will get you up to speed on the project, our tech stack, development workflow, and everything you need to start contributing. Take your time going through it — there's no rush, and asking questions is always encouraged.

---

## 1. What is Screenr AI?

Screenr AI is an internal **Applicant Tracking System (ATS) & AI-Powered Interview Platform**. It automates the full hiring pipeline — from resume collection through AI-conducted interviews to final interview scheduling.

### The Hiring Pipeline

```
Resume Collection → AI Screening → Filtering → Screening Questions →
Answer Scoring → AI Interview Scheduling → AI Interview →
Interview Scoring → AI Reference Check (optional) → Manager Review →
Final Interview Scheduling
```

### Core Capabilities

| Capability | What It Does |
|---|---|
| **Campaign Management** | Hiring managers create campaigns (one per open role) with custom screening criteria and evaluation rubrics |
| **Resume Parsing & Screening** | AI extracts structured data from resumes (PDF/DOCX) and scores them against campaign criteria |
| **Screening Questions** | AI-generated questions delivered via email link; candidates respond with video/audio recordings |
| **AI Technical Interview** | Real-time conversational AI interview (video call) with adaptive difficulty, proctoring, and multi-language support |
| **Scoring & Transparency** | Every AI score includes factor-level breakdowns and transcript-to-score linkage |
| **Manager Dashboard** | Ranked candidate lists, side-by-side comparisons, interview replay with AI commentary |
| **Bias Auditing** | Continuous bias monitoring, adverse impact calculations, and criteria sensitivity analysis |
| **Talent Pool** | Silver-medalist candidates are retained for future campaigns |

Read the full PRD at `docs/prd.md` — it is the source of truth for what we are building.

---

## 2. Tech Stack

| Layer | Technology | You Should Know |
|---|---|---|
| **Frontend** | Next.js (React) | App Router, Server Components, Server Actions |
| **Backend / API** | Next.js API Routes + Supabase | Route Handlers, Edge Functions |
| **Database** | Supabase (PostgreSQL) | SQL, Row-Level Security, Realtime subscriptions |
| **Authentication** | Supabase Auth | OAuth, token-based access for candidates |
| **AI Engine** | Claude Opus 4.5 (Anthropic) | Prompt engineering, structured outputs, tool use |
| **File Storage** | Supabase Storage | Resume uploads, video recordings |
| **Hosting** | Hetzner Cloud | VPS deployment, Docker |
| **Calendar** | Google Calendar API | OAuth, event creation |
| **Email** | TBD (Resend / Postmark / SendGrid) | Transactional email, templates |
| **Real-Time Comms** | TBD (LiveKit / Daily.co / Twilio) | WebRTC, real-time audio/video |
| **Speech-to-Text** | TBD (Deepgram / Whisper) | Audio transcription |
| **Text-to-Speech** | TBD (ElevenLabs / Google TTS) | Voice synthesis for AI interviewer |

---

## 3. Learning Resources

Work through these resources in your first 2–3 weeks. You don't need to master everything before writing code — learn as you build.

### 3.1 Next.js (Frontend + Backend)

- **Start here:** [Next.js Learn Course](https://nextjs.org/learn) — official interactive tutorial, covers the App Router
- **Docs:** [Next.js Documentation](https://nextjs.org/docs) — bookmark this, you'll reference it constantly
- **Key topics to focus on:**
  - [App Router](https://nextjs.org/docs/app) — file-based routing, layouts, loading/error states
  - [Server Components vs Client Components](https://nextjs.org/docs/app/building-your-application/rendering/server-components) — understand when to use each
  - [Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations) — how we handle form submissions and mutations
  - [Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers) — API endpoints in the App Router
  - [Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware) — auth checks, redirects
- **Video:** [Next.js App Router by Lee Robinson](https://www.youtube.com/watch?v=DrxiNfbr63s) — great overview from Vercel's VP of Product

### 3.2 React (If You Need a Refresher)

- [React Docs — Learn](https://react.dev/learn) — the new official React docs are excellent
- Focus on: hooks (`useState`, `useEffect`, `useRef`, `useCallback`), component patterns, context API

### 3.3 TypeScript

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) — the official guide
- [Total TypeScript — Beginner's Tutorial](https://www.totaltypescript.com/tutorials/beginners-typescript) — free, practical exercises
- We use strict TypeScript everywhere. Get comfortable with interfaces, generics, union types, and utility types.

### 3.4 Supabase (Database, Auth, Storage)

- **Start here:** [Supabase Docs](https://supabase.com/docs) — overview of all services
- [Supabase + Next.js Quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs) — how they work together
- [Row-Level Security (RLS)](https://supabase.com/docs/guides/database/postgres/row-level-security) — critical for our security model
- [Supabase Auth with Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs) — SSR auth patterns
- [Supabase Storage](https://supabase.com/docs/guides/storage) — file uploads (resumes, recordings)
- [Database Functions & Triggers](https://supabase.com/docs/guides/database/functions) — server-side logic in PostgreSQL
- **Video:** [Supabase Full Course by Traversy Media](https://www.youtube.com/watch?v=dU7GwCOgvNY)

### 3.5 PostgreSQL

- [PostgreSQL Tutorial](https://www.postgresqltutorial.com/) — SQL fundamentals if you need them
- Focus on: JOINs, indexes, JSON/JSONB columns, CTEs, and migrations

### 3.6 Claude API (Anthropic AI)

- **Docs:** [Anthropic API Documentation](https://docs.anthropic.com/) — the primary reference
- [Claude Prompt Engineering Guide](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview) — how to write effective prompts
- [Tool Use (Function Calling)](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview) — how Claude calls functions, critical for our AI interviewer
- [Structured Outputs](https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs) — getting JSON responses from Claude
- [Anthropic Cookbook](https://github.com/anthropics/anthropic-cookbook) — practical examples and patterns
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) — the SDK we use in code

### 3.7 Real-Time Communication (WebRTC)

These are relevant when you work on the AI interview feature:

- [WebRTC Basics — MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API) — understand the fundamentals
- [LiveKit Docs](https://docs.livekit.io/) — one of our candidate real-time platforms
- [Daily.co Docs](https://docs.daily.co/) — alternative option

### 3.8 Tailwind CSS

- [Tailwind CSS Docs](https://tailwindcss.com/docs) — utility-first CSS framework
- [Tailwind CSS Tutorial — Fireship](https://www.youtube.com/watch?v=pfaSUYaSgRo) — quick video introduction

### 3.9 Git & GitHub

- [Git Handbook — GitHub](https://docs.github.com/en/get-started/using-git/about-git)
- [Conventional Commits](https://www.conventionalcommits.org/) — commit message format we follow
- [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) — branch-based workflow

---

## 4. Development Environment Setup

### 4.1 Prerequisites

Install the following on your machine:

| Tool | Install |
|---|---|
| **Node.js** (v20+) | [nodejs.org](https://nodejs.org/) or use `nvm` |
| **pnpm** | `npm install -g pnpm` — our package manager |
| **Git** | [git-scm.com](https://git-scm.com/) |
| **VS Code** | [code.visualstudio.com](https://code.visualstudio.com/) |
| **Claude Code** | [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — see section 4.3 |
| **Docker** (optional) | [docker.com](https://www.docker.com/) — for local Supabase |
| **Supabase CLI** | `pnpm install -g supabase` — [Supabase CLI Docs](https://supabase.com/docs/guides/local-development/cli/getting-started) |

### 4.2 Clone & Run

```bash
# Clone the repo
git clone https://github.com/MatiousCorp/screenr-ai.git
cd screenr-ai

# Install dependencies
pnpm install

# Copy environment variables (you'll receive the actual values separately)
cp .env.example .env.local

# Run the development server
pnpm dev
```

### 4.3 Claude Code — Your AI Coding Assistant

You will be provided a **Claude account** for coding with **Claude Code**, Anthropic's CLI tool for AI-assisted development. This will be your primary coding companion throughout the internship.

**What is Claude Code?**
Claude Code is a terminal-based AI coding assistant that can read your codebase, write and edit files, run commands, and help you build features end-to-end. It understands the full context of the project.

**Setup:**

```bash
# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Launch in the project directory
cd screenr-ai
claude
```

**How to use it effectively:**

- Ask it to explain parts of the codebase you don't understand
- Use it to scaffold new features, write tests, debug issues
- Have it review your code before opening a PR
- Use `/help` inside Claude Code for available commands
- Reference: [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)

**Tips:**
- Be specific in your prompts — "Add a new API route at `/api/campaigns/[id]/candidates` that returns paginated candidates with their latest screening score" works better than "add candidates endpoint"
- Let it read the relevant files first before asking it to make changes
- Use it to explore unfamiliar parts of the codebase — ask "how does X work?" and point it at the right files

### 4.4 Recommended VS Code Extensions

- **ESLint** — linting
- **Prettier** — code formatting
- **Tailwind CSS IntelliSense** — autocomplete for Tailwind classes
- **Prisma** / **Supabase** — database tooling
- **GitLens** — git blame and history
- **Error Lens** — inline error highlighting

---

## 5. Access & Accounts

You will be granted access to the following on your first day. If anything is missing, reach out immediately.

| Service | What You Get | URL |
|---|---|---|
| **GitHub** | Collaborator access to `MatiousCorp/screenr-ai` | [github.com/MatiousCorp/screenr-ai](https://github.com/MatiousCorp/screenr-ai) |
| **Supabase** | Project member access (database, auth, storage, logs) | Invite link provided separately |
| **Hetzner Cloud** | Server access for deployments | Credentials provided separately |
| **Claude Account** | For coding with Claude Code | Credentials provided separately |

---

## 6. Project Architecture Overview

```
screenr-ai/
├── apps/
│   └── web/                    # Next.js application
│       ├── src/
│       │   ├── app/            # App Router — pages and API routes
│       │   │   ├── admin/      # Admin dashboard (hiring managers)
│       │   │   ├── auth/       # Authentication flows
│       │   │   ├── api/        # API route handlers
│       │   │   └── ...         # Candidate-facing pages
│       │   ├── components/     # React components
│       │   ├── lib/            # Shared utilities, actions, API clients
│       │   │   ├── actions/    # Server Actions (AI analyzer, Gmail, etc.)
│       │   │   └── ...
│       │   └── types/          # TypeScript type definitions
│       └── ...
├── supabase/
│   └── migrations/             # Database migration files
├── docs/
│   ├── prd.md                  # Product Requirements Document
│   └── onboarding.md           # This document
└── ...
```

### Key Architectural Decisions

- **Next.js App Router** — we use the App Router exclusively (no Pages Router)
- **Server Components by default** — client components only when we need interactivity (`"use client"`)
- **Server Actions** for mutations — form submissions and data writes go through Server Actions
- **Supabase as the backend** — database, auth, file storage, and real-time all through Supabase
- **Claude API for all AI features** — resume screening, question generation, interview scoring, bias analysis

---

## 7. Development Workflow

### 7.1 Branching Strategy

```
main (production)
  └── feature/your-feature-name
  └── fix/bug-description
  └── chore/task-description
```

1. Always branch off `main`
2. Use descriptive branch names: `feature/campaign-creation`, `fix/screening-score-display`, `chore/update-deps`
3. Keep branches small and focused — one feature or fix per branch
4. Open a Pull Request when ready for review

### 7.2 Pull Requests

- Write a clear PR description: what changed, why, and how to test
- Link to the relevant issue or task
- Request a review before merging
- All PRs merge into `main`

### 7.3 Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add campaign creation form
fix: resolve screening score calculation for edge case
docs: update API documentation for interview endpoints
chore: upgrade supabase-js to v2.x
refactor: extract scoring logic into shared utility
```

### 7.4 Code Quality

- TypeScript strict mode — no `any` types unless absolutely unavoidable
- Use ESLint and Prettier (configured in the repo)
- Write meaningful variable and function names
- Add comments only when the "why" isn't obvious from the code

---

## 8. Ramp-Up Plan (First 4 Weeks)

This is a suggested plan. Your manager will adjust based on priorities.

### Week 1 — Learn & Explore

- [ ] Read this onboarding document fully
- [ ] Read the PRD (`docs/prd.md`) end to end
- [ ] Set up your development environment (Section 4)
- [ ] Get the app running locally
- [ ] Explore the codebase — use Claude Code to ask questions about how things work
- [ ] Go through the Next.js Learn Course
- [ ] Review the Supabase + Next.js quickstart
- [ ] Understand the database schema (check `supabase/migrations/`)

### Week 2 — Small Contributions

- [ ] Pick up a small issue (bug fix or minor UI improvement)
- [ ] Open your first PR and get it reviewed
- [ ] Study how Server Actions are used in the codebase (`src/lib/actions/`)
- [ ] Study how the admin dashboard pages work (`src/app/admin/`)
- [ ] Read through the Claude API docs and Prompt Engineering guide
- [ ] Explore the Supabase dashboard — tables, RLS policies, storage buckets

### Week 3 — Feature Work Begins

- [ ] Take on a small feature (your manager will assign)
- [ ] Learn the AI integration patterns — how we call Claude, structure prompts, parse responses
- [ ] Study the scoring and evaluation logic in the codebase
- [ ] Write your first database migration if your feature needs schema changes

### Week 4 — Full Speed

- [ ] You should be comfortable with the codebase, workflow, and tools
- [ ] Take on larger features independently
- [ ] Start thinking about system design for upcoming features (refer to PRD sections)
- [ ] Pair with your manager on complex architectural decisions

---

## 9. Key Concepts to Understand

These concepts come up constantly in the project. Make sure you're comfortable with them.

### 9.1 AI/LLM Concepts

| Concept | Why It Matters | Resource |
|---|---|---|
| **Prompt engineering** | Every AI feature depends on well-crafted prompts | [Anthropic Prompt Engineering Guide](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview) |
| **Tool use / Function calling** | The AI interviewer uses tools to display content, manage interview flow | [Claude Tool Use Docs](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview) |
| **Structured outputs** | We need JSON responses for scoring, evaluations, parsed data | [Claude Structured Outputs](https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs) |
| **Streaming** | Real-time interview requires streaming responses | [Claude Streaming](https://docs.anthropic.com/en/docs/build-with-claude/streaming) |
| **Context windows** | Managing long interview transcripts within token limits | [Claude Models Overview](https://docs.anthropic.com/en/docs/about-claude/models) |

### 9.2 Web Development Concepts

| Concept | Why It Matters | Resource |
|---|---|---|
| **WebRTC** | Real-time video/audio for AI interviews | [MDN WebRTC Guide](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API) |
| **Token-based access** | Candidates access forms via unique links, no accounts | [JWT Introduction](https://jwt.io/introduction) |
| **Row-Level Security** | Database-level access control in Supabase | [Supabase RLS Guide](https://supabase.com/docs/guides/database/postgres/row-level-security) |
| **OAuth 2.0** | Google Calendar integration, Supabase Auth | [OAuth 2.0 Simplified](https://aaronparecki.com/oauth-2-simplified/) |
| **Transactional email** | Automated emails at each pipeline stage | Depends on chosen provider |
| **Media handling** | Video recording, storage, transcription | Browser MediaRecorder API |

### 9.3 Domain Concepts

Read the PRD for full context, but these are the big ideas:

- **Campaign** — a hiring initiative for a specific role. Everything flows from campaigns.
- **Pipeline stages** — candidates move through sequential stages, each producing an independent score.
- **Scoring transparency** — every AI score must be explainable with factor-level breakdowns.
- **Audit trail** — every AI decision is logged immutably (input, model, prompt, output, action).
- **Bias auditing** — the system monitors for scoring bias across demographic proxies.

---

## 10. Useful Commands

```bash
# Development
pnpm dev                  # Start Next.js dev server
pnpm build                # Production build
pnpm lint                 # Run ESLint
pnpm type-check           # Run TypeScript compiler check

# Supabase
supabase start            # Start local Supabase (requires Docker)
supabase db reset          # Reset local database and run all migrations
supabase migration new <name>  # Create a new migration file
supabase gen types typescript  # Generate TypeScript types from database schema

# Claude Code
claude                    # Launch Claude Code in the current directory
```

---

## 11. Communication & Expectations

- **Ask questions early and often.** No question is too basic. It's far better to ask than to spend hours stuck.
- **Use Claude Code as your first line of help.** It can explain code, suggest approaches, and debug issues. Escalate to your manager when you need human judgment.
- **Share progress regularly.** Even if something is half-done, communicating where you are helps the team.
- **Don't be afraid to break things locally.** That's what `git stash` and branches are for.
- **Code reviews are learning opportunities.** Read feedback carefully and ask if something isn't clear.

---

## 12. Quick Reference Links

### Project

- **Repository:** [github.com/MatiousCorp/screenr-ai](https://github.com/MatiousCorp/screenr-ai)
- **PRD:** `docs/prd.md` in the repo

### Core Documentation

- [Next.js Docs](https://nextjs.org/docs)
- [React Docs](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Supabase Docs](https://supabase.com/docs)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)

### Learning

- [Next.js Learn Course](https://nextjs.org/learn)
- [Supabase + Next.js Quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
- [Anthropic Prompt Engineering Guide](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)
- [Anthropic Cookbook (Examples)](https://github.com/anthropics/anthropic-cookbook)
- [Total TypeScript (Free Tutorials)](https://www.totaltypescript.com/tutorials)
- [PostgreSQL Tutorial](https://www.postgresqltutorial.com/)
- [Conventional Commits](https://www.conventionalcommits.org/)

### Tools

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [pnpm](https://pnpm.io/)

---

*Welcome aboard. Let's build something great.*
