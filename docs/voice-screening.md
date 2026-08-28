# Voice Screening (OpenAI Realtime) — Design & Threat Model

Status: **shipped** (#80–#85). The text screening form was deleted outright in
#161 — there is no typed-answer path left and no env flag re-enables one.

> **Two decisions below were later reversed. The threat model was not.**
>
> - **Transport: LiveKit, not a direct browser WebRTC connection.** The
>   "No LiveKit for screening" call under *Decision* no longer holds. Screening
>   now opens a per-attempt LiveKit room server-side and dispatches an agent
>   worker into it (`agents/screening/`). The reason is the one this document
>   argued *for* elsewhere: the candidate's browser must not be the source of
>   the transcript. With a direct browser connection it was. Now the worker
>   reports the transcript server-to-server and the browser's submit carries
>   only the token.
> - **Recording was retired** on 2026-08-04 for the AI interview, so "video +
>   recording + proctoring" no longer describes what LiveKit is there for.
>   Proctoring stayed; recording did not.
>
> - **Mitigation #2 was broken for as long as instructions rode room metadata,
>   and was fixed on 2026-08-24.** LiveKit delivers room metadata to every
>   participant, so "questions never shown in advance" was not true: the
>   candidate's browser received the whole topic guide on join. The worker now
>   fetches its instructions from `GET /api/agent/screening/instructions`
>   (guarded by `AGENT_API_SECRET`) and metadata carries the application id
>   alone. See CLAUDE.md → "Room metadata is candidate-visible".
>
> - **Mitigation #1 now has a budget, and coverage is enforced in code
>   (2026-08-24).** "1–2 unscripted probes per answer" was written before the
>   question set was sized from the rubric (3–8 topics), and a probe on every
>   one of eight topics does not fit the call. The allowance is now counted:
>   two probes at ≤4 topics, one above, after which the topic is left and the
>   call moves on. More importantly, whether a topic gets raised at all is no
>   longer the model's own affair — the app keeps a topic ledger and the
>   interviewer cannot end the call while anything is unasked. See CLAUDE.md →
>   "Topic coverage is enforced at runtime".
>
> Everything from *Threat model* onward is still the live rationale — it is why
> the unscripted follow-up exists, and it has not changed.
> Current behaviour: CLAUDE.md → PRD 3.4.3 and the proctoring section.

## Decision

- **Screening = a short, voice-only AI Q&A**, delivered live by **OpenAI
  Realtime** (speech-to-speech) over a direct browser WebRTC connection.
  *(Superseded — see the note above: the transport is LiveKit + an agent worker.)*
- **No LiveKit** for screening. OpenAI Realtime does not require it; LiveKit is
  only needed for **video + recording + proctoring**, which belong to the
  separate **AI interview** stage (#29), not the cheap screening filter.
  *(Superseded — see the note above.)*
- Layered anti-gaming: screening is cheat-**resistant** (filters most gaming);
  the proctored A/V interview (#29 + #41) is the cheat-**hard** gate.

## Threat model — "people will read off a script / ChatGPT"

| Method | Text form | Voice (static Qs) | Voice + dynamic follow-ups |
| --- | --- | --- | --- |
| Copy-paste from ChatGPT | trivial | blocked | blocked |
| Read a pre-written answer aloud | — | possible | collapses under probing |
| Real-time ChatGPT on 2nd screen | — | possible | hard but possible |
| Off-screen help / someone else | — | invisible | needs video (interview) |

### Mitigations (all available voice-only)

1. **Un-scriptable follow-ups (primary defense).** The Realtime agent listens
   and asks 1–2 unscripted probes per answer. A prepared script survives the
   first question and dies on the second.
2. **Questions never shown in advance** — delivered live by voice only.
3. **Resume-anchored probes** — "walk me through project X on your CV" — can't
   be pre-generated generically.
4. **Latency / cadence signal** — reading off a second screen creates long
   pre-answer pauses and flat delivery; the transcript carries timing, scored
   as a soft "reads-as-scripted" signal (a nudge, never proof).
5. **Score specificity, not eloquence** — the rubric rewards concrete lived
   detail; fluently-read generic AI prose scores low.

What voice **cannot** catch (second screen, off-screen help) is deferred to the
proctored video interview by design — do not over-engineer the cheap stage.

## Architecture (no agent worker, no rooms, no egress)

1. **Ephemeral token** — `POST /api/realtime/token` mints a short-lived OpenAI
   Realtime session key, gated by the candidate's `respond/[token]` session.
2. **Browser voice client** — `respond/[token]` opens a WebRTC mic connection
   straight to OpenAI Realtime; shows listening/speaking state. Mobile-friendly.
3. **Session instructions** — campaign screening questions fed as *goals*, with
   an explicit instruction to ask unscripted follow-ups and anchor one question
   to the resume.
4. **Transcript capture + persist** — Realtime emits a transcript; store on
   `screening_question_responses` (+ optional audio via browser MediaRecorder →
   Supabase Storage).
5. **Score** — existing pipeline unchanged: transcript → AI scores vs rubric →
   evidence → `evaluateScreeningScoringOutcome` → `transitionApplication()`.

The scoring/decision machinery (Control > AI > Data) is unchanged — only the
input modality changes from typed text to a voice transcript.

## State machine (already legal — no new states)

```
screening_approved → screening_sent       (session link issued)
screening_sent     → screening_completed  (candidate finished the voice session)
screening_completed→ screening_scored     (transcript scored → rule decides)
                   → screening_expired     (never joined before deadline)
                   → processing_failed     (Realtime/transcript error — explicit)
```

## Tracer-bullet slices (in order)

1. **Token route + bare voice connection** — candidate connects mic to Realtime,
   hears a hardcoded prompt, sees state. Proves token mint + WebRTC.
2. **Screening script + follow-ups** — feed campaign questions as goals; agent
   runs the Q&A with unscripted probes.
3. **Transcript persist + transition** — store transcript, fire
   `screening_completed`; `screening_expired` on no-show, `processing_failed` on
   error.
4. **Score the transcript** — wire to the existing screening scoring + rule
   layer → `screening_scored`.
5. **Polish** — re-record/retry, deadline handling, recruiter transcript review.

Text screening stays behind a flag as fallback until the voice path passes QA.

## New env / ops

- `OPENAI_API_KEY` (exists) — used to mint ephemeral Realtime keys server-side.
- OpenAI Realtime is billed per minute of audio — keep screening short. The call length is `screeningCallMinutes(topicCount)` (5-10 min), not a flat five; see CLAUDE.md.
- No new long-running service (unlike the LiveKit interview backbone).
