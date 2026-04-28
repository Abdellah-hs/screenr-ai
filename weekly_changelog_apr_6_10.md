Screenr AI | Weekly Changelog – April 6 – April 10, 2026

✨ Features

• **Screening Questions Generation**: Built `generateScreeningQuestions` server action that uses OpenAI `gpt-4o-mini` with structured JSON output to produce 4–6 role-specific questions per campaign, derived from the campaign's screening criteria and rubric. Questions are saved to the new `screening_questions` table and editable before sending.
• **Screening Question Delivery via Email**: Added `sendScreeningQuestionsToCandidate` action that emails a secure, single-use response link to candidates who passed the resume scoring tier (green/yellow). Reuses the Gmail service module to send via the campaign owner's authenticated Gmail account. Tracks send status (`pending`, `sent`, `delivered`, `responded`) per candidate.
• **Public Candidate Response Page**: New unauthenticated route `/respond/[token]` where candidates submit text/audio answers to screening questions. Token-authenticated via a signed, single-use URL parameter — no account or login required for the candidate. Submissions are persisted to `screening_question_responses`.
• **AI Answer Scoring**: `scoreScreeningAnswers` evaluates each candidate response against a per-question rubric using OpenAI structured output. Returns a 0–100 score and rationale per answer plus an aggregate tier, surfaced on the candidate detail page alongside the resume score.
• **Bulk Send to Green-Tier Candidates**: Added "Send Screening Questions" button on the campaign detail page that batches all eligible (green-tier, not yet contacted) candidates in a single action with progress feedback.
• **Screening Questions Database Schema**: Added migration (`20260406000000_screening_questions_schema.sql`) defining `screening_questions`, `screening_question_responses`, response status enum, and RLS policies scoping access to campaign owners (recruiters) and signed-token holders (candidates).

🛠️ Improvements

• **Pipeline View Shows Screening Status**: Candidate table on the campaign detail page now shows per-candidate screening question status (`not sent`, `sent`, `responded`, `scored`) as a colored badge, alongside the existing resume tier.
• **Edit/Regenerate Questions Before Sending**: Added a question editor modal that lets recruiters tweak AI-generated questions, mark a question as required vs optional, or regenerate the entire set with one click before any candidate is contacted.
• **Candidate Detail Page Shows Q&A Thread**: Candidate detail page now renders the full screening question thread — each question, the candidate's answer, the AI score, and a per-answer rationale tooltip — beneath the existing resume scoring section.
• **Screening Questions Service Module**: Extracted screening-question prompt construction and OpenAI calls into `src/lib/services/screening-questions.ts` to keep `ai-generate.ts` focused on resume scoring and rubric generation.
• **Screening Questions Data Layer**: Added `src/lib/data/screening-questions.ts` with `insertScreeningQuestions`, `fetchScreeningQuestionsByCampaignId`, `upsertScreeningResponse`, and `saveAnswerScores` to keep all DB operations behind the data-layer boundary.
• **Email Template for Screening Questions**: Plain-HTML template (`src/lib/services/email-templates/screening-questions.ts`) with the campaign name, role description, response deadline, and signed link. No templating engine — just typed string interpolation.
• **Zod Schemas for Screening Flow**: Added `screeningQuestionSchema`, `screeningResponseSchema`, and `answerSubmissionSchema` to `src/lib/validations.ts`, used by both the recruiter actions and the public candidate submission endpoint.

🔒 Security

• **Signed Single-Use Tokens for Candidate Access**: Candidate response links use HMAC-signed tokens with a 7-day expiry and a `consumed_at` timestamp on first submission to prevent replay. Token secret read from a new `SCREENING_TOKEN_SECRET` env var.
• **Public Submission Rate Limiting**: Added a separate IP-keyed rate limiter for `/respond/[token]` (10 submissions / 10 min per IP) on top of the existing per-user limiter. Reuses `src/lib/rate-limit.ts` with a new `name: "screening-submission"` bucket.
• **Question Generation Rate Limit**: `generateScreeningQuestions` and the bulk send action are gated by the existing AI-generation limiter (10 req / 5 min per user).
• **RLS for Screening Tables**: Migration adds row-level security policies that allow recruiters to read/write only their own campaigns' questions, and allow anonymous candidate writes only when the request carries a valid signed token (verified in the Server Action layer, not in Postgres — Postgres policy is owner-only).
• **Token Verification Helper**: New `src/lib/auth/screening-token.ts` exports `signResponseToken` / `verifyResponseToken` with constant-time comparison to avoid timing attacks.

🐛 Bug Fixes

• **GmailSyncButton Showed "Synced 0" on Success**: The button counted `result.imported` instead of `result.imported.length`, always rendering 0 even when candidates were imported. One-line fix in `src/components/candidates/gmail-sync-button.tsx`.
• **Candidate Detail Page Crash on Missing Phone**: Clickable phone link assumed `candidate.phone` was always present after the recent contact-info redesign; added a null check and "—" fallback.
• **Stage Changer Lost Selection on Network Retry**: `StageChanger` reset its local state on every render of the parent during the `useTransition` retry path. Pulled the optimistic state into a `useState` initialized from the prop, restored only on real prop changes via `useEffect`.
• **Rate Limiter Stale-Entry Pruning Skipped Empty Buckets**: The pruning logic from last week deleted entries inside a bucket but never removed empty buckets, so the outer `Map` grew unbounded with empty `Map`s. Added a second pass to delete buckets whose inner map is empty.
