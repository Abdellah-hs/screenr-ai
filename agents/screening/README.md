# Screening agent worker

The server-side interviewer for the voice screening. It is a **separate
process** from the Next.js app: LiveKit dispatches it into every
`screening-*` room the app creates, it runs the conversation over OpenAI
Realtime, and it POSTs the transcript to the app's
`/api/agent/screening/transcript` route as the call progresses.

It produces **evidence only** — it never advances application state. The
candidate's explicit submit on the review step (and the app's rules) do that.

## Run locally

```bash
cd agents/screening
pnpm install
cp .env.example .env   # fill in the values
pnpm dev               # connects to LiveKit Cloud and waits for rooms
```

Keep it running in its own terminal next to `pnpm dev` of the app. Without a
running worker, candidates join a silent room — the interviewer never shows up.

## Deploy

LiveKit Cloud can host this worker (Agents deployment) so nothing needs to run
on your machine in production: `lk agent create` from this directory with the
LiveKit CLI, then set the env vars from `.env.example` in the LiveKit Cloud
dashboard. `SCREENR_APP_ORIGIN` must then point at the deployed app URL.
