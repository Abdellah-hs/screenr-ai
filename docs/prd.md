# Product Requirements Document (PRD)
# Hiring System — Internal ATS & AI Interview Platform

## 1. Overview

### 1.1 Purpose
Build an internal Applicant Tracking System (ATS) and AI-powered interview platform to manage the full hiring pipeline — from resume collection through final interview scheduling. The system replaces all manual hiring workflows with an automated, AI-driven pipeline.

### 1.2 Target Users
- **Primary:** Internal HR team and hiring managers
- **Secondary (external):** Candidates (interact via email links and interview portal only — no candidate accounts)

### 1.3 Scope
- Supports **all role types** (engineering, sales, marketing, operations, etc.)
- Designed to handle **thousands of candidates per campaign**
- Greenfield build — no legacy system to integrate with or migrate from

---

## 2. Hiring Pipeline Stages

The system follows a sequential pipeline. Each candidate progresses through these stages:

```
Resume Collection → AI Screening → Filtering → Screening Questions →
Answer Scoring → AI Interview Invitation → AI Interview →
Interview Scoring → AI Reference Check (optional) → Manager Review →
Final Interview Scheduling
```

Each stage produces an **independent score**. There is no composite score — managers view per-stage scores independently.

---

## 3. Feature Requirements

### 3.1 Campaign Management

#### 3.1.1 Campaign Creation
- Hiring managers create **campaigns** (one per open role/position)
- Each campaign includes:
  - Job title
  - Job description (free-text, rich text)
  - Department / team
  - Location / timezone preferences (optional)
  - Number of positions to fill
  - Campaign status (draft, active, paused, closed)
  - Deadline (optional)

#### 3.1.2 Custom Screening Criteria
- Hiring managers define **custom screening criteria** per campaign
- The system uses AI to **suggest criteria** based on the job description
- Managers can accept, modify, or reject AI suggestions and add their own
- Criteria examples: required skills, minimum experience, education level, certifications, language proficiency

#### 3.1.3 Evaluation Rubrics

> **Decision (#77, refined 2026-08-19 and 2026-08-22):** **the recruiter never
> sets a weight or a fail line.** A number you can nudge is a number you will
> nudge until the rubric agrees with the answer you already wanted, so the
> editor collects intent and derives the arithmetic:
>
> - **Resume** asks for **priority** only — must-have or nice-to-have. Every
>   must-have is an independent gate; nice-to-haves are averaged, unweighted.
>   Importance is not an input here and does not affect the score.
> - **Screening and interview** ask for **importance** only — high/medium/low,
>   normalised into weights at score time. Neither stage has a must-have gate,
>   because a spoken answer is noisier evidence than a document; a weak answer
>   lowers the score and never auto-rejects.
>
> "Weight and pass/fail thresholds per stage" below is therefore retired as a
> recruiter-facing control. Both still exist as derived, stored columns.

- Managers can define **custom evaluation rubrics** per role for each pipeline stage
- The system can **generate a standard rubric using AI** based on the job description and role type
- Rubrics define scoring dimensions, weight, and pass/fail thresholds per stage

---

### 3.2 Resume Collection

#### 3.2.1 Intake Channels

> **Decision (2026-08-23):** Resume intake by **monitored email inbox is
> retired** and will not be built. The requirement below is replaced by the
> public apply page.
>
> Every candidate enters through a campaign's own apply link
> (`/apply/<slug>`), which is the only intake path in the product. An inbox
> cannot say which campaign a CV is for, so routing would need a rule the
> recruiter maintains by hand — a label, an alias, a plus-address — and every
> such rule is a way for a real applicant to land nowhere. The apply link
> carries the campaign in the URL, so an application is bound to a campaign by
> construction rather than by inference, and the candidate gets an immediate
> confirmation instead of silence.
>
> Gmail remains connected, and remains **outbound only**: it sends screening
> and interview invitations from the recruiter's own address. See CLAUDE.md.

Resumes enter the system from these sources:

| Channel | Description | Status |
|---|---|---|
| **Public apply link** | `/apply/<slug>` per campaign. The candidate uploads a CV directly and the application is created against that campaign. | Shipped |
| **LinkedIn Messages** | Resumes received via LinkedIn direct messages. Manual or semi-automated import into the system. | Not built |
| **LinkedIn Campaigns** | Bulk import from LinkedIn recruiter campaigns. Candidates sourced via LinkedIn outreach are imported with their profile data. | Not built |

Deduplication (3.2.3) still says "across channels" and still matters: the same
person can apply to two campaigns, or twice to one.

#### 3.2.2 Resume Parsing
- Supported formats: **PDF** and **DOCX**
- The system extracts structured data from resumes:
  - Full name
  - Email address
  - Phone number
  - Work experience (company, title, dates, description)
  - Education (institution, degree, dates)
  - Skills / technologies
  - Languages
  - Location
  - Links (LinkedIn, portfolio, GitHub, etc.)
- Parsed data is stored in a structured candidate profile
- The original resume file is retained for reference

#### 3.2.3 Deduplication
- The system detects duplicate candidates across channels (by email, phone, or name + similar profile data)
- Duplicates are flagged for HR review rather than auto-merged

---

### 3.3 AI Resume Screening

#### 3.3.1 Automated Screening

> **Decision (2026-08-19):** **the model never returns a number for a resume,
> and the four-tier classification is retired at this stage.**
>
> The model reads the CV and reports, per criterion, an **evidence level**
> (`not_present` | `unclear` | `weak` | `partial` | `strong` | `very_strong`)
> plus verbatim quotes, which are verified against the exact document it was
> shown. Every number is then derived by a fixed table. Two reasons: "is this a
> 68 or a 74?" has no stable answer, so the same CV could score differently on
> consecutive runs — a reading repeats, an arbitration does not; and a weighted
> total lets a surplus on one criterion pay for a shortfall on another, which
> turns a must-have into a mostly-have.
>
> The tier is **`eligible` | `ineligible`**, not Strong/Potential/Weak/No Match.
> Ineligible is a hard reject in every automation mode, human-in-the-loop
> included — a gate is not a review call. The score that survives is the
> **ranking score**: the mean evidence score across every criterion, computed
> only for an eligible candidate, and `null` otherwise. A low number there would
> read as "how close they came" and invite an argument with the gate.
>
> **Amended 2026-08-23:** the ranking originally averaged the *nice-to-haves
> only*, so a must-have contributed nothing beyond passing its gate and two
> candidates who cleared every requirement were ordered entirely by optional
> extras. It now averages all criteria. The gate is unchanged and runs first, so
> a nice-to-have still cannot repair a failed must-have — an ineligible
> candidate has no ranking for a surplus to inflate. See CLAUDE.md, "The ranking
> is graded on must-haves too".
>
> The factor-level breakdown and the written rationale (3.10.1) are unaffected
> and are the whole point — the breakdown now shows the evidence level and the
> quote behind each criterion.

- AI evaluates each parsed resume against the campaign's screening criteria
- Produces an **independent screening score** (0–100) with a **granular factor-level breakdown** by criterion (see 3.10.1)
- AI provides a **written rationale** explaining the score
- Candidates are classified into tiers: **Strong Match**, **Potential Match**, **Weak Match**, **No Match**

#### 3.3.2 Automation Mode
- **Default: Fully automated** — candidates who meet the threshold automatically advance to the next stage
- **Optional: Human-in-the-loop** — a toggle per campaign that requires a human to approve/reject each AI screening decision before the candidate advances
- When human review is enabled, reviewers see the AI score, rationale, and parsed resume side-by-side

#### 3.3.3 Threshold Configuration

> **Decision (2026-08-21, extended 2026-08-22):** there are **two thresholds,
> not one**, and only the first of them rejects.
>
> `resume_threshold` gates the CV's ranking score: below it is a rejection,
> at or above it advances to screening. `screening_threshold` gates the voice
> answers: at or above it the candidate is invited to the interview, and **below
> it the application rests at `screening_scored` for a person to look at — it is
> never auto-rejected.**
>
> They were one column read by both rules while the UI showed one box, so a
> recruiter raising the bar to stop weak CVs was silently also raising the bar on
> candidates who had already answered well. They are not the same kind of number.
>
> The screening stage stopped auto-rejecting because the leverage is not there:
> the must-have gate and `resume_threshold` have already cut the pile before a
> link is sent, so auto-rejecting after a live call saved a handful of review
> items at the price of never letting a person look at someone who held a
> conversation with the product. **The interview stage has no threshold at all**
> — see 3.5.
>
> Note that the must-have gate is *not* a threshold and runs before either: a
> failed must-have is a hard reject in every automation mode.

- Hiring managers set the **minimum score threshold** for auto-advancement per campaign
- Candidates below the threshold are auto-rejected (with AI-personalized rejection email — see 3.9.1)
- Candidates at or above the threshold advance to screening questions

---

### 3.4 Screening Questions

#### 3.4.1 Question Generation
- AI **generates screening questions** based on:
  - The job description
  - The campaign screening criteria
  - The candidate's resume (for personalized questions)
- Hiring managers can review, edit, add, or remove questions before they are sent
- Questions can be a mix of:
  - Role-specific technical questions
  - Behavioral / situational questions
  - Culture fit questions

#### 3.4.2 Delivery
- Candidates receive an **email** with a **unique link** to a screening form
- The link opens a web-based form (no login required — token-based access)
- The form is branded with the company identity

#### 3.4.3 Response Format

> **Decision (2026-08-23, recording what shipped from #82–#85, #161 and
> 2026-08-22):** the screening stage is a **live voice call**, not a
> record-and-upload form. The section below describes a form that was never
> built and will not be; what actually ships is:
>
> - The candidate joins a **LiveKit room** and holds a real conversation with an
>   OpenAI Realtime agent, which asks the campaign's questions in order and can
>   ask unscripted follow-ups. There is no record button, no upload, and no
>   per-question take.
> - **Audio is not stored.** The durable record is the server-side transcript,
>   which is what every score is traced to. "Managers can view the recorded
>   responses" below is therefore not achievable and is retired with the rest.
> - **Video is an accepted divergence (#48, closed).** Audio is what ships.
> - The **typed-answer path was retired in #161.** No env flag re-enables it.
> - **Questions are not individually required or optional** — `is_required` was
>   dropped 2026-08-21. Every question is asked.
> - The **practice question** (#140) and **per-question time limits** are still
>   open. A time limit sat naturally on a recording UI and sits awkwardly on a
>   conversation; #140 decides its fate rather than assuming it.
>
> The scoring unit changed with it — see 3.4.4.

- All screening question responses are **video/audio recordings**
- The form begins with a **practice question** (not scored) so candidates can:
  - Test their camera and microphone setup
  - Get comfortable with the recording interface
  - Re-record the practice response as many times as needed
- After the practice question, the scored questions begin. The form provides:
  - A question displayed on screen (text + optional context)
  - A record button for the candidate to record their video/audio response
  - Ability to re-record before submitting
  - Time limit per question (configurable by campaign)
  - Progress indicator showing which question they're on
- Responses are uploaded and stored securely

#### 3.4.4 Answer Scoring

> **Decision (2026-08-22):** **the rubric dimension is the scoring unit, not the
> question.** The per-question model below is retired.
>
> Questions are how the call goes looking; the rubric is what is graded. A
> candidate who evidences a competency while answering some *other* question has
> evidenced it, and per-question reading could not see that — it also gave a
> competency probed by two questions twice the say of one probed by a single
> question, a weighting nobody chose and phrasing produced.
>
> What ships: the model reads the whole transcript and reports an **evidence
> level plus verbatim candidate quotes per rubric dimension**; quotes are
> verified against the candidate's half of the transcript; the score is derived
> deterministically and weighted by the recruiter's importance choice. The model
> is never shown the weights and never returns a number. A dimension no question
> probes scores 0, which is why coverage is checked before a campaign goes live.
>
> The link from a score to its justifying excerpt (3.10.2) survives — it is now
> **per dimension** rather than per question.

- AI transcribes the video/audio responses
- AI evaluates each response against the rubric and produces:
  - Per-question score
  - Overall screening questions score (independent from resume score)
  - Written evaluation summary per question
- Hiring managers can view the recorded responses alongside AI evaluations
- Each per-question score links to the **transcript excerpt** that justifies it (see 3.10.2)

---

### 3.5 AI Technical Interview

This is the core differentiator of the platform — a real-time conversational AI interview.

#### 3.5.1 Interview Types
The AI interviewer supports these interview formats (configurable per campaign):

| Format | Description |
|---|---|
| **System Design Discussion** | AI presents a design problem and engages in a back-and-forth discussion about architecture, trade-offs, and scaling |
| **Technical Q&A / Problem-Solving** | AI asks technical questions and evaluates the candidate's reasoning and knowledge |
| **Behavioral / Situational** | AI asks behavioral questions (STAR format) and evaluates soft skills |
| **Code Reading & Comprehension** | AI presents code snippets on screen; candidate reads, explains, and answers questions about the code |

- Campaigns can include **one or more formats** in a single interview session
- The AI structures the interview flow across selected formats within the time window

#### 3.5.2 Real-Time Conversational AI Agent
- The interview is conducted as a **real-time video call** with the AI agent
- The AI agent **speaks** questions aloud (text-to-speech) and **listens** to the candidate's spoken responses (speech-to-text)
- The interaction is **conversational** — the AI follows up, probes deeper, asks clarifying questions, and adapts based on the candidate's responses
- The AI agent has a professional, neutral, and encouraging interviewer persona
- The AI agent is powered by **Claude Opus 4.5**

#### 3.5.3 Interview Session
- Duration: **30 to 45 minutes** (configurable per campaign)
- The session includes:
  - A brief introduction and instructions
  - Structured interview sections based on selected formats
  - A closing where the candidate can ask questions about the role
- The AI manages time allocation across sections
- The AI can display content on the candidate's screen:
  - Code snippets (with syntax highlighting)
  - System design prompts / diagrams
  - Reference materials when relevant

#### 3.5.4 Proctoring
- The candidate's **camera must be enabled** throughout the interview
- The system monitors for:
  - Candidate presence (a person visible in frame)
  - Multiple people in frame (detecting unauthorized assistance)
  - A phone or second device held in frame
  - Tab switching or window focus changes
- Proctoring violations are **flagged and timestamped** for human review
- Proctoring does not auto-terminate the interview — violations are logged for manager review
- Detection runs **locally in the agent worker** on a self-hosted object-detection model. Frames are sampled from the live track, scored in memory, and discarded — no frame is stored or sent to a third party
- Candidate looking away from the screen (gaze direction) is **out of scope**: it cannot be measured reliably enough to accuse someone

#### 3.5.5 Recording

> **Decision (2026-08-04):** The interview is **not recorded**. The requirement below is retired.
>
> Storing interview video meant keeping the largest concentration of candidate biometric data in the system, exported to third-party storage, in exchange for a review affordance that was rarely used. The camera is now live-only: the agent worker samples frames for proctoring in memory and discards them, and nothing is written to storage.
>
> The durable record of an interview is therefore the **transcript**, the **score**, and the **proctoring report** — all text, all versioned, all inspectable. The cost of this decision is real and is stated in the product: a proctoring finding can no longer be checked against footage, so the report is presented with an explicit fallibility note rather than as something a manager can go verify. That is also why the detection rules are deliberately biased toward missing incidents rather than inventing them.

- The system generates a **full transcript** of the interview, captured server-side
- Managers review the transcript alongside the score and the proctoring report as independent evidence
- **Evidence snapshots (2026-08-04):** a proctoring finding stores the single frame that triggered it, annotated with what the detector saw, so a manager can check an automated claim instead of taking it on trust. Only flagged frames are kept, and any still not tied to a confirmed incident is deleted when the report is finalized — a clean interview stores no image at all

#### 3.5.6 Interview Invitation (On-Demand)

> **Decision (2026-06-23):** The AI interview is **on-demand**, not slot-scheduled. The AI interviewer is available 24/7, so there is no second party's calendar to coordinate against — calendar-style scheduling is reserved for the **final human interview** (3.8). This supersedes the earlier "self-schedule against AI interview availability" design. Capacity and cost are managed by a **concurrency cap** on simultaneous realtime sessions, not by candidate-facing time slots.

- Once a candidate passes the screening questions stage, the system **invites** them to take the AI interview
- Candidates receive an **email** with a link to start the interview and the **interview preparation guide** (see 3.9.2)
- The invitation link carries a **deadline** (e.g., 7 days). The candidate starts whenever they are ready within that window — there is no slot to book
- Before the session starts, a **readiness check** confirms desktop + camera/mic (the session is desktop-only, see 3.9.4)
- **Reminder emails** are sent as the deadline approaches (e.g., 3 days and 1 day before expiry); each reminder includes the prep guide link
- If the candidate does not complete the interview before the deadline, see No-Show / Expiry Handling (3.12.5)

#### 3.5.7 Interview Scoring
- After the interview, the AI produces:
  - **Per-section scores** (system design, technical Q&A, behavioral, code reading — whichever were included)
  - **Overall interview score** (independent from previous stage scores)
  - **Detailed written evaluation** covering:
    - Technical depth and accuracy
    - Communication and clarity
    - Problem-solving approach
    - Code comprehension ability
    - Cultural / behavioral indicators
  - **Strengths and concerns** summary
  - **Proctoring report** with any flagged incidents
- All score dimensions link to specific **transcript moments and timestamps** as evidence (see 3.10.2)

#### 3.5.8 Interviewer Personality Calibration
Hiring managers can configure the AI interviewer's conversational style per campaign to match the role's demands:

| Mode | Behavior | Best For |
|---|---|---|
| **Pressure** | Pushback on answers, time pressure, stress-testing assumptions, devil's advocate follow-ups | Senior/leadership roles, high-stakes positions |
| **Collaborative** | Hints when stuck, encouraging tone, pair-problem-solving approach | Junior roles, team-fit-focused hiring |
| **Socratic** | Deep probing, "why" chains, challenging assumptions, asking candidates to defend trade-offs | Staff/principal engineers, architect roles |
| **Neutral** (default) | Professional, balanced, standard follow-ups | General-purpose, most campaigns |

- Managers select a mode during campaign setup (can be changed before interviews start)
- The AI adapts its tone, follow-up depth, and level of challenge accordingly
- The selected mode is logged in the audit trail so scoring context is preserved

#### 3.5.9 Smart Difficulty Adaptation
During the AI interview, difficulty **dynamically adjusts** based on real-time candidate performance:

- If a candidate answers correctly and with depth → the AI escalates to harder variants, edge cases, and deeper probing
- If a candidate struggles → the AI pivots to a simpler variant to find their **skill ceiling**, not just their floor
- The system produces a **skill ceiling map** per interview section showing exactly where the candidate's knowledge breaks down
- Adaptation decisions are logged per question (what difficulty was selected and why) for scoring transparency
- Managers can view the difficulty trajectory alongside scores to understand whether a high score came from easy or hard questions

This provides far richer signal than fixed-difficulty interviews and normalizes scoring across candidates of varying levels.

#### 3.5.10 Multi-Language Real-Time Interview
The AI interviewer can conduct interviews in the **candidate's preferred language** while producing standardized outputs for managers:

- Candidates select their preferred language when scheduling the interview
- The AI conducts the full conversation in the selected language (speech-to-text and text-to-speech in that language)
- The system generates:
  - **Original language transcript** (verbatim)
  - **English translation transcript** (for manager review)
  - **Scores and evaluations in English** (regardless of interview language)
- Managers review everything in English — language is no longer a barrier or bias factor
- Supported languages are configurable and expandable (initial target: top 10 languages by hiring volume)
- The interview language is recorded in the audit trail

#### 3.5.11 Live Skill Simulation Environments
Beyond traditional Q&A, the AI interviewer can drop candidates into **realistic work scenarios** within the interview session:

| Simulation Type | Description | Best For |
|---|---|---|
| **Incident Response** | "Production is down. Here are the logs and metrics." The AI plays an on-call engineer feeding real-time updates as the candidate triages. | SRE, DevOps, backend engineers |
| **PR Review** | AI presents a pull request with subtle bugs, anti-patterns, and design issues. Candidate reviews it live and the AI discusses their findings. | All engineering roles |
| **Architecture Whiteboard** | Shared canvas where the candidate draws system diagrams. The AI asks questions about their design choices in real time. | Senior engineers, architects |
| **Data Analysis** | Candidate receives a dataset and a business question. They walk through their analysis approach while the AI probes methodology. | Data roles, analysts, product managers |
| **Stakeholder Negotiation** | AI role-plays a difficult stakeholder (e.g., PM pushing for a shortcut). Candidate must navigate the conversation. | Engineering managers, tech leads |

- Simulations are selected per campaign alongside interview formats (3.5.1)
- Each simulation has configurable complexity levels (tied to the difficulty adaptation system in 3.5.9)
- Simulation performance is scored against dedicated rubric dimensions
- The shared canvas / code display uses the existing screen-sharing infrastructure (3.5.3)

---

### 3.6 Manager Review & Follow-Up

#### 3.6.1 Manager Dashboard
- Displays a **ranked list of candidates** per campaign, sortable by:
  - Resume screening score
  - Screening questions score
  - AI interview score
  - Any combination / custom sort
- For each candidate, the manager can view:
  - All stage scores (independent)
  - AI-generated summaries for each stage
  - Full screening question video responses
  - Full interview transcript (the interview itself is not recorded — see 3.5.5)
  - Proctoring report
  - Parsed resume and original document

#### 3.6.2 Manager Actions
- **Add notes / feedback** on any candidate at any stage
- **Advance** a candidate to the final interview stage
- **Reject** a candidate (with optional rejection reason)
- **Add to talent pool** — mark a candidate as a silver medalist for future roles (see 3.11)
- **Flag** a candidate for further review by another team member
- **Compare** candidates side-by-side with per-factor score breakdowns (see 3.10.3)
- **Bulk actions** on multiple selected candidates (see 3.12.1)

#### 3.6.3 Collaboration
- Multiple managers/reviewers can be assigned to a campaign
- Each can leave independent notes and ratings
- Activity log tracks all actions taken on a candidate

#### 3.6.4 Interview Intelligence Replay with AI Commentary
For recorded interviews, managers get an **AI-annotated review experience**:

- **AI commentary track** — overlaid annotations while watching the recording: "Strong answer — candidate demonstrated distributed systems knowledge", "Missed opportunity — didn't address failure handling", "Red flag — contradicted earlier statement about experience"
- **Timestamp markers** for key moments: breakthroughs, struggles, red flags, and high-confidence answers
- **Speed review mode** — AI generates a **5-minute highlight reel** of a 30-45 minute interview, showing only the most important moments with context
- **Searchable transcript** — managers can search the transcript for keywords (e.g., "Kafka", "leadership") and jump to those moments
- **Side-by-side view** — transcript + video + AI annotations displayed together, scrollable and clickable
- Saves managers hours of review time per candidate

---

### 3.7 AI Decision Audit Trail

Every AI-driven decision in the system must be fully logged for compliance, debugging, and continuous improvement.

#### 3.7.1 What Is Logged
For every AI action on every candidate at every stage, the system records:

| Field | Description |
|---|---|
| **Timestamp** | When the AI decision was made |
| **Stage** | Which pipeline stage (resume screening, answer scoring, interview scoring) |
| **Candidate ID** | The candidate being evaluated |
| **Campaign ID** | The campaign context |
| **Input data snapshot** | What data the AI received (e.g., parsed resume fields, transcribed response text, interview transcript segment) |
| **Criteria / rubric used** | The exact screening criteria or rubric version applied |
| **Model & version** | The AI model identifier and version used (e.g., Claude Opus 4.5, specific API version) |
| **Prompt / system instructions** | The full prompt or system instructions sent to the AI (versioned) |
| **Raw AI output** | The complete unedited response from the AI |
| **Parsed score** | The extracted numeric score(s) |
| **Rationale** | The AI-generated explanation for the decision |
| **Decision / action taken** | The resulting action (e.g., advanced, rejected, flagged for review) |
| **Automation mode** | Whether the decision was auto-executed or queued for human review |

#### 3.7.2 Human Override Logging
When a manager overrides an AI recommendation (e.g., advances a candidate the AI rejected, or rejects a candidate the AI approved):

- The override is recorded with the original AI decision and the manager's action
- The manager must provide a **written rationale** for the override
- Override history is visible on the candidate's profile
- Overrides are tracked in aggregate for calibration (see 3.7.4)

#### 3.7.3 Audit Log Access & Retention
- Audit logs are **append-only** — entries cannot be modified or deleted
- Accessible to admin users via a dedicated **Audit Log** view in the dashboard
- Filterable by: candidate, campaign, stage, date range, decision type, override status
- Exportable as CSV/JSON for external compliance audits
- Retention period: configurable, minimum **3 years** (to satisfy regulatory requirements across jurisdictions)

#### 3.7.4 Calibration & Drift Monitoring
- The system tracks AI scoring patterns over time to detect drift (e.g., scores trending higher or lower without criteria changes)
- Aggregate statistics are available: average score by stage, score distribution per campaign, override rate
- When the AI model or prompt is updated, the system logs the version change and flags it in the audit trail so before/after comparisons are possible

---

### 3.8 Final Interview Scheduling

#### 3.8.1 Calendar Integration
- Integrates with **Google Calendar**
- Managers select available time slots from their calendar or manually specify availability
- The system finds overlapping availability between the manager and the candidate

#### 3.8.2 Scheduling Flow
- Manager triggers "Schedule Final Interview" for a candidate
- Candidate receives an **email** with available time slots (based on manager availability from Google Calendar)
- Candidate self-selects a slot
- A **Google Calendar event** is created for both the manager and the candidate
- The event includes:
  - Candidate profile summary
  - AI interview highlights and scores
  - Any manager notes
  - Meeting link (Google Meet or configured video platform)
- **Reminder emails** are sent to both parties

---

### 3.9 Candidate Experience

All candidate-facing surfaces must provide a professional, supportive experience. Candidates interacting with an AI-driven hiring system for the first time need clarity, preparation, and constructive communication at every touchpoint.

#### 3.9.1 Constructive Rejection Emails
- When a candidate is rejected at any stage, the system generates an **AI-personalized rejection email** (not a generic template)
- The email includes:
  - A respectful, professional tone acknowledging the candidate's effort
  - **Specific, constructive feedback** on areas for improvement (e.g., "Strengthening experience with distributed systems would make you a stronger fit for similar roles")
  - The feedback is derived from the AI's evaluation rationale at the relevant stage
  - Encouragement to apply for future roles where appropriate
- Hiring managers can **review and edit** the AI-generated rejection email before it is sent (optional — can be set to auto-send per campaign)
- Feedback specificity is configurable: managers can choose between high-level feedback (general areas) or detailed feedback (specific skill gaps) per campaign
- Rejection emails never reveal exact scores or internal ranking

#### 3.9.2 Interview Preparation Resources
When a candidate is scheduled for an AI interview, they receive a **preparation guide** that includes:
- **What to expect** — explanation that the interview is conducted by an AI agent via a video call
- **Interview format** — which sections are included (system design, technical Q&A, behavioral, code reading) and approximate time per section
- **Total duration** — how long the session will last
- **Technical requirements** — browser, camera, microphone, and internet speed requirements
- **Tips** — general advice (e.g., "Think aloud so the AI can follow your reasoning", "Ask clarifying questions just like you would with a human interviewer", "You can ask the AI to repeat or rephrase a question")
- **Proctoring expectations** — clear explanation that the camera must remain on, what is monitored, and why
- **Sample question** — one example question per included format so the candidate knows the style (not an actual interview question)
- The preparation guide is accessible via a **unique link** included in the interview confirmation and reminder emails
- The guide is a web page (not a PDF) so it can be updated per campaign

#### 3.9.3 Mobile Responsiveness
All candidate-facing pages must be **fully responsive and mobile-optimized** from V1:
- **Screening question form** — video/audio recording, playback, and submission must work on mobile browsers (iOS Safari, Android Chrome)
- **Interview preparation guide** — readable and navigable on mobile
- **Scheduling pages** — time slot selection must be touch-friendly
- **Emails** — all transactional emails use responsive HTML templates
- The **AI interview session itself** is desktop-only (due to camera/proctoring requirements) — candidates attempting to join from mobile are shown a clear message directing them to use a desktop/laptop

---

### 3.10 Scoring Transparency & Explainability

All AI-generated scores must be transparent, traceable, and understandable by hiring managers. Opaque scores erode trust and create compliance risk.

#### 3.10.1 Granular Score Attribution
Every AI score at every stage includes a **factor-level breakdown** showing which specific inputs influenced the score and by how much:

- **Resume screening example:**
  - Python experience (5 years) → +18
  - AWS certification → +12
  - No distributed systems experience → -10
  - PhD in Computer Science → +8
  - Overall: 78/100
- **Interview scoring example:**
  - System design: correctly identified trade-offs between consistency and availability → +15
  - Technical Q&A: incomplete understanding of database indexing → -8
  - Behavioral: strong STAR-format response on conflict resolution → +12

Each factor shows:
- The **input data point** (what the AI observed)
- The **rubric dimension** it maps to
- The **directional impact** (positive or negative contribution to the score)
- The **weight** of that dimension in the overall score

#### 3.10.2 Transcript-to-Score Linkage
For interview scoring, each score dimension is linked to **specific transcript moments** that justify it:
- Managers can click on a score dimension (e.g., "Problem-solving approach: 7/10") and jump directly to the transcript excerpt(s) and recording timestamp(s) that the AI used as evidence
- This applies to both the AI interview (3.5.7) and screening question answer scoring (3.4.4)
- Evidence excerpts are displayed alongside the score so managers can verify the AI's reasoning without watching the full recording

#### 3.10.3 Score Comparison View
- When comparing candidates side-by-side (3.6.2), scores are broken down by the same dimensions so managers can compare on a per-factor basis
- For the same campaign, all candidates are scored against the **same rubric version** — if the rubric is updated mid-campaign, the system flags which candidates were scored under which version

#### 3.10.4 Scoring Methodology Documentation
- Each campaign's scoring approach is documented automatically: which rubric was used, what criteria were active, what weights were applied, and what AI model/prompt version generated the scores
- This documentation is accessible from the campaign settings and is included in audit log exports (see 3.7)
- When a manager or the system updates the rubric, the previous version is archived and the change is logged

---

### 3.11 Silver-Medalist Talent Pool

Not every strong candidate will be selected for the current role. The system maintains a **talent pool** of promising candidates for future campaigns.

#### 3.11.1 Adding Candidates to the Talent Pool
- At any stage, a manager can mark a candidate as a **silver medalist** instead of rejecting them outright
- When rejecting a candidate, the system prompts: "Add to talent pool for future roles?" (opt-in per candidate)
- Candidates added to the talent pool retain:
  - Their full profile (parsed resume, all stage scores, AI summaries, interview recordings)
  - Manager notes and tags
  - The campaign they were originally evaluated for
  - A **talent pool tag** (e.g., "Strong backend engineer", "Great communicator, needs more experience")

#### 3.11.2 Talent Pool Management
- The talent pool is a **global view** accessible from the main dashboard (not tied to a single campaign)
- Managers can **search and filter** the talent pool by:
  - Skills / technologies
  - Role type / department
  - Score ranges (from any stage)
  - Tags and notes
  - Date added
  - Original campaign
- Managers can **add candidates from the talent pool to a new campaign**, skipping the resume collection stage
  - The system carries forward their existing profile and historical scores
  - The candidate enters the new campaign at the screening stage (or a stage the manager selects)
  - Previous scores are shown as historical context but do **not** replace new evaluations for the new campaign

#### 3.11.3 Talent Pool Notifications
- When a new campaign is created, the system **suggests matching talent pool candidates** based on the job description and criteria
- Managers can review suggestions and add them to the new campaign with one click

#### 3.11.4 Candidate Communication
- Candidates added to the talent pool receive a **warm rejection email** (distinct from standard rejection) that:
  - Thanks them and acknowledges their strengths
  - Informs them that they are being considered for future opportunities
  - Does not make binding promises about future contact
- When a talent pool candidate is added to a new campaign, they receive an email inviting them to the new role

#### 3.11.5 Data Retention
- Talent pool candidates follow the same data retention policies as active candidates (see 7.2)
- Candidates can request removal from the talent pool via the right-to-deletion mechanism
- Stale talent pool entries (configurable, e.g., >12 months with no activity) are flagged for review and optional archival

---

### 3.12 Operational Workflow Features

At thousands of candidates per campaign, individual actions do not scale. The system provides workflow automation and bulk operations for efficient pipeline management.

#### 3.12.1 Bulk Actions
Managers can select multiple candidates and perform actions in batch:

| Action | Description |
|---|---|
| **Bulk advance** | Move selected candidates to the next pipeline stage |
| **Bulk reject** | Reject selected candidates (with AI-personalized rejection emails generated for each) |
| **Bulk email** | Send a custom email to selected candidates |
| **Bulk add to talent pool** | Add selected candidates to the silver-medalist pool |
| **Bulk tag** | Apply tags to selected candidates |
| **Bulk assign reviewer** | Assign a manager/reviewer to selected candidates |

- Bulk actions require a **confirmation step** showing the count and action before execution
- Bulk actions are logged in the activity log with the full list of affected candidates

#### 3.12.2 SLA Timers & Stage Alerts
- Configurable **time limits per stage** per campaign (e.g., "Candidates should not sit in manager review for more than 3 days")
- When a candidate exceeds the stage time limit, the system:
  - Highlights the candidate in the dashboard with an **overdue indicator**
  - Sends an **in-app notification** to assigned reviewers
- The dashboard shows an **"Overdue" filter** to surface all candidates past their SLA
- SLA timers are optional and configured per campaign

#### 3.12.3 Campaign Cloning
- Managers can **clone an existing campaign** to create a new one with pre-filled configuration:
  - Job description
  - Screening criteria
  - Evaluation rubrics
  - Interview format settings
  - Email templates
  - SLA timers
  - Automation settings (thresholds, human-in-the-loop toggle)
- The cloned campaign is created in **draft** status for the manager to review and modify before activating
- Cloning does not copy candidates — only configuration

#### 3.12.4 Auto-Archiving
- Candidates who do not respond to screening questions within a **configurable window** (e.g., 7 days after reminder) are automatically moved to an **archived** status
- Candidates who do not select an interview slot within a configurable window are also auto-archived
- Archived candidates:
  - Are removed from the active pipeline view (but still accessible via filters)
  - Are not counted in active candidate metrics
  - Can be **manually un-archived** by a manager if the candidate re-engages
- Auto-archiving triggers are logged in the activity log

#### 3.12.5 No-Show / Expiry Handling
When a candidate does not complete their AI interview before the invitation deadline (or abandons a started session):
- The system marks the application as a **no-show / expired** failure state
- A **notification** is sent to the assigned manager
- The system automatically sends the candidate a **reminder email** with a refreshed link and an extended deadline (up to a configurable maximum number of attempts, e.g., 2)
- If the candidate still does not complete after the final reminder, they are auto-archived
- No-show / expiry history is visible on the candidate's profile

> The final **human** interview (3.8) keeps true calendar scheduling — a no-show there is a missed *appointment*, handled by the manager-availability reschedule flow, not this on-demand expiry.

#### 3.12.6 Reusable Template Library
- **Email templates** can be saved and reused across campaigns (not just per-campaign)
- **Screening question sets** can be saved as templates for common role types
- **Evaluation rubrics** can be saved and shared across campaigns
- Templates are managed in a **global template library** accessible from the admin settings
- Templates support **versioning** — when a template is updated, campaigns using the old version are not affected unless explicitly updated

---

### 3.13 Candidate Skill Fingerprint

After each pipeline stage, the system builds a **multi-dimensional skill profile** per candidate — not just scores, but a structured representation of how the candidate thinks and performs.

#### 3.13.1 Fingerprint Dimensions
The skill fingerprint captures:

| Dimension | Source | Description |
|---|---|---|
| **Technical depth vs. breadth** | Resume screening + AI interview | Radar chart showing depth in specific domains vs. range of technologies |
| **Communication clarity** | Screening questions + AI interview | How well the candidate explains complex ideas, uses structure, and adapts explanations |
| **Problem-solving pattern** | AI interview | Top-down vs. bottom-up, systematic vs. intuitive, speed vs. thoroughness |
| **Learning velocity** | AI interview (difficulty adaptation) | How quickly the candidate adapts when the AI introduces new constraints or escalates difficulty |
| **Collaboration style** | Behavioral interview + simulations | Leadership-oriented, consensus-driven, independent executor, etc. |
| **Domain expertise map** | Resume + interview | Specific technologies, methodologies, and domains with confidence levels |

#### 3.13.2 Fingerprint Usage
- Fingerprints are **searchable** in the talent pool — managers can search for candidates by trait patterns (e.g., "systems thinker with strong communication")
- When comparing candidates (3.6.2), fingerprints are displayed side-by-side as visual overlays
- Fingerprints carry forward when a talent pool candidate enters a new campaign — historical fingerprints are shown alongside new evaluations
- Fingerprints are built incrementally — each stage adds more data points, refining the profile

---

### 3.14 AI Bias Auditor

A dedicated module that continuously monitors for bias across the entire hiring pipeline. With the EU AI Act classifying AI in recruitment as **high-risk**, this feature provides a built-in compliance and fairness layer.

#### 3.14.1 Continuous Bias Monitoring
The system analyzes scoring patterns across the pipeline to detect potential bias:

- **Score distribution analysis** by demographic proxies (name origin, school tier, geographic location, education type)
- **Pass-through rate comparison** across candidate segments at each pipeline stage
- **Automated adverse impact ratio calculations** (4/5ths rule) per stage and per campaign
- **Scoring drift detection** — flagging when AI scoring patterns shift in ways that correlate with demographic factors
- All analysis uses statistical methods and anonymized aggregate data — no individual candidate is profiled by demographics

#### 3.14.2 Criteria Impact Analysis
- **Sensitivity analysis** — "If we remove the AWS certification requirement, how does the qualified candidate pool change?"
- **Correlation warnings** — flags when screening criteria correlate with protected characteristics (e.g., "Requiring a specific university tier correlates with socioeconomic background")
- **What-if simulator** — managers can model changes to criteria and thresholds and see projected impact on diversity metrics before applying them

#### 3.14.3 Bias Audit Reports
- **Per-campaign bias report** generated automatically when a campaign closes
- **Organization-wide bias dashboard** showing trends across all campaigns
- **Exportable audit reports** (PDF, CSV) formatted for legal and compliance review
- Reports include methodology documentation, statistical significance levels, and recommended actions
- Bias reports are stored alongside the AI decision audit trail (3.7) for regulatory compliance

#### 3.14.4 Fairness Guardrails
- Configurable **alert thresholds** — the system notifies admins when adverse impact ratios exceed configurable limits
- Optional **pre-screening bias check** — before launching a campaign, the system analyzes the screening criteria against historical data and flags potential bias risks
- All bias auditor findings are **advisory** — the system does not auto-correct scores or override decisions, but surfaces concerns for human review

---

### 3.15 Candidate Experience Score

Measure and optimize the candidate experience across the entire pipeline.

#### 3.15.1 Micro-Surveys
- After screening questions and after the AI interview, candidates receive a **brief survey** (3 questions max):
  - Overall experience rating (1–5)
  - "Was the process clear and fair?" (yes/no + optional comment)
  - "Would you recommend this process to a friend?" (NPS)
- Surveys are optional and non-intrusive — presented on the thank-you page after submission
- Response rates are tracked per campaign

#### 3.15.2 Behavioral Signals
The system passively collects experience signals:

- **Completion rates** per stage (what % of candidates finish screening questions, show up for interviews)
- **Drop-off points** — where in the pipeline candidates abandon the process
- **Time-to-complete** per stage (how long candidates take to complete screening questions, how quickly they schedule interviews)
- **Engagement metrics** — time spent on preparation guide, re-recording rates for screening questions
- **AI sentiment analysis** on candidate tone and engagement during the AI interview (optional, configurable)

#### 3.15.3 Candidate Experience Dashboard
- **Per-campaign experience score** aggregating survey responses and behavioral signals
- **Trend view** across campaigns over time
- **Benchmarks** — compare experience scores across campaigns, departments, and role types
- **Actionable insights** — system highlights specific friction points (e.g., "Candidates are spending 3x longer than expected on question 4 — consider simplifying")
- Accessible from the manager dashboard alongside hiring metrics

---

### 3.16 Team Fit Prediction

Go beyond individual candidate scoring — predict how a candidate would complement or conflict with the existing team.

#### 3.16.1 Team Profile Input
- Managers can optionally define their **team profile** for a campaign:
  - Current team members' roles and strengths
  - Team's working style (async-heavy, meeting-heavy, pair-programming, etc.)
  - Known skill gaps the team wants to fill
  - Cultural values and communication norms
- Team profiles can be saved and reused across campaigns for the same team

#### 3.16.2 Fit Analysis
Based on the candidate's skill fingerprint (3.13) and interview data, the system generates:

- **Complementary strengths** — "This candidate's systematic approach would balance the team's bias toward quick iteration"
- **Potential friction points** — "Candidate prefers high-autonomy work; team operates with tight collaboration loops"
- **Skill gap coverage** — how well the candidate fills the team's identified gaps
- **Communication style alignment** — based on behavioral interview responses and collaboration simulation data

#### 3.16.3 Presentation
- Team fit analysis is displayed on the candidate's profile in the manager review stage
- It is clearly labeled as **advisory / AI-generated insight** — not a score or pass/fail
- Managers can dismiss or annotate the analysis
- Team fit data is included in the side-by-side comparison view (3.6.2)

---

### 3.17 Candidate Coaching Mode (Public)

A **free, public-facing practice interview** tool that serves as both a candidate preparation resource and a top-of-funnel marketing engine.

#### 3.17.1 Practice Interviews
- Candidates (anyone, not just applicants) can access a **free mock AI interview** on the platform's public site
- Practice interviews are available for common role types (software engineer, product manager, data analyst, etc.)
- The AI conducts a shortened interview (10–15 minutes) using the same conversational engine as the real interviews
- After the practice session, candidates receive:
  - **Instant feedback** on their answers (strengths, areas for improvement)
  - **Tips** for improving their interview performance
  - **A score breakdown** (less granular than real interviews — enough to be useful, not enough to game the system)

#### 3.17.2 Benefits
- **Candidate trust** — candidates who practice on the platform are less anxious and perform more authentically in real interviews
- **Marketing engine** — free tool drives organic traffic and brand awareness; practiced candidates are warmer when they enter a real campaign
- **Data flywheel** — anonymized practice session data improves the AI interviewer's question quality and scoring calibration over time
- **Employer brand** — companies using the platform can share their practice interview link in job postings ("Prepare for your interview with us")

#### 3.17.3 Guardrails
- Practice questions are **distinct from real interview questions** — the system ensures no overlap between practice content and active campaign content
- Practice sessions do not create candidate records in the ATS — they are anonymous unless the candidate opts in
- Rate-limited to prevent abuse (e.g., max 3 practice sessions per email per week)

---

### 3.18 Predictive Hiring Analytics

Use historical pipeline data to surface actionable predictions and recommendations for hiring managers.

#### 3.18.1 Campaign Predictions
When a campaign is created or in progress, the system provides:

- **Time-to-fill estimate** based on criteria tightness, historical fill rates for similar roles, and current pipeline velocity
- **Pipeline health indicators** — predicted conversion rates per stage based on historical patterns
- **Criteria sensitivity analysis** — "Relaxing the AWS requirement would increase your qualified candidate pool by an estimated 40%"
- **Sourcing channel effectiveness** — which intake channel (email, LinkedIn, campaigns) produces the highest-quality candidates for this role type

#### 3.18.2 Pipeline Bottleneck Detection
- Real-time identification of where candidates are stalling: "73% of candidates are stuck at screening questions — average completion time is 4 days vs. 1.5 day benchmark"
- **Stage velocity tracking** — time-in-stage per candidate with historical comparisons
- **Predicted drop-off** — flagging candidates likely to disengage based on response patterns
- Automated recommendations: "Consider sending a reminder email to 12 candidates who haven't completed screening questions in 3+ days"

#### 3.18.3 Continuous Improvement
- Over time, the system correlates interview scores with **post-hire outcomes** (if retention/performance data is fed back via API or manual input)
- Identifies which scoring dimensions are most predictive of on-the-job success
- Surfaces recommendations to refine rubrics and criteria based on outcome data

---

### 3.19 Automated AI Reference Checks

After the AI interview and before the final human interview, the system can automate reference checks using conversational AI.

#### 3.19.1 Reference Collection
- When a manager triggers a reference check, the candidate receives an email requesting **2–3 reference contacts** (name, email, relationship, company)
- The candidate submits references via a simple web form (token-based access, no login)

#### 3.19.2 AI-Conducted Reference Check
- Each reference receives an **email with a unique link** to a conversational AI reference check
- The reference can complete the check via:
  - **Text-based chat** (structured questions with free-text responses)
  - **Voice call** (AI conducts a 5–10 minute phone conversation via speech-to-text / text-to-speech)
- The AI asks structured questions about the candidate:
  - Working relationship and duration
  - Key strengths and areas for growth
  - Specific examples of performance
  - Would they hire/work with this person again
- Questions are **adapted based on the candidate's interview performance** — the AI probes areas where the candidate scored lower or made specific claims

#### 3.19.3 Reference Report
- The system produces a **summarized reference report** per candidate:
  - Key quotes from each reference (attributed)
  - Consistency analysis — cross-referencing reference statements with the candidate's interview claims
  - Overall reference sentiment (positive / mixed / concerning)
  - Flagged discrepancies between candidate claims and reference input
- The report is available on the candidate's profile in the manager review stage
- All reference data is logged in the audit trail

#### 3.19.4 Privacy & Consent
- References are informed upfront that they are interacting with an AI system
- References can opt out and request a human-conducted check instead
- Reference data is subject to the same retention and deletion policies as candidate data (see 7.2)

---

## 4. Email System

### 4.1 Transactional Emails
The system sends automated emails at key pipeline stages:

| Trigger | Recipient | Content |
|---|---|---|
| Resume received | Candidate | Acknowledgment of application |
| Screening rejection | Candidate | AI-personalized rejection with constructive feedback (see 3.9.1) |
| Screening questions ready | Candidate | Link to screening form |
| Screening questions reminder | Candidate | Reminder if not completed within X days |
| Interview invitation | Candidate | Available time slots for AI interview |
| Interview confirmation | Candidate | Confirmed date/time + interview link + preparation guide link (see 3.9.2) |
| Interview reminders | Candidate | 24h and 1h before interview + preparation guide link |
| Final interview invitation | Candidate | Available time slots for manager interview |
| Reference request | Candidate | Request for reference contacts (after AI interview, before final) |
| Reference check invitation | Reference contact | Unique link to AI-conducted reference check |
| Final interview confirmation | Candidate + Manager | Confirmed date/time + meeting link |

### 4.2 Email Configuration
- Configurable sender name and email address
- Customizable email templates per campaign (with variable substitution: candidate name, role, dates, links, etc.)
- Email provider integration for reliable delivery

---

## 5. Notifications & Alerts (Admin Side)

- New candidate received notification
- Screening complete — candidates ready for review (when human-in-the-loop is enabled)
- Screening questions submitted by candidate
- AI interview completed — results ready
- Proctoring violation alert
- Candidate no-show for scheduled interview
- Final interview scheduled confirmation
- Bias audit alert — adverse impact ratio exceeds configured threshold
- Reference check completed — report ready for review
- Pipeline bottleneck alert — candidates stalling at a stage beyond expected SLA
- Candidate experience alert — experience score drops below configured threshold

Notifications are delivered via the **in-app dashboard**. Email notifications to managers are a future enhancement.

---

## 6. Data Model — Key Entities

| Entity | Description |
|---|---|
| **Campaign** | A hiring campaign for a specific role |
| **Candidate** | A person applying, with profile data parsed from resume |
| **Resume** | The uploaded resume file + parsed structured data |
| **Screening Criteria** | Per-campaign criteria for AI screening |
| **Screening Result** | AI screening score + rationale per candidate |
| **Screening Question Set** | AI-generated questions for a campaign |
| **Screening Response** | Video/audio response from a candidate |
| **Screening Response Score** | AI evaluation of a screening response |
| **Interview Session** | A scheduled/completed AI interview |
| **Interview Recording** | Video/audio/transcript of an interview |
| **Interview Score** | AI evaluation of interview performance |
| **Proctoring Event** | A flagged proctoring incident with timestamp |
| **Evaluation Rubric** | Scoring rubric per campaign/stage |
| **Manager Note** | Notes/feedback left by a manager on a candidate |
| **Final Interview** | Scheduled human interview with calendar event |
| **AI Audit Log** | Immutable record of every AI decision — input data, model/prompt version, raw output, score, rationale, and resulting action |
| **Human Override** | Record of a manager overriding an AI decision, with the original decision and manager rationale |
| **Score Factor** | Individual factor within a score — input data point, rubric dimension, impact value, and weight |
| **Transcript Evidence** | Link between a score dimension and specific transcript excerpt(s) / recording timestamp(s) |
| **Talent Pool Entry** | A silver-medalist candidate record — references the candidate, original campaign, tags, and manager notes |
| **Template** | Reusable configuration template (email, screening questions, or rubric) with version history |
| **SLA Configuration** | Per-campaign stage time limits and alert settings |
| **Email Log** | Record of all emails sent |
| **User** | Admin / hiring manager account |
| **Interviewer Persona** | Per-campaign AI interviewer configuration — mode (pressure, collaborative, socratic, neutral) and behavioral parameters |
| **Difficulty Log** | Per-question record of difficulty level selected during AI interview, adaptation reason, and candidate performance at that level |
| **Skill Fingerprint** | Multi-dimensional candidate profile — technical depth/breadth, communication, problem-solving pattern, learning velocity, collaboration style, domain map |
| **Bias Audit Report** | Per-campaign and org-wide bias analysis — score distributions, adverse impact ratios, criteria correlations, and recommendations |
| **Candidate Experience Survey** | Post-stage micro-survey responses (rating, fairness, NPS) and behavioral engagement signals |
| **Team Profile** | Per-team configuration for fit prediction — members, working style, skill gaps, cultural values |
| **Team Fit Analysis** | AI-generated team fit prediction per candidate — complementary strengths, friction points, gap coverage |
| **Practice Session** | Anonymous mock interview session from the public coaching tool — questions, responses, feedback (no PII unless opted in) |
| **Pipeline Prediction** | AI-generated campaign predictions — time-to-fill estimate, bottleneck alerts, criteria sensitivity analysis |
| **Reference Check** | Reference contact records, AI conversation transcripts, summarized reference report, and consistency analysis |
| **Simulation Session** | Live skill simulation data — scenario type, candidate actions, AI responses, and simulation-specific scoring |

---

## 7. Non-Functional Requirements

### 7.1 Performance
- Resume parsing should complete within 30 seconds
- AI screening should complete within 60 seconds per candidate
- The AI interview must maintain low-latency real-time audio (<500ms round-trip for speech)
- The dashboard should load candidate lists within 2 seconds for up to 5,000 candidates

### 7.2 Security
- All data encrypted at rest and in transit
- Token-based access for candidate-facing pages (no candidate accounts)
- Role-based access control for admin users
- Video recordings stored with access controls
- GDPR-aware data handling (candidate data retention policies, right to deletion)

### 7.3 Reliability
- Interview sessions must be resilient to brief network interruptions (auto-reconnect)
- All candidate communications are logged
- Failed email delivery triggers retry with backoff

### 7.4 Scalability
- Support thousands of candidates per campaign
- Support multiple concurrent AI interview sessions
- Media storage (video recordings) must scale with candidate volume

---

## 8. Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js (React) |
| **Backend / API** | Next.js API routes + Supabase |
| **Database** | Supabase (PostgreSQL) |
| **Authentication** | Supabase Auth |
| **AI Engine** | Claude Opus 4.5 (Anthropic) |
| **Speech-to-Text** | TBD (e.g., Deepgram, Whisper, Google STT) |
| **Text-to-Speech** | TBD (e.g., ElevenLabs, Google TTS) |
| **Real-Time Communication** | TBD (e.g., LiveKit, Daily.co, Twilio) |
| **File Storage** | Supabase Storage (resumes, recordings) |
| **Email Provider** | TBD (e.g., Resend, Postmark, SendGrid) |
| **Calendar Integration** | Google Calendar API |
| **Hosting** | Hetzner Cloud |
| **CI/CD** | TBD |

---

## 9. Out of Scope (V1)

The following are explicitly **not** in scope for the initial version:

- Candidate self-service portal / accounts
- Live coding environment (in-browser IDE)
- Multi-company / SaaS mode
- Slack or other messaging integrations
- Mobile app
- Composite scoring across stages
- Automated job board posting
- Offer letter generation
- Background check integration
- Onboarding workflow
- Analytics / reporting dashboards (beyond the manager dashboard)
- Candidate-facing status tracker

---

## 10. Future Enhancements (Post-V1)

- Live coding interview support (in-browser IDE with execution)
- Candidate self-service portal with application status tracking
- Slack notifications for managers
- Advanced analytics and hiring funnel reporting (partially addressed by 3.18 Predictive Hiring Analytics)
- AI-generated offer letters
- Job board auto-posting (LinkedIn, Indeed, etc.)
- Bulk candidate import from CSV/Excel
- API-first architecture — expose internal services as documented APIs for third-party integrations and future extensibility
- Basic analytics dashboard — hiring funnel conversion rates (applied → screened → interviewed → offered), source quality tracking (which channel produces the best candidates), and time-in-stage metrics for bottleneck detection
- Proctoring enhancements — AI-generated answer detection (detecting if a candidate is reading from ChatGPT), proctoring severity levels (minor vs. major violations), and secure browser lockdown mode
- Cross-stage debrief — a single AI-generated document summarizing a candidate's performance across all pipeline stages, suitable for sharing with a hiring committee before the final interview
