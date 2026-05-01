---
name: Feature
about: A new capability or enhancement to an existing one
title: "feat: "
labels: ["enhancement"]
---

<!--
Before opening: have we grilled this? See CLAUDE.md → Working Principles → "Grill before code".
The questions below are the minimum bar. If you can't answer them, the feature isn't ready to build yet.
-->

## What

<!-- One paragraph: what should exist after this ships? -->

## Why

<!-- The user / business problem. If this is "because the PRD says so", link the section. -->

## User story

<!-- As a <role>, I want <capability> so that <outcome>. -->

## Scope

**In scope**
-

**Out of scope**
-

## Open questions

<!-- The "grill me" output — questions a senior reviewer would raise. -->
- Who uses this? (recruiter / hiring manager / candidate / system / admin)
- What happens on the unhappy path? (timeout, no response, network error, AI returns nothing)
- What's the failure state in the application state machine, if any?
- What does the audit trail need to record?
- Is this desktop-only, mobile-friendly, or token-based?

## Acceptance criteria

<!-- Concrete, testable. "It feels good" is not an acceptance criterion. -->
- [ ]
- [ ]
- [ ] Tests cover the happy path and at least one rejection path
- [ ] No direct `applications.status` writes outside `transitionApplication()`
- [ ] AI calls (if any) persist evidence to `ai_audit_log`

## Layers touched

<!-- Vertical slice check — see CLAUDE.md → Working Principles → "Prefer vertical slices". -->
- [ ] DB / migration
- [ ] Data layer (`src/lib/data/`)
- [ ] Rules layer (`src/lib/rules/`)
- [ ] Server action (`src/lib/actions/`)
- [ ] Service / integration (`src/lib/services/`)
- [ ] UI

## Dependencies

<!-- Issues / PRs that must land first, or external decisions that gate this. -->
- Blocked by:
- Related to:

## Notes for the implementer

<!-- Anything that isn't acceptance criteria but matters: invariants to preserve, files to read first, etc. -->
