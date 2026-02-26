# Screenr AI

**Internal ATS & AI Interview Platform**

Screenr AI is an internal Applicant Tracking System (ATS) and AI-powered interview platform that automates the full hiring pipeline — from resume collection through AI-conducted interviews to final interview scheduling.

## Hiring Pipeline

```
Resume Collection → AI Screening → Filtering → Screening Questions →
Answer Scoring → AI Interview Scheduling → AI Interview →
Interview Scoring → AI Reference Check (optional) → Manager Review →
Final Interview Scheduling
```

## Core Features

- **Campaign Management** — Create hiring campaigns per role with custom screening criteria and AI-suggested evaluation rubrics
- **Resume Parsing & AI Screening** — Automated extraction and scoring of resumes (PDF/DOCX) against campaign criteria
- **Screening Questions** — AI-generated questions delivered via email; candidates respond with video/audio recordings
- **AI Technical Interview** — Real-time conversational AI interview (video call) with adaptive difficulty, proctoring, and multi-language support
- **Live Skill Simulations** — Incident response, PR review, architecture whiteboard, data analysis, and stakeholder negotiation scenarios
- **Scoring & Transparency** — Every AI score includes factor-level breakdowns with transcript-to-score linkage
- **Manager Dashboard** — Ranked candidate lists, side-by-side comparisons, interview replay with AI commentary and highlight reels
- **AI Bias Auditor** — Continuous bias monitoring, adverse impact calculations, and criteria sensitivity analysis (EU AI Act compliant)
- **Talent Pool** — Silver-medalist candidates retained for future campaigns with skill fingerprinting
- **Automated Reference Checks** — AI-conducted reference checks via text chat or voice call
- **Candidate Coaching Mode** — Free public practice interviews for candidate preparation and top-of-funnel marketing
- **Predictive Analytics** — Time-to-fill estimates, pipeline bottleneck detection, and criteria sensitivity analysis

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (React) |
| Backend / API | Next.js API Routes + Supabase |
| Database | Supabase (PostgreSQL) |
| Authentication | Supabase Auth |
| AI Engine | Claude Opus 4.5 (Anthropic) |
| File Storage | Supabase Storage |
| Hosting | Hetzner Cloud |
| Calendar | Google Calendar API |

## Documentation

- [Product Requirements (PRD)](docs/prd.md)
- [Intern Onboarding Guide](docs/onboarding.md)

## License

Private — MatiousCorp internal use only.
