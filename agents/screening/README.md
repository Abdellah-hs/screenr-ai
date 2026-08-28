# Screening agent worker

The server-side interviewer for the voice screening. It is a **separate
process** from the Next.js app: LiveKit dispatches it into every
`screening-*` room the app creates, it **fetches its interviewer instructions**
from the app's `/api/agent/screening/instructions` route, runs the conversation
over OpenAI Realtime, and POSTs the transcript to
`/api/agent/screening/transcript` as the call progresses.

It produces **evidence only** — it never advances application state. The
candidate's explicit submit on the review step (and the app's rules) do that.

## Runtime topic control

The worker does not decide which topics get asked, or when the call may end.
The app owns a **topic ledger** (`src/lib/screening/topic-ledger.ts`) and this
worker reports to it over `/api/agent/screening/control`, then **says what it is
told**.

The Realtime session runs with `create_response: false`, so OpenAI never starts
a turn on its own. Every word the interviewer speaks comes from a
`generateReply` this worker issued, carrying the exact question the app's
directive named. The whole call is one loop:

```
greet  ->  candidate speaks  ->  POST turn_completed  ->  the app names the
next question  ->  generateReply(it)  ->  POST topic_started  ->  arm the
candidate's minute  ->  candidate speaks  ->  ...   ->  directive `close`
  ->  generateReply(goodbye)  ->  flush transcript, tell the browser, leave
```

**There are no tools.** There were two — `next_topic` and `end_interview` — and
the model ignored both on every observed call (`next_topic` zero times in 33
turns). Everything this worker used to contain beyond the loop above existed to
observe and correct a model that was also driving: a stamp that guessed which
topic an unannounced turn had raised, a follow-up detector, three settle windows
trying to tell a goodbye from a sentence trailing off, and a clock that had to
be paused and restored under the interviewer's own voice. None of it is needed
to observe a conversation you are conducting yourself.

## The conversation is one state machine

`src/machine.ts` holds it, and it is where to start reading. Seven states
(`IDLE`, `GREETING`, `ASKING`, `LISTENING`, `FINISHING`, `DONE`, `FAILED`), one
`turnOwner`, one pure `reducer`, and a queue drained synchronously one event at
a time:

```
LiveKit callbacks  ─┐
timers             ─┼─ enqueueEvent ─▶ queue ─▶ reducer ─▶ state
backend replies    ─┘                                │
                     speech, clocks, control posts ◀─ applySideEffects
```

Three rules, and they are the whole design:

1. **Nothing changes state but the reducer.** A callback records what only it
   can observe and enqueues an event; it never decides. So two callbacks can
   never interleave halfway through a transition.
2. **The agent speaks only while `turnOwner === "AGENT"`.** That is what makes
   "the candidate is never interrupted" checkable instead of hoped for.
3. **Side effects are pure output.** They start asynchronous work and return;
   every result comes back as a fresh event.

## Where things live

One job per file. Anything with state of its own is a small module with a tiny
interface, so it can be tested without a room:

| File | Its one job |
| --- | --- |
| `machine.ts` | The conversation: seven states, one pure reducer, one queue. |
| `agent.ts` | The adapter. LiveKit callbacks in, side effects out. Nothing else. |
| `protocol.ts` | The wire to the app, and the one translation into a machine event. |
| `prompts.ts` | Everything the interviewer is told to say. |
| `timing.ts` | Every duration, and the operator overrides. |
| `answers.ts` | When an answer is finished: joining paused fragments, and holding the close until the words land. |
| `transcript.ts` | What was said — deduplicated, and kept durable at the app. |
| `clock.ts` | The countdown on the candidate's screen. |
| `timers.ts` | The five named timers, so none is cleared on one path and left running on another. |
| `speech.ts` | The one lane the interviewer speaks in. |
| `channel.ts` | The two data-channel topic strings the browser also uses. |

`contracts.test.ts` holds the few facts that can only be checked by reading the
source — agreements with the browser, one plugin setting, and orderings whose
only other test would be a live room. Everything else is tested as behaviour.

`src/agent.ts` is now only the adapter and the side effects. The loose booleans
it used to keep — `windingDown`, `awaitingGoodbye`, `clockArmPending`,
`agentSpeaking`, `degraded` — are gone, and with them the combinations nobody
had enumerated: a clock armed on a question the candidate had not heard, a
goodbye spoken over an answer, an answer graded against the question that
replaced it. `src/machine.test.ts` drives the interesting sequences as data.

Three consequences worth knowing before you debug this worker:

- **`turn_completed` is on the audio path.** It runs the turn evaluator, so
  there is a real OpenAI round-trip between the candidate finishing and the next
  question. That latency used to hide behind the model's instant auto-reply;
  now the candidate hears it. The reply to the audio check is deliberately
  exempt — it is not an answer to anything.
- **Silence is the failure mode.** If this worker does not speak, nothing will.
  `LISTENING` therefore always has exactly one timer: the candidate's minute
  once a question has been delivered (`ANSWER_BUDGET_MS`, counted down on their
  screen), and the watchdog before that (`SILENCE_NUDGE_MS`, no counter). Both
  expire into the same `ANSWER_TIMER_EXPIRED`. `SPEAK_BACKSTOP_MS` bounds a turn
  that never completes, and every turn ends by enqueuing an event whether it was
  spoken, cut off, or never happened.
- **A finalized turn is not a finished answer.** Turn detection is OpenAI's
  server-side VAD, so a beat of silence mid-answer ends the turn — and in this
  loop that item is what asks the next question. Acting on it immediately talks
  over somebody who only stopped to think, and spends their topic on the
  fragment they had reached. So the worker holds it (`SCREENING_ANSWER_SETTLE_MS`,
  3s) and joins the fragments if they start again, and it never begins a turn
  while the candidate is talking (`SPEAK_HOLD_MS`). Both are dead air on every
  answer, and both are the price of not cutting people off.
- **The minute, though, is hard.** A pause inside the budget is not an ending; the
  budget running out is. At 0:00 the interviewer asks the next question, whoever
  is talking — there is no grace, and `budgetExpired` stands the politeness above
  down so it cannot come back as one. What makes that fair is the counter: the
  candidate watches the minute fall for its whole length. Take the counter away
  and this has to be revisited with it.

**Nothing improvises any more** (state-machine refactor, 2026-08-27). If the app
cannot say what to ask, the call goes to `FAILED`, says one short technical
sentence and closes the room. The old degraded path injected the topic guide and
told the interviewer to carry on from its own list, which sounds forgiving and is
the worst outcome available: the candidate holds a normal-sounding conversation
that evidences no rubric dimension, is scored 0 across the board, and nothing in
the record says why. A visible failure is recoverable — the recruiter re-sends
the link.

`SCREENING_TOPIC_CONTROL` is gone for the same reason. Its off position restored
`create_response: true` and handed the conversation back to the model, which is
the failure mode rather than the fallback; a kill switch whose off position
reinstates the bug is not a safety measure.

> **The instructions are fetched, not read off the room.** They used to travel
> in LiveKit room metadata, which LiveKit delivers to *every* participant — so
> the candidate's own browser received the confidential topic guide the moment
> they joined. Metadata now carries the application id alone.
>
> Two consequences for operating this worker:
>
> - `SCREENR_APP_ORIGIN` and `AGENT_API_SECRET` are now **required to run a
>   screening at all**, not just to report the transcript. Get them wrong and
>   the worker logs `no interviewer instructions for <id>` and leaves the
>   candidate in a silent room.
> - **The metadata fallback is gone** (2026-08-27). The worker used to read
>   instructions off room metadata if the fetch failed, which kept it running
>   against an app deployed either side of the 2026-08-24 change. The app has
>   long since stopped publishing them, so that path was dead — and dead code
>   that reads candidate-visible metadata is worth deleting rather than leaving
>   for somebody to re-enable. This worker now requires
>   `/api/agent/screening/instructions`, so **deploy the app first, or at least
>   not after.**
>
> A **404 from the control route now ends the call** rather than running
> unmanaged. 404 means "nothing to control here" — an unknown application, or a
> campaign with no screening questions — and neither is a state a real screening
> can be in, so the honest response is a visible failure rather than an
> interviewer improvising a rubric-less conversation. Worth knowing if you point
> a worker at a stale or hand-made room.

## Tests

```bash
pnpm test
```

Covers this worker's own glue — the control client's timeouts and fallbacks, and
what the worker hands the interviewer. The topic ledger itself is app-side and
is tested by the root `pnpm test`.

## Run locally

```bash
cd agents/screening
pnpm install
cp .env.example .env   # fill in the values
pnpm dev               # connects to LiveKit Cloud and waits for rooms
```

Keep it running in its own terminal next to `pnpm dev` of the app. Without a
running worker, candidates join a silent room — the interviewer never shows up.

### `runner initialization timed out`

The job is dropped before any of this worker's code runs, and the candidate
joins a room no agent ever enters:

```
INFO  received job request   agentName: "screenr-screening"
ERROR error launching job    err: "runner initialization timed out"
```

The framework forks a child process per job, the child `import()`s this worker,
and only then answers the parent. That import is the whole of the budget
(`prewarm` is a no-op here), and `@livekit/agents` pulls `@livekit/rtc-node` and
its native bindings in behind it. Measured on the dev machine: **~2.4s with a
warm file cache, ~22s cold** — against a framework default of 10s. Hence
`initializeProcessTimeout` in `agent.ts`.

It is a *first-call* failure, which is why it looks intermittent: the second
attempt hits a warm cache and works. If you see it repeatedly, the file cache is
being evicted between calls — the usual causes are the repository sitting under
OneDrive (every file open goes through the sync filter) and Defender scanning
`node_modules`. Excluding the repo from both is the real fix; `pnpm start`
(production mode) is the other half, since it forks and imports its job
processes at boot rather than while a candidate is waiting.

## Dispatch

This worker registers under the **agent name `screenr-screening`** and is
dispatched *explicitly*: the app names it on the candidate's join token
(`SCREENING_AGENT_NAME` in `src/lib/services/livekit.ts`), so it is summoned only
into screening rooms.

It previously ran unnamed, which in LiveKit means *automatic* dispatch into every
room in the project — including the video-interview rooms, where it took one of
the room's two participant slots from the real interviewer before noticing the
prefix and leaving. If you change the name here, change `SCREENING_AGENT_NAME` to
match and restart the worker — a name mismatch means no agent is ever dispatched.

## Deploy

LiveKit Cloud can host this worker (Agents deployment) so nothing needs to run
on your machine in production: `lk agent create` from this directory with the
LiveKit CLI, then set the env vars from `.env.example` in the LiveKit Cloud
dashboard. `SCREENR_APP_ORIGIN` must then point at the deployed app URL.
