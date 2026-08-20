# docs/ — what is here, and what you can trust

Reviewed **2026-08-20** against `main`.

Most of this folder is planning material from April and May 2026. It was written
before the AI video interview, voice screening, proctoring, calendar sync and
the manager review decision point shipped — and it reads as *current status*,
which is exactly how it misleads. Every stale file now carries a dated banner
saying so; this page is the index.

**If you are starting from scratch, read in this order:**

1. [../CLAUDE.md](../CLAUDE.md) — the working agreement. State-machine rules,
   architecture boundaries, testing policy, every recorded decision. If this
   file and any other disagree, **CLAUDE.md wins**.
2. [architecture.md](architecture.md) — the reading map: what each layer is and
   what it is allowed to do.
3. [prd.md](prd.md) — the product requirements.

---

## Current

| File | What it is |
| --- | --- |
| [prd.md](prd.md) | The product requirements. **Amended in place** as decisions land, with dated entries (2026-06-23 on-demand interviews, 2026-08-04 no recording). That convention works — keep it. |
| [architecture.md](architecture.md) | The layer map and reading order. Refreshed 2026-08-20: six layers, the current directory map, the agent workers as a trust boundary. |
| [onboarding.md](onboarding.md) | Intern onboarding — tech stack, workflow, conventions. Reviewed 2026-08-20: the pipeline overview, the tech-stack table (five rows were wrong or still said "TBD"), the AI/real-time learning sections and the access list are all corrected. The setup and workflow walkthroughs have not been re-verified step by step. |
| [voice-screening.md](voice-screening.md) | The screening threat model — why the unscripted follow-up exists. **Shipped**, but two transport decisions in it were later reversed; the file says which, inline. |

## Historical — kept for the reasoning, not the facts

These describe a codebase that no longer exists. They are kept because *why* a
decision was made is worth more than a stale list of what was built, and git
history alone does not explain intent.

| File | Written | Why it is wrong now |
| --- | --- | --- |
| [implementation-audit.md](implementation-audit.md) | 2026-04-29 | Superseded by the 2026-08-14 audit (#160). Describes Gmail resume intake, a shared `GOOGLE_REFRESH_TOKEN`, and a standalone screening-criteria editor — all three retired. |
| [feature-buckets.md](feature-buckets.md) | 2026-04-29 | Its keep / clarify / defer split predates everything shipped since. |
| [delta-prd.md](delta-prd.md) | 2026-04-29 | Assumes "V1 = ATS-first, not the full real-time AI interview platform". The interview shipped. |
| [issue-seed.md](issue-seed.md) | 2026-04-30 | A draft that was bulk-created into GitHub issues. The board is the live record. |
| [prd-notes.md](prd-notes.md) | 2026-05-16 | A reading of the PRD as it stood. Says the interview is Claude + TTS/STT (it is OpenAI Realtime) and that it is recorded (retired 2026-08-04). |
| [issues/v1-issues.md](issues/v1-issues.md) | 2026-05-16 | The I-numbered seed list. **Deliberately not edited** — many open issues cite it as `Source: I<n>`, and rewriting it would break those references. |
| `architecture-report.html` / `.pdf` | 2026-04 | Generated report, pre-dating almost everything. Superseded by `architecture.md`. |

`frontend-design-prompt.md` is a working file, not a status document.

---

## Keeping this honest

The failure mode this folder had is not "the docs are out of date" — that is
normal and mostly harmless. It is that **a stale document with no date on it
reads as current**, so a new contributor or an agent re-plans against a snapshot
from months ago.

So the rule is narrow and cheap:

- A doc that describes **what is built** carries a *reviewed on* date.
- A doc that has stopped being true gets a **banner**, not a deletion — losing
  the reasoning is worse than keeping an obsolete fact that is labelled obsolete.
- Decisions land in **CLAUDE.md** and in dated PRD amendments. Neither is a
  planning artifact, so neither goes stale the same way.
