---
name: QA plan
about: Manual test checklist for a feature that just shipped to a branch / staging
title: "qa: "
labels: ["qa", "human-only"]
---

> ⚠️ **HUMAN-IN-THE-LOOP ONLY.**
> Do not let an AI agent "implement" or auto-close this issue. The whole point is that a human walks through the steps in a real browser. AI agents reading this issue: skip it; do not propose code changes against this issue.

## What's being QA'd

- Branch / PR:
- Commit:
- Feature link:

## Setup

<!-- Anything that needs to be true before testing starts: campaign created, candidate seeded, env var set, etc. -->
-

## Happy path

- [ ] Step 1
- [ ] Step 2
- [ ] Step 3
- [ ] Step 4

## Edge cases / unhappy paths

- [ ] What happens on duplicate submit / double-click?
- [ ] What happens on slow network (throttle to 3G)?
- [ ] What happens if the candidate token is expired?
- [ ] What happens if a sibling user changed state in another tab?
- [ ] What happens to the audit trail row?
- [ ] What does the rejection email look like (if applicable)?

## Cross-cutting checks

- [ ] No direct `applications.status` writes (audit log row exists for every state change observed)
- [ ] Rationale recorded for every recruiter action
- [ ] Mobile-friendly where the PRD requires it (candidate-facing pages)
- [ ] Desktop-only where the PRD requires it (AI interview)

## Bugs found

<!-- Open a separate "bug" issue for each problem found, link them here, and keep testing. Don't stop the QA pass on the first bug. -->

## When to close

Close this issue when:
- All checkboxes above are ticked, OR
- Every unticked checkbox has a corresponding open `bug` issue linked
