# Interview agent worker

The server-side interviewer for the on-demand AI **video** interview. It is a
**separate process** from the Next.js app (forked from `agents/screening/`):
LiveKit dispatches it into every `interview-*` room the app creates, it runs the
conversation over OpenAI Realtime, and it POSTs the transcript to the app's
`/api/agent/interview/transcript` route as the interview progresses.

The candidate joins with camera + mic. This worker drives the spoken
conversation; the camera feed is present in the room for the recording +
proctoring work in later phases (frame sampling + vision analysis), not here.

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
