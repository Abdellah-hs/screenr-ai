Screenr AI | Weekly Changelog – March 30 – April 3, 2026

✨ Features

• **Gmail-to-ATS Candidate Pipeline**: Implemented end-to-end Gmail sync that pulls applicant emails, parses resumes with OpenAI, and creates candidate records in Supabase automatically. Added `GmailSyncButton` component to campaign detail page.
• **AI Resume Scoring Pipeline**: Built `scoreResumeAgainstCriteria` using OpenAI to automatically score candidate resumes against campaign screening criteria. Returns tier classification (green/yellow/red) with per-factor breakdown and rationale. Added `ScoreResumeButton` client component.
• **Candidate Stage Changer**: Added `StageChanger` client component allowing recruiters to move candidates through pipeline stages directly from the candidate detail page.
• **Enhanced Candidate Detail Page**: Redesigned candidate detail page with clickable email/phone contacts, LinkedIn and portfolio links, resume scoring results display, and stage management controls.
• **Candidate Pipeline Database Schema**: Added migration (`20260330174903_candidate_pipeline_schema.sql`) defining the candidate pipeline tables and relationships.
• **Resume Scoring Database Columns**: Added migration (`20260331010000_resume_scoring_columns.sql`) for `screening_tier`, `score_rationale`, `score_factors`, and `scored_at` columns on candidates.

🛠️ Improvements

• **Campaigns Refactored to Data Layer**: Extracted all campaign DB operations into `src/lib/data/campaigns.ts` (`insertCampaignTx`, `updateCampaignTx`, `cloneCampaignTx`). Server actions now delegate to the data layer instead of calling Supabase directly.
• **Candidates Data Layer**: Created `src/lib/data/candidates.ts` to centralize all candidate database queries and mutations.
• **Service Extraction**: Extracted Gmail, OpenAI, and PDF parsing logic into dedicated service modules under `src/lib/services/` (`gmail.ts`, `openai.ts`, `pdf.ts`).
• **Mock Data Fully Removed**: Deleted `mock-campaigns.ts` and `mock-candidates.ts` — all data is now served exclusively from live Supabase. Removed mock re-exports from `constants.ts`.
• **AI Generation Replaced with Real OpenAI Calls**: Rewrote `ai-generate.ts` from scratch — removed all mock/simulated AI functions (`simulateLatency`, keyword-matching heuristics) and replaced with live OpenAI `gpt-4o-mini` API calls with structured JSON responses for screening criteria, rubric dimensions, and resume scoring.
• **Zod Input Validation**: Added `src/lib/validations.ts` with Zod schemas for all Server Action inputs (campaigns, candidates, AI generation).
• **New Dependencies**: Added `googleapis` (Gmail API), `openai` (AI generation), `pdf-parse` (resume extraction), and `zod` (input validation) to the project.
• **Rubric Editor UX Overhaul**: Replaced dual min/max score number inputs with a single "Pass ≥" range slider (0–100) for cleaner dimension threshold editing.
• **Signed URLs for Resumes**: Switched resume storage from public URLs to time-limited signed URLs for better security.
• **Storage RLS Policies Fixed**: Added migration (`20260331000000_fix_storage_rls_policies.sql`) to scope `storage.objects` policies to campaign-owner paths, replacing overly-permissive defaults.
• **GmailSyncButton on Campaign Detail Page**: Added the Gmail sync button directly into the Pipeline section header on the campaign detail page for quick candidate imports.

🔒 Security

• **Auth Guards on All Actions**: Added `getUser()` authentication checks to `getCampaignById`, all candidate functions, and AI generation server actions.
• **Ownership Verification**: Campaign update and clone mutations now verify `user_id` matches the authenticated user before executing.
• **Rate Limiting**: Added in-memory rate limiting to AI generation (10 requests/5 min) and Gmail sync (5 requests/10 min) via `src/lib/rate-limit.ts`.
• **Rate Limiter Memory Leak Fix**: Added stale entry pruning to the in-memory rate limiter to prevent unbounded map growth.
• **Auth Middleware Re-enabled**: Uncommented and restored route protection in `middleware.ts` — unauthenticated users are redirected to `/login` when accessing `/campaigns` routes, and authenticated users are redirected away from `/login` and `/signup`.

🐛 Bug Fixes

• **Signup redirect race condition**: Fixed signup page calling `router.push("/campaigns")` immediately after `signUp()` even when email confirmation was enabled. Now checks `data.session` — if null (confirmation pending), shows the "check your email" message; if present, redirects.
• **AI editor errors swallowed by `useTransition`**: Both `screening-criteria-editor` and `rubric-editor` called server actions inside `startTransition()` with no try/catch. Errors were silently swallowed. Added try/catch with error state that renders a red error banner in both editors.
• **Merge conflict resolution**: Resolved conflicts from origin/main, keeping feature branch improvements including data layer delegation, typed `updateCampaignTx` params, resume scoring pipeline, object-style `logAiAudit`, and rate-limit memory leak fix.
