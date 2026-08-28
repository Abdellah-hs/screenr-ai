# Front-end design prompt — Screenr AI

A ready-to-paste brief for an AI design tool (v0, Lovable, Figma Make, Claude,
UX Pilot, Galileo…). Part 1 is the master prompt — paste it first, once. Part 2
holds short follow-ups, one per screen. Part 3 has tool-specific tips.

Everything below describes the app as it actually exists today, so the design
that comes back can be built without rewriting the product.

---

## Part 1 — Master prompt (copy everything in this section)

You are a senior product designer. Design the front end for **Screenr AI**.
Read the whole brief before proposing anything. Ask nothing; make decisions and
explain them briefly.

### What the product is

Screenr AI is an internal ATS (applicant tracking system) with an AI interviewer
built in. A recruiter creates a **campaign** (one open role), shares a public
apply link, and candidates submit CVs. The system then runs the pipeline: it
parses and scores the CV, sends a **voice screening** link, scores the
transcript, invites the candidate to an **AI video interview**, scores that, and
hands the finished file to a human for the final decision.

The core idea the design must communicate: **the AI advises, a person decides.**
AI produces scores, rationale, transcripts and flags. It never moves a candidate
forward and never rejects anyone. Every state change is an explicit rule or an
explicit human click. The interface should always make it obvious which of the
two happened.

### Who uses it

1. **Recruiters / hiring managers** — signed in, on desktop, all day. They live
   in dense list and detail views. They want to know, in one glance: who is
   waiting on me, who is stuck, who is strong. Speed and scannability beat
   decoration.
2. **Candidates** — they never sign in. They open a private link sent by email
   (a token URL) and land on a single-purpose page. They may be nervous, on a
   phone, in a hurry. These pages need calm, generous, human design with almost
   no chrome. The AI video interview is the one exception: desktop-only and
   full-screen.

### Product rules the design must obey (non-negotiable)

- **No composite score.** Each stage (CV, screening, interview) has its own
  score out of 100 and its own tier: Strong / Potential Match / Weak / No Match.
  Never average them into one number, never build a "master score" ring.
  Managers compare stage evidence side by side.
- **A score always travels with its evidence.** A number alone is not
  shippable. A score is shown with its written rationale and, where one exists,
  the transcript excerpt it came from. Design the score and its "why" as one
  unit.
- **Every candidate has a visible history.** Each stage change is logged with
  who did it (system / AI / recruiter), when, and why. There is a timeline; make
  it a first-class part of the candidate page, not a collapsed footnote.
- **Rejection needs a written reason.** When a recruiter rejects or archives
  someone they pick a reason code (Low score, Failed interview, No show,
  Expired, Manager override) and type a rationale. The modal should feel
  deliberate, not like a confirm dialog.
- **Candidates never see internal scores, tiers, or rankings.** Not on the apply
  page, not in rejection views, nowhere. Design candidate-facing pages as if
  scores do not exist.
- **Failure is always visible.** Links expire, interviews are abandoned, parsing
  fails. These are real states — Screening expired, Interview expired, No show,
  Processing failed — and each needs its own visual treatment. Never a blank
  row, never silence.
- **Proctoring is evidence, not a verdict.** The AI interview watches for tab
  switching, a missing camera, more than one person on camera, and a phone in
  frame. It reports warnings and criticals with timestamps and a still image,
  and it can be wrong. The report must be visibly separate from the score and
  must carry a plain-language note that it is fallible. It never blocks or
  rejects anyone. Do not design it as a red "cheating detected" panel.

### Technical constraints

- Next.js 16 App Router, React 19, TypeScript, **Tailwind CSS 4**.
- Most pages are server-rendered. Client interactivity is deliberately small:
  modals, dropdowns, live call UI. Avoid designs that need heavy client state or
  animation libraries.
- No third-party component library. UI primitives are hand-written: Button,
  Card, Input, Select, Textarea, Badge, Modal, anchored dropdown menu.
- Icons are inline SVG in a Heroicons-style outline (1.5–2px stroke, 24×24 box).
  Do not introduce an icon font or a paid icon set.
- Accessibility: minimum 44×44px hit target on every interactive element,
  visible focus rings, colour is never the only signal (pair it with text or an
  icon), reduced motion respected.
- The dashboard is desktop-first (1280–1600px is the real working width) but
  must not break on a tablet. Candidate pages are mobile-first.

### Current visual language (this is the live code — treat it as the baseline)

```
Primary        #2563EB   blue — links, active nav, focus rings
Secondary      #4F46E5   indigo
Accent / CTA   #10B981   emerald — positive and confirming actions
Background     #FAFAFA   page
Surface        #FFFFFF   cards
Text           #111827   primary   /  #6B7280 muted
Border         #E5E7EB
Muted fill     #F3F4F6

Stage colours   applied grey · screening blue · interview purple ·
                final interview amber · hired green · rejected red
Tier colours    Strong green · Potential Match amber · Weak red ·
                No Match deep red

Body font       Jost
Heading font    Bodoni Moda (serif display), tight tracking
Radius          8px controls, 12px cards, 16px modals
Shadows         soft and low: 0 1px 2px / 0 4px 6px / 0 10px 15px
Layout          fixed 256px left sidebar, content max-width 1280px
```

Keep this palette and structure recognisable. You may refine it — better
hierarchy, better spacing rhythm, better empty and loading states, a more
considered data-dense table — but do not hand back a different product. If you
change a token, say which one and why in one line.

### Screens to design

**Recruiter app.** Left sidebar: Overview · Campaigns · Talent Pool ·
Duplicates · Audit Log · Settings. Top bar with a notification bell.

1. **Overview** — the daily landing page. Four KPI tiles (active campaigns,
   people in pipeline, awaiting my review, hired). A pipeline funnel across the
   five stages. A "needs you" list: reviews pending, interviews finished and
   waiting for a decision, links expiring soon, interviews that lapsed. Recent
   outcomes. This page answers "what do I do next", so waiting work should
   outrank the vanity numbers.
2. **Campaigns list** — cards or a table of open roles with status, candidate
   count, stage breakdown. Bulk actions, row actions, clone, share link.
3. **Campaign detail** — the role's own dashboard: pipeline funnel, candidate
   table, scoring rubric, screening questions, SLA timers, automation mode
   (fully automatic vs human-in-the-loop), team reviewers, the public apply
   link, and a "share on LinkedIn" panel with AI-drafted copy the recruiter
   edits before posting.
4. **Candidate table** — the workhorse. Columns: name + email, stage badge,
   stage score with tier, days in stage, SLA overdue flag, last activity, row
   actions. Must stay readable at 200 rows with filtering and sorting. This is
   the single most important component in the app — spend your effort here.
5. **Candidate detail** — the evidence file for one person on one campaign.
   Sections: identity and contact; CV score with rationale; parsed CV; voice
   screening transcript with per-question scores and excerpts; AI interview
   transcript, section scores, strengths, concerns; the proctoring report; the
   full stage timeline; and the action panel (advance, reject, add to talent
   pool). It is long and heavy — solve the navigation problem.
6. **Human-in-the-loop review panel** — a recruiter reads an AI score and
   approves or rejects before screening is sent. Show the AI recommendation
   clearly, and make disagreeing with it require a typed reason.
7. **Manager review panel** — the last human gate before hire or reject. All
   three stage scores side by side, links to the evidence, decision buttons.
8. **Rubric editor** — the recruiter marks each criterion Must-have or
   Nice-to-have and Low/Medium/High importance. The AI derives the weights
   behind the scenes; never expose numeric weight sliders.
9. **Talent Pool** — two lists that must not look identical: the automatic
   directory of everyone who ever applied, and the curated pool of "silver
   medalists" a recruiter deliberately saved with tags and notes. Rich search:
   free text, tags, original campaign, date added, score range.
10. **Duplicates review** — possible duplicate people, flagged for a human to
    merge or dismiss. Never auto-merged.
11. **Audit log** — every AI call and every stage change, filterable.
12. **Settings** — connect Gmail, connect LinkedIn, connection health.
13. **Auth** — login and sign up. Simple, branded, fast.

**Candidate-facing pages.** No account, no navigation, one job per page.

14. **Apply page** — public per-campaign URL. Role description, CV upload, a few
    fields, confirmation. Mobile-first. This is the first impression of the
    employer; make it feel like a company that has its act together.
15. **Voice screening** — the candidate joins a live voice call with an AI that
    asks the screening questions. Needs: a clear pre-call check (mic permission,
    what to expect, how long), a practice question, a calm in-call state showing
    who is speaking and which question they are on, the ability to re-record
    before submitting, and a warm confirmation screen. No scores anywhere.
16. **AI video interview** — desktop-only, full screen. Camera self-view,
    audio-only AI interviewer, question progress, time remaining, an honest
    up-front notice that integrity monitoring is running, and detection boxes
    drawn over the self-view. State explicitly that the session is **not
    recorded** — only a transcript is kept. Design the "please use a desktop"
    state too.
17. **Final interview scheduling** — the candidate picks a slot with a real
    human from available times. Mobile-first, timezone-aware.
18. **Shared candidate states** — link expired, already submitted, something
    went wrong. Design these properly; they are the pages people hit when they
    are already anxious.

### What to deliver

1. A short design rationale: the one idea holding the system together.
2. Refined design tokens: colour scale, type scale, spacing, radii, shadows, and
   the semantic tokens for stage, tier and severity.
3. The component library: button variants, input, select, textarea, badge
   (stage, tier, SLA, severity), card, modal, dropdown, table, tabs, timeline
   entry, score-with-rationale block, transcript block, empty state, loading
   skeleton, toast.
4. High-fidelity screens for at least: Overview, Campaign detail, Candidate
   table, Candidate detail, Manager review, Apply, Voice screening, AI
   interview.
5. For each screen: the empty state, the loading state and the error state. Not
   optional — this app is mostly pending, expired and failed states.
6. Output as Tailwind CSS 4 + React components using the constraints above.

### Quality bar

Aim for the density and calm of Linear or Vercel's dashboard, with the
evidence-first seriousness of a medical or legal record. This tool decides
whether people get jobs; it should feel accountable, not playful. No gradients
as decoration, no glassmorphism, no emoji in the UI, no sparkle icons on AI
features, no dark patterns on candidate pages.

Things that would make this design wrong: a single overall candidate score; a
leaderboard ranking people against each other; an AI panel that reads like it
made the decision; a proctoring report styled as an accusation; candidate pages
that leak internal data; a dashboard that looks impressive and answers nothing.

---

## Part 2 — Follow-up prompts, one screen at a time

Send these after the master prompt, one at a time. Small asks get better results
than "design everything".

**Candidate table**

> Design the candidate table in detail. 200 rows, desktop. Columns: name +
> email, stage badge, stage score with tier, days in stage, SLA overdue flag,
> last activity, row actions. Show the default state, a filtered state, the
> empty state, the loading skeleton, and a row that is overdue. Include the
> filter bar and how multi-select bulk actions appear.

**Candidate detail**

> Design the candidate detail page. It contains identity, CV score + rationale,
> parsed CV, screening transcript with per-question scores, interview transcript
> with section scores and strengths/concerns, the proctoring report, the stage
> timeline, and the action panel. Solve the length problem: propose a layout
> (sticky sub-nav, tabs, or two columns) and justify the choice. Show one
> transcript collapsed and expanded.

**Score with rationale**

> Design the reusable "score block": a stage score out of 100, its tier badge,
> the AI's written rationale, the model and rubric version, and a link to the
> evidence behind it. Show it at three sizes: inline in a table, as a card, and
> as a full section. Make it impossible to read the number without seeing that
> it is an AI opinion.

**Proctoring report**

> Design the proctoring report. It lists incidents with type (tab left, camera
> off, more than one person, phone visible), severity (warning / critical),
> timestamp, duration, source (browser signal vs camera vision), and a still
> image where one exists. Include a plain-language note that detection can be
> wrong and that no video was recorded. Also design the clean-run state and the
> "never watched" state — these two must not look the same.

**Voice screening (candidate)**

> Design the candidate voice screening flow, mobile-first: intro and what to
> expect, mic permission request, practice question, live call, re-record,
> submit, confirmation. Plus link expired, already submitted, mic blocked. No
> scores anywhere. Calm and reassuring.

**AI video interview (candidate)**

> Design the desktop-only AI video interview: pre-flight check (camera, mic,
> desktop-only warning), the honest integrity notice, the live screen with
> self-view + detection overlay + progress + time remaining, and the submit
> confirmation. State clearly that nothing is recorded, only transcribed.

**Overview**

> Design the recruiter Overview page so it answers "what needs me today" before
> it shows any totals. Four KPI tiles, pipeline funnel, a prioritised action
> list, recent outcomes, and the notification bell dropdown.

**Rejection modal**

> Design the reject/archive modal: reason code select, a required written
> rationale, an optional "add to talent pool" checkbox that is unchecked by
> default, and the AI recommendation being overridden shown alongside. It should
> feel like signing something.

---

## Part 3 — Getting good output

- **v0 / Lovable** — paste Part 1, then ask for one screen per message. They
  build React + Tailwind directly, so the technical constraints pay off. Ask for
  tokens first, screens second.
- **Figma Make / Galileo / UX Pilot** — they want visual direction more than
  code rules. Keep Part 1 and add two or three reference products you like.
- **Claude / ChatGPT** — ask for the design system and rationale as a document
  first, then generate components against it. Feed it the real token list above
  so it does not invent a new palette.
- **Attach screenshots of the current app** with the line: "this is what exists
  today; keep the structure, raise the craft." Nothing improves output more than
  showing the current state.
- Always ask for empty, loading and error states explicitly. Design tools skip
  them by default, and this app is mostly those states.

## Note on the existing design-system file

`design-system/screenr-ai/MASTER.md` is out of date. It specifies a sky-blue
palette (`#0369A1` / `#0EA5E9` / `#22C55E`, background `#F0F9FF`) with Fira Code
+ Fira Sans. The shipped app in `src/app/globals.css` uses blue `#2563EB`,
indigo `#4F46E5`, emerald `#10B981`, background `#FAFAFA`, with Jost + Bodoni
Moda. **The code is the truth** — that is what this brief describes. Worth
updating MASTER.md to match, or the two will keep drifting.
