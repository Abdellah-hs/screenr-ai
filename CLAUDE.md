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
```

Package manager is **pnpm**. No test framework is configured yet.

## Tech Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5**
- **Supabase** for database (PostgreSQL), auth, and file storage
- **Tailwind CSS 4** with `@tailwindcss/postcss`
- **React Compiler** enabled via `babel-plugin-react-compiler`
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

### Data Layer

The application exclusively uses live **Supabase queries** for all data access.

- **Server Actions** (`src/lib/actions/`) are the primary mutation pattern — they accept `FormData`, call data layer services (`src/lib/data/`), mutate state, and `redirect()`.
- **No API routes** are implemented yet (directory exists at `src/app/api/`).
- Auto-generated Supabase types live in `src/types/database.types.ts`.

### Supabase Clients

- Server: `src/lib/supabase/server.ts` — uses `cookies()` from `next/headers`
- Browser: `src/lib/supabase/client.ts` — for client components

### Auth

Supabase Auth via middleware (`src/middleware.ts`). Route protection is **currently commented out** for local preview. When re-enabled, `/campaigns` routes require authentication and authenticated users are redirected away from `/login` and `/signup`.

### Domain Types & Constants

All domain types (Campaign, Candidate, etc.), enums, status configs, and pipeline definitions are in `src/lib/constants.ts`. This is the single source of truth for:

- `CampaignStatus`, `AutomationMode`, `InterviewPersona`, `ReviewerRole`
- `CandidateStage`, `ScreeningTier`
- Status transition rules (`STATUS_TRANSITIONS`)
- Pipeline stage definitions

### Components

- `src/components/ui/` — reusable primitives (Button, Card, Input, Modal, Select, Textarea, Badge) exported via `index.ts`
- `src/components/campaigns/` — campaign-specific components (rubric editor, screening criteria editor, SLA timers, team reviewers, candidate table)
- `src/components/Navbar.tsx`, `src/components/Sidebar.tsx` — layout chrome

### Styling

- Tailwind CSS 4 utilities with custom CSS variables in `src/app/globals.css`
- `cn()` helper in `src/lib/utils.ts` (clsx + tailwind-merge) for conditional classes
- Custom component classes (`.btn-primary`, `.card`, `.input`, `.modal-overlay`) defined in globals.css

### Path Alias

`@/*` maps to `./src/*` (configured in tsconfig.json).

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

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL      # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Supabase anonymous key
OPENAI_API_KEY                # OpenAI API key for AI generation (screening criteria, rubrics)
```

## Documentation

- [Product Requirements (PRD)](docs/prd.md)
- [Intern Onboarding Guide](docs/onboarding.md)
- [Design System Master](design-system/screenr-ai/MASTER.md)
