Screenr AI | Weekly Changelog – March 20–27, 2026

✨ Features

• **SLA Timers Editor**: Built UI for configuring pipeline stage time limits with alert and escalation thresholds per campaign.
• **Team Reviewers Editor**: Added reviewer assignment UI with role selection (lead/reviewer/observer) per campaign.
• **Campaign Database Migration**: Moved campaign management from mock data to real Supabase queries. All CRUD operations (create, read, update, clone) now persist to PostgreSQL.
• **Consolidated Database Schema**: Created single comprehensive migration covering 7 tables: campaigns, screening_criteria, evaluation_rubrics, rubric_dimensions, campaign_reviewers, sla_timers, campaign_audit_log.
• **Real AI Generation**: Replaced mock AI functions with live OpenAI API calls (gpt-4o-mini) for auto-generating screening criteria and evaluation rubric dimensions from job descriptions.
• **Auth Middleware Enabled**: Activated route protection — unauthenticated users are now redirected to /login when accessing /campaigns routes.

🛠️ Improvements

• **Server Actions Auth Guards**: All campaign server actions (create, update, clone) verify authenticated user via getUser() before executing.
• **RLS Policies**: Full Row Level Security on all 7 tables scoped to campaign owner via auth.uid(). Related tables use subquery policies checking campaign ownership.
• **Batch Data Fetching**: Campaign list page fetches all related data (criteria, rubrics, dimensions, reviewers, SLA timers) in parallel using Promise.all instead of N+1 queries.
• **Audit Logging**: Campaign create, update, and clone operations write to campaign_audit_log with old/new data snapshots.
• **Database Types**: Regenerated src/types/database.types.ts to match the consolidated schema with all 5 enums and 7 tables.
• **Installed openai SDK**: Replaced @anthropic-ai/sdk dependency with openai for AI generation.

🐛 Bug Fixes

• **Signup redirect race condition**: Signup page called router.push("/campaigns") immediately after signUp(), even when email confirmation was enabled. The user wasn't authenticated yet, so middleware bounced them to /login — conflicting with the "check your email" success screen. Fixed by checking data.session: if null (confirmation pending), show the message and stop; if present (confirmation disabled), redirect.
• **Auth middleware was fully commented out**: All /campaigns routes were accessible without authentication. Unauthenticated users could view, create, and edit campaigns. Re-enabled middleware protection with proper route checks for /campaigns, /login, and /signup.
• **AI generation failed silently with fake data**: When the OpenAI API key was missing or the API returned errors, the generate functions silently returned hardcoded mock criteria/rubrics. Users had no way to know the AI wasn't actually running. Removed all fallbacks — errors now throw and surface as inline error banners in the UI.
• **AI editor errors swallowed by useTransition**: Both screening-criteria-editor and rubric-editor called server actions inside startTransition() with no try/catch. If the server action threw, the error was silently swallowed and the UI just stopped spinning with no feedback. Added try/catch with error state that renders a red error banner.
• **Campaign actions had no auth check on read**: getCampaignById() didn't verify the user was authenticated before querying. With RLS this wouldn't leak data, but it could return confusing empty results instead of a clear auth error. Added getUser() guard to write operations; reads are protected by RLS at the database level.
• **Mock data imports left in campaign actions**: campaigns.ts still imported from mock-campaigns.ts even after the Supabase migration was ready. Replaced all mock imports with real Supabase queries using createClient().
