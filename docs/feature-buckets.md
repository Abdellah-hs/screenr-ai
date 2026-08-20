# Feature Buckets — Screenr AI

> **HISTORICAL — not current status.**
> Written 2026-04-29 and kept as a record of the thinking at the time.
> The keep / clarify / defer split predates everything shipped since: voice screening, the AI video interview, interview scoring, two-stream proctoring, calendar sync, and the manager review decision point.
> For what is actually built today, read [CLAUDE.md](../CLAUDE.md) and [docs/README.md](README.md).

A keep / clarify / defer classification of every feature in [docs/implementation-audit.md](implementation-audit.md), as of 2026-04-29. Use this to scope V1 conversations.

## Keep — built or core enough that V1 can't ship without them

These are either working today, or essential to the ATS skeleton. Don't reopen scope on these.

- **Campaign CRUD + AI criteria + AI rubrics** (3.1) — full path works.
- **Gmail resume intake + PDF parse + structured candidate** (3.2.1, 3.2.2 PDF half) — the only working ingestion route, keep.
- **AI resume screening with factor breakdown + tiers** (3.3.1, 3.10.1) — already wired to UI.
- **Automation modes (auto / HITL) + threshold-driven advance / reject** (3.3.2, 3.3.3) — rules layer is correct shape.
- **AI-generated screening questions + recruiter edit** (3.4.1).
- **Token-based candidate form** (3.4.2) — signed-token / RLS / IP rate-limit pattern is sound.
- **AI screening-answer scoring** (3.4.4) — keep the scoring + rule-layer split, even though the input format is a clarify item below.
- **Append-only `application_transitions` log + atomic RPC** (3.7.1, 3.7.2) — this is the spine, do not regress.
- **Granular score attribution UI** (3.10.1) — already rendering on candidate page.
- **Campaign cloning** (3.12.3) — small but done.
- **Auth + middleware + RLS on every domain table** (§7.2) — core.
- **Manager candidate list + detail page** (3.6.1 partial) — keep, layer compare/notes/bulk on top.

## Clarify — needs a product/eng decision before more code lands

These have a real fork in the road. Don't pick one silently.

- **Screening response format** (3.4.3) — text today vs PRD's video/audio + practice + re-record. Decide: ship V1 with text and migrate later, or block V1 on recording infra? Affects 3.4.4, 3.10.2, every AI prompt.
- **AI Technical Interview scope** (3.5) — biggest open question. Decide: is V1 "ATS without the AI interview" (everything 3.6+ becomes manual), or does V1 require shipping the realtime stack? Gates 3.5.4–3.5.11, 3.6.4, 3.10.2, 3.13, 3.16.
- **AI engine commitment** — code is OpenAI `gpt-4o-mini`, PRD says Claude Opus 4.5. Already flagged in [docs/prd-notes.md](prd-notes.md); pick one and update the other doc.
- **Email transport** (§4, §8 TBD) — recruiter-Gmail OAuth today vs PRD's Resend / Postmark / SendGrid. Affects rejection, reminder, interview-invite, no-show templates and DKIM/deliverability story.
- **Deduplication policy** (3.2.3) — current `upsertCandidate` auto-merges on email; PRD says HR-flag. CLAUDE.md already flags this; needs an explicit HR-review UI design before changing.
- **Rubric versioning behavior** (3.10.3) — `version`/`is_active` columns exist; no scoring path stamps version onto a score. Decide: re-score on rubric change, gate advancement, or just badge the difference?
- **LinkedIn intake mechanism** (3.2.1) — browser extension, CSV import, or Sales Navigator API? Spec says "manual or semi-automated"; pick something.
- **DOCX support** (3.2.2) — PRD requires it; code is PDF-only. Yes/no for V1?
- **Multi-reviewer collaboration** (3.6.3) — current `team-reviewers-editor` writes fake `user_id`s; either commit to inviting real users or rip the editor out until the model is real.
- **AI audit-log completeness** (3.7.1) — schema is missing `rubric_version` / `confidence`; resume-scoring + screening-scoring paths don't write a row. Adds compliance risk if 3-year retention (3.7.3) becomes a real requirement.
- **Rate limiting** (§7 implied) — in-memory will break on Hetzner if it scales beyond one instance. Decide before deploy.
- **Tier naming** (3.3.1) — code uses `moderate`, PRD uses `Potential Match`. Tiny but visible to managers.
- **Mobile responsiveness** (3.9.3) — needs an actual iOS Safari / Android Chrome pass, not assumed.

## Defer — explicitly out of V1 (revisit later)

These are PRD features with no code today; defer them with eyes open.

- **Smart difficulty adaptation, multi-language, live simulations** (3.5.9–3.5.11) — depend on the AI interview existing.
- **Interview replay / AI commentary / highlight reel** (3.6.4) — depends on recordings.
- **Calibration & drift monitoring** (3.7.4) — needs first the audit-log fix.
- **Audit log admin UI + 3-year retention export** (3.7.3) — data is captured append-only; UI/export can wait, but **note compliance risk if EU customers come early**.
- **Final interview scheduling + Google Calendar** (3.8) — depends on 3.5 being real.
- **AI-personalized rejection email** (3.9.1) — defer the AI personalization; ship a plain template if any rejection email is needed for V1.
- **Interview prep guide page** (3.9.2) — only meaningful once the AI interview exists.
- **Score comparison view** (3.10.3) — quality-of-life on top of 3.6.
- **Scoring methodology documentation surface** (3.10.4) — derivable from existing data; UI can wait.
- **Talent pool** (3.11) — entire V1.5 feature, no current dependents.
- **Bulk actions** (3.12.1).
- **SLA timer enforcement / overdue filter** (3.12.2) — config UI exists; enforcement job deferrable.
- **Auto-archiving** (3.12.4).
- **No-show handling** (3.12.5) — depends on interview scheduling.
- **Reusable template library** (3.12.6).
- **Skill fingerprint** (3.13).
- **Bias auditor** (3.14) — defer with a flag: this is **regulatory** for EU AI Act, so the moment EU hiring is on the roadmap this jumps to "clarify".
- **Candidate experience surveys** (3.15).
- **Team fit prediction** (3.16).
- **Coaching mode public practice** (3.17).
- **Predictive analytics** (3.18).
- **AI reference check** (3.19).
- **Admin notifications / alerts** (§5) — in-app notifications can wait until there's enough surface to alert on.

## What to act on first

The two biggest forks are **3.4.3 (screening recordings)** and **3.5 (the AI interview itself)**. Everything in "defer" assumes 3.5 isn't V1 — if you decide it is, ~10 deferred items move up. Get the answer to that before any more coding.
