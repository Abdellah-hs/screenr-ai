# Interview agent worker

The server-side interviewer for the on-demand AI **video** interview. It is a
**separate process** from the Next.js app (forked from `agents/screening/`):
LiveKit dispatches it into every `interview-*` room the app creates, it
**fetches its interviewer instructions** from the app's
`/api/agent/interview/instructions` route, runs the conversation over OpenAI
Realtime, and POSTs the transcript to `/api/agent/interview/transcript` as the
interview progresses.

> **The instructions are fetched, not read off the room.** They used to travel
> in LiveKit room metadata, which LiveKit delivers to *every* participant — so
> the candidate's browser received the condensed copy of their résumé and the
> campaign's interviewing stance on join. Metadata now carries the application
> id alone. `SCREENR_APP_ORIGIN` and `AGENT_API_SECRET` are therefore required
> to run an interview at all, and this worker must be **restarted before the
> app is deployed** (it falls back to metadata, so a new worker runs against
> either version of the app; an old worker does not).

The candidate joins with camera + mic. This worker drives the spoken
conversation *and* watches the camera for proctoring — two jobs that are
deliberately kept apart (see below).

It produces **evidence only** — it never advances application state. The
candidate's explicit submit on the review step (and the app's rules) do that.

## Run locally

```bash
cd agents/interview
pnpm install
cp .env.example .env   # fill in the values (same LiveKit/OpenAI project as screening)
pnpm dev               # connects to LiveKit Cloud and waits for interview-* rooms
```

Keep it running in its own terminal next to `pnpm dev` of the app (and, if you
also want screenings, next to `agents/screening`'s worker). Without a running
worker, candidates join a silent room — the interviewer never shows up.

## Vision proctoring

`src/vision.ts` samples one frame from the candidate's camera every ~10s and
runs a local YOLOX detector over it (`src/detector.ts`, weights in
[models/](models/README.md)). It reports counts — how many people, how many
phones — to `/api/agent/interview/proctoring`.

Three things about this are deliberate:

- **Frames never leave the process.** Detection is local, the interview is not
  recorded, and no image is written anywhere. A sampled frame lives for one
  function call. The app only ever receives integers.
- **The interviewer never sees them.** Feeding frames into the Realtime session
  would make it react to what it sees mid-call ("is someone there with you?"),
  turning monitoring into a live accusation delivered by the interviewer. The
  interviewer is audio-only and stays that way.
- **No verdicts here.** This worker reports what it counted and how usable the
  frame was. Severity, durations, and incidents are decided by the app's rule
  layer (`summarizeProctoring`), which is versioned and unit-tested, so the
  judgement is identical for every candidate and can't drift with the worker.

### Live overlay

Boxes are also published to the candidate's browser over the room data channel
(topic `proctoring.boxes`) and drawn on their self-view. **On by default** —
`VISION_OVERLAY=0` turns it off.

This is a deliberate reversal of the "don't tip them off" property above, chosen
knowingly: the candidate can now see what was detected and when, so they can time
around it. What it does *not* affect is the record. Boxes travel worker → browser
only; the reporting route accepts no incident types from a browser at all, and
the report is assembled server-side from the worker's own readings. A candidate
who blocks, forges, or replays these packets changes what they see and nothing
about what is stored.

The overlay runs its own faster cadence (`VISION_OVERLAY_INTERVAL_MS`, default
1s) because a box drawn on the report's 10s cadence sits over where the candidate
*used to be*. The report is still recorded every `VISION_SAMPLE_INTERVAL_MS`, so
stored evidence — and every threshold expressed against it — is unchanged by how
smooth the overlay looks.

### Evidence snapshots

When a frame is flagged, the worker encodes **that one frame** as a small
annotated JPEG (`src/snapshot.ts`) and posts it to
`/api/agent/interview/snapshot`, which stores it in a private bucket and keeps
only the object key on the session.

This restores something removing the recording took away: a recruiter reading
"more than one person on camera" had no way to check it, and an automated
finding nobody can verify is a bad thing to put in front of a hiring decision.

It is scoped so it can't drift back into surveillance:

- **Only flagged frames are encoded.** A clean interview stores no image at all.
- **One still per condition per 30s** (`VISION_SNAPSHOT_INTERVAL_MS`) — a phone
  on the desk for five minutes is one finding, not 300 photographs.
- **Unconfirmed stills are deleted.** The worker captures while a condition
  holds; only the app's rule layer knows which conditions survived the
  thresholds. At submit, anything outside a confirmed incident is removed — so
  the frames behind the detector's *own false positives* are exactly the ones
  thrown away.
- **The image never becomes a verdict.** The route accepts no severity and no
  incident type, same as the counts.

Boxes are drawn on the stored image on purpose: a bare photo of a candidate says
nothing, while one labelled `person 0.91 / phone 0.63` shows the reader what was
actually claimed and lets them disagree with it.

`VISION_SNAPSHOTS=0` turns capture off entirely.

### Tuning

The pure decision maths lives in `src/postprocess.ts` and is unit-tested
(`pnpm test`). To check the thresholds against your own camera:

```bash
pnpm tsx scripts/detect.ts ~/Desktop/webcam-screenshot.jpg
```

If the model can't load, the worker logs it once and the interview runs with no
camera evidence. Proctoring never blocks a call.

## Dispatch

This worker registers under the **agent name `screenr-interview`** and is
dispatched *explicitly*: the app names it on the candidate's join token
(`INTERVIEW_AGENT_NAME` in `src/lib/services/livekit.ts`), so it is summoned only
into that candidate's room, and only when they actually join.

Both workers used to run unnamed, which in LiveKit means *automatic* dispatch —
every unnamed worker in the project is a candidate for every room. With two
different agents in one pool, LiveKit gave each interview room to whichever it
picked, so about half of all interviews went to the screening worker, which saw
the room prefix, left, and stranded the candidate with "the interviewer didn't
join". If you change the name here, change `INTERVIEW_AGENT_NAME` to match and
restart the worker — a name mismatch means no agent is ever dispatched.

## Deploy

LiveKit Cloud can host this worker (Agents deployment): `lk agent create` from
this directory with the LiveKit CLI, then set the env vars from `.env.example`
in the LiveKit Cloud dashboard. `SCREENR_APP_ORIGIN` must point at the deployed
app URL.
