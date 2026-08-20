# PRD Notes — Screenr AI

> **HISTORICAL — not current status.**
> Written 2026-05-16 and kept as a record of the thinking at the time.
> A reading of the PRD as it stood then. Several details have since changed — the interview runs on OpenAI Realtime rather than Claude with TTS/STT, and interview recording was retired on 2026-08-04.
> For what is actually built today, read [CLAUDE.md](../CLAUDE.md) and [docs/README.md](README.md).

A reading of [docs/prd.md](prd.md) and [docs/onboarding.md](onboarding.md): what the product is, how it's intended to be built, the pipeline, and every place the spec still defers a decision.

## Product summary

Screenr AI is an internal ATS + AI-driven interview platform for MatiousCorp. It owns the full hiring funnel — resume intake → AI screening → screening questions → AI technical interview → optional reference check → manager review → final human interview — for any role type and at thousands-of-candidates-per-campaign scale. Greenfield (no legacy migration). Hiring managers and HR are first-class users; candidates only interact via tokenized email links and a desktop interview portal — no candidate accounts.

The product's defining bet is the **real-time AI interview**: a video session driven by Claude Opus 4.5 with TTS/STT, proctoring, dynamic difficulty, multi-language, and live "skill simulation" environments (incident response, PR review, whiteboard, etc.). Around it are scoring transparency (factor-level attribution, transcript-to-score linkage), an immutable AI audit trail, a bias auditor (EU AI Act, 4/5ths rule), a silver-medalist talent pool, candidate-experience surveys, predictive pipeline analytics, and a public "coaching mode" funnel.

## Intended architecture (per docs)

- **Frontend/Backend:** Next.js (App Router), React Server Components by default, Server Actions for mutations, Route Handlers for API endpoints. *(Note: [CLAUDE.md](../CLAUDE.md) says `src/app/api/` is empty and there are currently no API routes — onboarding text contradicts code reality.)*
- **DB / Auth / Storage:** Supabase (Postgres + RLS, Supabase Auth, Supabase Storage for resumes and recordings).
- **AI:** Claude Opus 4.5 via the Anthropic SDK; structured outputs, tool use, streaming.
- **Calendar:** Google Calendar API.
- **Hosting:** Hetzner Cloud.
- **Repo layout in onboarding:** `apps/web/...` monorepo-style. The actual repo is flat (`src/...`) — [onboarding.md:218-240](onboarding.md#L218-L240) is stale.
- **Strict layering** (per CLAUDE.md, not the PRD/onboarding): Server Actions → Rules (pure decisions) → Data (Supabase) → Services (OpenAI, Gmail, PDF, email). All `applications.status` writes funnel through `transition()`. AI is evidence-only.

## Core pipeline stages

Sequential, each producing an **independent** score (no composite):

1. **Resume Collection** — Email inbox monitor, LinkedIn DMs, LinkedIn campaign imports. PDF/DOCX parsed into structured profile + retained original. Duplicates flagged for HR (not auto-merged).
2. **AI Resume Screening** — 0–100 score with factor breakdown + tier (Strong / Potential / Weak / No Match), written rationale.
3. **Filtering** — threshold-based auto-advance or auto-reject (with personalized rejection email); optional human-in-the-loop toggle.
4. **Screening Questions** — AI-generated, manager-editable; delivered via tokenized link; **video/audio recordings** (with practice question and re-record); per-question + overall score; transcript excerpts justify scores.
5. **AI Interview Scheduling** — self-serve slot picker against system availability; confirmation + 24h/1h reminders include a web-based prep guide.
6. **AI Technical Interview** — real-time conversational video session (30–45 min). Configurable formats (system design, technical Q&A, behavioral, code reading), persona modes (pressure / collaborative / socratic / neutral), dynamic difficulty, multi-language, optional skill simulations. Proctoring (presence, multi-face, gaze, tab focus) flags incidents. Full recording + transcript.
7. **Interview Scoring** — per-section + overall, written eval, strengths/concerns, proctoring report, transcript-to-score links.
8. **AI Reference Check (optional)** — 2–3 references contacted; AI conducts via chat or voice; report covers consistency, sentiment, discrepancies.
9. **Manager Review** — ranked list, side-by-side compare, AI-annotated replay with highlight reel, notes, advance/reject/talent-pool/flag, bulk actions.
10. **Final Interview Scheduling** — Google Calendar integration; candidate self-picks from manager availability; event includes profile + interview highlights.

Cross-cutting: AI Audit Trail, Scoring Transparency (3.10), Bias Auditor (3.14), Talent Pool (3.11), Skill Fingerprint (3.13), Candidate Experience (3.15), Team Fit (3.16), Coaching Mode (3.17), Predictive Analytics (3.18). Operational: bulk actions, SLA timers, auto-archive, no-show handling, cloning, template library.

## Unresolved implementation choices

### Explicit TBDs in [prd.md:898-914](prd.md#L898-L914)
- **Speech-to-Text** vendor (Deepgram / Whisper / Google STT)
- **Text-to-Speech** vendor (ElevenLabs / Google TTS)
- **Real-time comms** stack (LiveKit / Daily.co / Twilio) — gates the entire AI interview implementation
- **Email provider** (Resend / Postmark / SendGrid)
- **CI/CD** pipeline

### Internal contradictions between docs and current code
- **AI engine identity.** PRD/onboarding still say Claude Opus 4.5 ([prd.md:180](prd.md#L180), [prd.md:906](prd.md#L906)), but the engine has been changed to **OpenAI** — that's what `src/lib/services/openai.ts` and `OPENAI_API_KEY` reflect. PRD and onboarding need to be updated to match; references to Claude Opus 4.5 throughout §3.5 and §8 are stale.
- **API routes vs Server Actions.** Onboarding tells interns to use Route Handlers; CLAUDE.md says everything is Server Actions and `src/app/api/` is empty. Pick one and update onboarding.
- **Stage naming.** PRD's prose stages don't line up with the canonical `candidate_stage_enum`. Several legacy values (`screening`, `screening_q`, `interview`) still exist; failure states (`screening_expired`, `interview_no_show`, `processing_failed`) and stages (`reference_check`, `final_interview_scheduling`) are listed in CLAUDE.md as unbuilt.
- **Repo layout.** Onboarding's `apps/web/...` tree is wrong for the current flat layout.

### Configurable values with no specified default
- Per-question time limit (3.4.3), per-stage SLA limits (3.12.2), auto-archive window for non-response (3.12.4), no-show grace period and max reschedule attempts (3.12.5), stale-talent-pool threshold (3.11.5), audit-log retention beyond the 3-year minimum (3.7.3), bias adverse-impact alert thresholds (3.14.4), candidate-experience alert threshold (§5).

### Mechanism / methodology gaps
- **LinkedIn intake** ([prd.md:71-72](prd.md#L71-L72)) — "manual or semi-automated"; the actual ingestion path (browser extension? CSV? Sales Navigator API?) is undecided.
- **Deduplication signal weighting** — "email, phone, or name + similar profile data" but no similarity scoring rule or HR-review UI defined.
- **Rejection email auto-send vs manager-edit** is per-campaign configurable but no default policy is given.
- **Multi-language support set** — "initial top 10 by hiring volume" is not enumerated; list and per-language QA bar are open.
- **Difficulty adaptation scoring normalization** (3.5.9) — how a "skill ceiling map" produces a comparable score across candidates who saw different difficulty paths is unspecified.
- **Bias auditor demographic proxies** (3.14.1) — name origin, school tier, geographic location, education type — exact classifiers, data sources, and how to keep this from itself being a privacy/fairness liability are not defined.
- **Calibration & drift monitoring** (3.7.4) — flags model/prompt-version changes but doesn't define the statistical comparison or response policy.
- **Predictive analytics outcome loop** (3.18.3) — needs post-hire outcome data "via API or manual input"; the ingestion contract is unspecified.
- **Reference check voice channel** (3.19.2) — depends on the still-undecided realtime + STT/TTS stack and the "human-conducted alternative" workflow has no owner defined.
- **Coaching-mode flywheel** (3.17.2) — "anonymized practice data improves scoring calibration"; the opt-in, anonymization, and feedback loop into production scoring are not specified.
- **Rubric mid-campaign updates** (3.10.3) — system "flags" candidates scored under different rubric versions, but whether to re-score, gate advancement, or just display is left open.
- **Talent-pool re-entry stage** (3.11.2) — "screening stage, or a stage the manager selects" with no constraint on which stages are legal entry points.
- **Manager email notifications** (§5) — explicitly deferred ("future enhancement"); only in-app for V1.
- **Proctoring → action policy** (3.5.4) — violations are logged but never auto-terminate; no severity scale or reviewer SLA defined.
- **AI sentiment analysis on candidate tone** (3.15.2) — "optional, configurable" with no default and no fairness review policy despite the bias-auditor section.
- **Disposition codes** — CLAUDE.md lists a starter set; PRD doesn't enumerate, so the canonical list is owned by code, not spec.
