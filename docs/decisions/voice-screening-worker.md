# Voice screening worker — decision record

> **Extracted from CLAUDE.md on 2026-08-30.** These decisions used to live in
> CLAUDE.md, nested five levels deep under `## Environment Variables`, where
> they made up roughly 1,800 of that file's 3,216 lines. They are reproduced
> here **verbatim and in their original order** — nothing has been summarised or
> dropped.
>
> **CLAUDE.md is still the contract.** Its "Voice Screening — the live call"
> section states every rule that currently binds. This file is why each rule
> exists, including the designs that were tried and reversed. Where the two
> disagree, the code wins, then CLAUDE.md, then this file.

## Read this first: much of what follows describes code that no longer exists

The 2026-08-27 refactor replaced the **pull protocol** — in which the model was
expected to call `next_topic` and `end_interview`, and the worker inferred the
state of the call from session events — with a **push protocol**, in which the
app decides every question and the worker only speaks it, driven by one finite
state machine.

These named mechanisms appear throughout this document and are **gone from the
worker**, verified 2026-08-30:

| Gone | Gone |
| --- | --- |
| `decideClose` | `heldClockSurvivesTurn` |
| `stampSkippedTopic` | `grantsClosingMinute` |
| `takeBackWrongStamp` | `closeOnUnreachableApp` |
| `shouldCountFollowUp` | `CLOSE_SETTLE_MS` and the other `CLOSE_*_SETTLE_MS` windows |
| `needsSpokenGoodbye` | the `INTERVIEW CONTROL` prompt block |

**`agents/screening/src/control.ts` does not exist either** — CLAUDE.md cited it
three times as the home of `decideClose` and `shouldStampSkippedTopic`. The
worker's current files are `machine.ts`, `agent.ts`, `timing.ts`, `answers.ts`,
`speech.ts`, `timers.ts`, `protocol.ts`, `channel.ts`, `prompts.ts`,
`transcript.ts`, `language.ts`, `clock.ts`.

`agents/screening/src/contracts.test.ts` actively asserts that the strings
`next_topic` and `end_interview` do not appear in the worker.

**Do not implement anything from this file.** Read it to understand why the
current design is shaped as it is — particularly the recurring lesson that a
Realtime voice model will not reliably call a tool because the prompt asks it
to, so anything the product cannot afford to lose must be driven from observable
state.

---

**The interviewer is GIVEN the questions; withholding them was reversed
(decision 2026-08-25).** `deferTopicsToTool` withheld the topic list so that
`next_topic` would be the only way to learn it — the theory being that an
instruction cannot out-argue an easier path, so the easier path had to go. It
did not work, and the failure it produced is far worse than the one it fixed.

With the list withheld the prompt says *"Your topics are NOT listed here.
`next_topic` is the only place they exist. You cannot guess them and must not
try."* The model then called the tool **zero times** and improvised an entire
interview. A live call asked five invented questions and **not one of the
recruiter's** — a conversation that sounded completely normal and would have
scored every rubric dimension 0, because the evidence for them was never
solicited.

- **An interviewer with the real questions and no tool call is recoverable.**
  The worker stamps coverage itself (`stampSkippedTopic`) and
  `reconcileAddressedTopic` corrects the order. **An interviewer with no
  questions is not recoverable at all** — nothing downstream can invent the
  evidence it failed to ask for.
- **This also made a repair actively harmful.** `stampSkippedTopic` marks a
  topic asked when the interviewer stops speaking. While the list was withheld
  it was marking topics covered that the interviewer had never raised — the
  ledger said "covered", the transcript held nothing, and the candidate scored
  0. A coverage record is only worth having if it tracks questions that were
  actually asked.
- **What is given up is prompt-extraction hardening** (docs/voice-screening.md
  mitigation #2). The list lives in the server-fetched prompt and never in room
  metadata, so it is not readable from the browser; the residual risk is a
  candidate talking the questions out of the model, which the prompt already
  forbids. That is a much smaller harm than every candidate being asked the
  wrong questions.
- `next_topic` **still exists and still works** when called — it is now a
  convenience rather than the only channel, and the close guard still runs off
  the ledger.
- **`end_interview` is ignored the same way, and the worker now closes the call
  itself.** This is the most expensive of the three tool failures: `windDown` is
  what flushes the transcript, publishes `screening.finished` and lets the
  browser submit. Without it a candidate who answered every question sits on a
  finished call that nobody ever scores — it rests at `screening_sent` until the
  expiry sweep rejects them for a call they actually completed. The worker now
  winds down when the interviewer stops speaking and the app's own directive is
  `close`, which `currentDirective` returns only when no topic is in progress
  AND none is pending — the same condition the close guard checks, so it cannot
  end a call that still has questions left.
- **But "nothing left to ask" is NOT "the interviewer has finished talking",
  and conflating them submitted calls mid-question.** The directive turns
  `close` the instant the last topic settles, which routinely lands while the
  interviewer is still mid-exchange — it then asks one more thing, or
  acknowledges the answer. Closing on the next pause alone cut the candidate
  off in the middle of the final question, which is precisely the failure the
  auto-submit exists to prevent. A real goodbye is followed by silence, so the
  close now waits `CLOSE_SETTLE_MS` (4s) and **any speech from either side
  cancels it**. A conversation that is still going therefore cannot be ended by
  it, and the cost of the delay is four seconds on a call that is over.
- **`considerClose` is armed from BOTH triggers, and guarded at FIRING time.**
  `close` can arrive either while the interviewer is still talking (the
  evaluator settles the last topic mid-turn) or after it has already stopped
  (the evaluator is a 3-5s round-trip, so `turn_completed` routinely lands once
  the room is already silent). Waiting only for the next pause **hangs** in the
  second case — the goodbye has been said and no further state change is
  coming — while closing on the next pause alone **cuts the candidate off** in
  the first. So it arms on the pause AND on the directive turning `close`, and
  the safety is moved to when the timer elapses: if either party is mid-turn it
  re-arms instead of closing. The interviewer generating its goodbye looks
  exactly like that, which is why the check is on live session state rather
  than on elapsed time.

##### The settle window is measured from the SILENCE, not from the wait (decision 2026-08-25)

The wait above shipped as "arm a 4s timer; if somebody is talking when it
elapses, re-arm another 4s". That re-arm is from the moment of the CHECK, so its
phase against the conversation is arbitrary — and on a live call it landed 160ms
after the interviewer stopped:

```
02:42:01  turn_completed -> close; the wait is armed while the interviewer is speaking
02:42:04  fires, deferred (still speaking), re-armed +4s
02:42:08  fires, deferred (still speaking), re-armed +4s
02:42:11.84  [clock] interviewer finished asking   <- it had just asked a question
02:42:12.0   [clock] silence after the goodbye — closing
```

The candidate got **0.16 seconds** to begin answering, and their interview was
submitted for them mid-question. The whole property the wait was built to have —
"a real goodbye is followed by four seconds of nobody saying anything" — was
silently absent on every path that ever deferred, which is most of them: the
directive turns `close` while the interviewer is still talking far more often
than not.

`decideClose` (`agents/screening/src/control.ts`, pure and tested) is now the
only thing that answers "may this call end", and it is asked at **firing** time
against the room as it actually is:

- **The clock is `quietSince`, stamped when speech genuinely stops**, from both
  parties' state events — tracked in the worker rather than read back off
  `session.agentState` / `session.userState`, because a handler running for one
  party cannot assume the session's copy of the other has already updated, and
  that error stamps the quiet clock EARLY, which is the direction that closes a
  live call.
- **A wait that elapses too soon re-arms for the REMAINDER**, so the total is
  always measured from the silence. A wait that elapses while somebody is
  talking still defers, as before.
- **A directive that is no longer `close` abandons the wait entirely**
  (`retryInMs: 0`), instead of leaving a timer running over an interview that
  has been handed another topic.
- **Speech state is recorded before ANY early return, and this is an invariant,
  not a detail** (found by review, 2026-08-25). `decideClose` defers while
  either party is speaking, so a speaking flag that sticks `true` makes the call
  unendable — the candidate sits on a finished interview until the half-hour
  backstop, never submits, and the expiry sweep rejects them for a call they
  completed. It shipped once exactly that way: `UserStateChanged`'s
  `moveOnPending` branch returned ahead of `markSpeaking`, and that branch
  handles the candidate FINALLY STOPPING, so one answer running its full minute
  while they were still talking poisoned the close for the rest of the call.
  Any new early return in either state handler must sit below the tracking.
- **A goodbye `end_interview` already cleared goes through the same settle**
  rather than closing on the next pause. It overrides only the directive check —
  a cleared close still ends the call when the app then goes unreachable,
  because trapping a real candidate in a room after the goodbye is worse.

**There are three windows, because there are three strengths of evidence that
the call is over**, and the default is the safe one:

| Window | When | Why |
| --- | --- | --- |
| `CLOSE_SETTLE_MS` (4s) | `end_interview` cleared the close | The interviewer declared the ending — a fact, in whatever language it settled on. |
| `CLOSE_UNANNOUNCED_SETTLE_MS` (8s) | it just stopped talking | A guess, and the common path since the tool is ignored as routinely as the others. |
| `CLOSE_ANSWER_SETTLE_MS` (20s) | its last words were a question | An answer is **owed**. Four seconds is a normal pause for deciding how to answer. |

- **The unannounced window is deliberately NOT decided from the text.** An open
  question is routinely an imperative — "Walk me through the migration", "Tell
  me about a time you disagreed" — which the prompt actively encourages, so
  reading a full stop as a goodbye would cut off precisely the questions this
  stage most wants answered. Only a trailing question mark is treated as
  evidence, and only in the direction of waiting longer.
- **A candidate turn since the question cancels the long window.** They have
  answered; holding the room for a second answer is dead air.
- **Dead air is not free, which is what bounds all three.** The candidate's
  BROWSER is what submits, on the finished packet — so somebody who gives up on
  a screen that looks frozen and closes the tab first is left at
  `screening_sent` with a completed interview behind them, the exact failure the
  automatic close exists to prevent. "Just wait a minute to be safe" trades one
  cut-off call for a different lost one.

##### The counter is on screen for the whole call, frozen when it is not their turn (decision 2026-08-25)

The countdown used to be REMOVED whenever no budget was running. That is most
of a screening call — the interviewer holds the floor for the greeting, every
question and every bridge — so a live call showed the counter for **about four
seconds per question** and nothing the rest of the time. Asked whether it
worked, the honest report from the chair was *"it doesn't show the countdown"*,
and that is a fair description of a counter you see for four seconds.

The browser was never at fault, which is worth recording because two rounds of
debugging went looking there. The candidate's console showed the whole chain
firing correctly — `data packet` → `answer clock {remainingMs: 60000}` →
`countdown shown {seconds: 60}` → `countdown hidden` a few seconds later. Every
publish was acknowledged by LiveKit. The counter appeared exactly when the code
said it should; the code said it should almost never.

**A counter is now on screen from the moment the room opens until the goodbye**,
in one of three states, and `AnswerClockPacket.paused` is what carries the
distinction:

| State | When | How it reads |
| --- | --- | --- |
| running | a question is outstanding and the budget is ticking | ink, counting down |
| frozen | the interviewer is talking, or no question is open yet | grey, standing still, "starts when they finish asking" |
| hidden | the call is over — `close`, or winding down | absent |

- **Freezing is not new; SHOWING the freeze is.** The interviewer's own airtime
  has never been allowed to drain the candidate's minute — that is
  `holdClockWhileSpeaking`, and it stays exactly as it was. What changed is
  that a stopped clock used to be expressed by taking the counter away, and
  "your minute is paused" and "you have no minute" looked identical.
- **The frozen number needs its caption.** A number standing still with no
  explanation reads as broken, which is the one way a paused counter is worse
  than none at all.
- **`ANSWER_BUDGET_MS` in the worker is a number to DISPLAY, never a deadline.**
  A primary question's clock is only armed once the interviewer stops speaking,
  so during the question there is no remaining value to freeze — the worker
  shows the minute that is *coming*. Every enforced deadline still arrives from
  the app on `answerDueInMs`. Tests assert both halves: that it equals
  `SCREENING_ANSWER_BUDGET_MS`, and that nothing in the worker ever arms a timer
  from it. Drift would be a lie on screen; it could never cut anyone off.
- **A frozen number may hold or fall, never rise, while the interviewer is
  talking.** Settling a topic mid-turn turns "what is left of their minute" into
  "a fresh minute", and the counter jumped `0:50 → 1:00` under an unfinished
  sentence. A clock that runs backwards reads as broken however generous it
  actually is — the same complaint that retired the speech-triggered budget. The
  old value is held until the turn ends; the fresh minute appears with the
  question it belongs to, which is the one moment a rise is explicable.
- **The heartbeat re-sends the frozen number verbatim** rather than re-deriving
  it from a deadline, which would let the interviewer's turn drain it again
  through the back door.
- **It is still the ONE counter.** `paused` is the same clock standing still,
  not a second one counting down to something else — the distinction that
  retired the wrap-up counter below. The packet's key list is pinned by a test
  so a third field has to argue for itself.
- **A question asked AFTER the rubric is covered gets its own minute**
  (`grantsClosingMinute`). This was the last hole, and the candidate found it:
  the interviewer routinely asks one more thing once every topic is done, no
  topic is open so the app sends no deadline and no stamp arms one, and the
  counter had just been dropped for the ending — so they answered a real
  question with a blank screen. Frozen at `0:55`, gone, then being asked
  something.

  The worker arms this one **itself**, from `ANSWER_BUDGET_MS`, and it is the
  only clock it owns outright. That is allowed here precisely because there is
  no ledger entry to disagree with: the app is not tracking this question and
  never will. A test pins it to exactly one call site.

  It is granted for **every** such question — never under a goodbye, never once
  `end_interview` has cleared the close, and never while anything is still on
  the rubric. A once-per-call cap shipped first and reproduced the original bug
  one exchange later: the interviewer asked a *second* closing question, the cap
  refused it a clock, and the candidate answered a real question with a blank
  screen again. The looping is the interviewer's fault and the candidate must
  not pay for it by losing the only thing telling them how long they have; the
  loop is bounded from the other end instead — staying silent runs the clock
  out, the close proceeds, and the worker forces the goodbye.

  The cost is that the call then waits for this minute rather than the 20s
  `CLOSE_ANSWER_SETTLE_MS` window, since `decideClose` defers while any answer
  clock runs — accepted, because a candidate who can SEE the minute knows the
  call has not frozen, and a screen that looks frozen is what makes people
  close the tab on a finished interview.

##### The wrap-up window is NOT on screen (decision 2026-08-25, reversed same day)

A "Wrapping up" counter was added on the close window, on the rule that a
deadline the product enforces is one the candidate is entitled to see. It was
removed the same day, on the candidate's own report, and the reasoning is worth
keeping because the rule that motivated it is still right — it just does not
reach this case.

The counter appeared the instant the candidate stopped talking on the last
question, replacing `YOUR ANSWER 1:00` with `WRAPPING UP 0:20`. Two things were
wrong with that, and neither is fixable by relabelling:

- **The minute on the last question is theirs.** They stopped to think, VAD
  ended the turn, the evaluator settled the topic, and a shorter clock took the
  screen — so the visible effect of pausing was being hurried off a call they
  had not finished. *"It has to wait for my last answer."*
- **It shipped under a real question.** A candidate was shown `WRAPPING UP 0:14`
  beneath "Can you share an example of a project where you collaborated with
  people from different teams?" — captioned "we'll close out the call when this
  reaches zero", while the worker was in fact waiting for them to answer.

**There is now exactly one counter on the screen, and it is the answer budget.**
The interview ends on the goodbye, with nothing counting down to it. The settle
windows still exist and still bound the ending — they are simply not displayed,
because the only action a countdown could prompt is "speak", and an interviewer
who has just asked something already prompts that far more clearly.

`AnswerClockPacket` therefore carries `remainingMs` and `expired` and nothing
else; `closeClockRemainingMs`, `refreshCloseClock` and the browser's
`answerClosing` are gone. A test asserts the packet's shape and that the browser
neither reads a `closing` field nor renders the label, because the two packages
deploy separately.

**The minute on the LAST question outlives the topic settling.**
`turn_completed` settles a topic the moment the candidate stops talking, so a
brief answer used to hand the whole remainder back: on a live call a
1.3-second answer ended a 60-second budget with 47 seconds unspent, the counter
vanished, and the call began closing. Between topics that is invisible — the
next question arms a fresh minute — but on the last one there is no next
question, so the loss IS the ending.

The ledger is right to clear its own `answerDueAt`; this is the worker holding
the candidate's side of the same minute. `armAnswerTimer` leaves the timer and
the counter alone when the app reports `null` while the directive is `close` and
a clock is still running, and `decideClose` refuses to close while
`answerClockRunning` — it outranks every settle window, so a room that has been
quiet long enough to close otherwise still waits.

**But it does NOT survive the interviewer's next turn** (decision 2026-08-25).
The leftover is paused for the whole of an interviewer turn, like any answer
clock, and used to be restored when that turn ended. With nothing left to ask,
that turn was the ENDING, so a live call put `0:36` back on screen underneath a
goodbye:

```
turn_completed settles the last topic -> their minute keeps running (36s)
interviewer speaks for 14s            -> clock paused, counter hidden
interviewer stops                     -> "hidden -> 36s  cause=question delivered"
6s later                              -> participant disconnect, CLIENT_INITIATED
```

Two failures from one restore. The counter is the **answer budget and nothing
else**, so 36s reads as the time allowed to answer whatever was just said —
which is how a question that had a full minute is reported as "the last answer
only gives me thirty seconds". And `decideClose` refuses to close while a clock
runs, so the room stayed open under a sign-off; the candidate closed the tab,
and **their browser is what submits**, so an interview they finished was left at
`screening_sent` — the exact failure the automatic close exists to prevent.

`heldClockSurvivesTurn` (`agents/screening/src/control.ts`, pure and tested) is
the one line of it: the remainder comes back while a question is outstanding,
and is dropped once the app's directive is `close`. A closing turn that DID end
on a question is not an exception — `CLOSE_ANSWER_SETTLE_MS` already buys twenty
seconds to answer it, granted once, and a stale remainder from a *different*
question is not a more honest number than none. An unknown task (a control call
that never landed) is read as a live question: their time comes back.

**An expired minute then goes straight to the goodbye.** `fireAnswerTimeout`
clears the timer and sets `answerWindowSpent`, so a candidate who has just spent
their full sixty seconds is not then held through the trailing-question window
on top — they have already had the time that window exists to give them. The
ending is therefore exactly: the last question, their whole minute, then the
goodbye.

##### The worker asks for the goodbye; it does not infer one (decision 2026-08-25)

A settle window can tell that the room went quiet. It cannot tell that anybody
said goodbye — and treating the two as the same thing ends a call that simply
trailed off. The candidate hears the interviewer stop mid-thought, the room
closes, and their answers are submitted into what sounded to them like a dropped
call. Every window above only changed *how long* that took.

**The call now ends on a goodbye the candidate actually heard.** When the settle
window elapses and nothing has said one, the worker asks for it —
`session.generateReply(GOODBYE_INSTRUCTIONS)` — and closes when THAT turn ends.
Submission always follows a sign-off.

- **Same pattern as every other repair on this worker.** `end_interview` is
  ignored as routinely as `next_topic`, so the thing the product cannot afford
  to lose is driven from observable state with the tool as a fast path. Here the
  thing being lost was the goodbye itself.
- **`awaitingGoodbye` is set BEFORE the reply is requested.** It is what makes
  `AgentStateChanged` close on the end of that turn, and it is what stops a
  second window elapsing into a second goodbye. A tool-cleared goodbye already
  sets it, so the worker never talks over one that is on its way.
- **It speaks only when nothing CAN have said goodbye — an ending on a
  question** (revised same day). The first version forced one on every
  unannounced ending, on the reasoning that a slightly redundant second line
  costs less than a call that just stops. A live call showed that is wrong in
  the ordinary case: the interviewer usually DOES sign off on its own, it just
  does not call `end_interview` to say so, so real calls got **two goodbyes
  eight seconds apart with a silence between them** — a worse ending than the
  thin one being guarded against. A turn ending on a question is the one ending
  that is definitively not a sign-off, so speaking there can never double up.
  The reading can be wrong in one direction only: an ending that was merely thin
  ("Great, thanks.") is accepted as the goodbye, and one thin sign-off the
  candidate heard beats two.
- **`awaitsAnswer` is the single predicate behind both halves**, deliberately
  shared so they cannot drift. The window that buys a candidate time to answer a
  trailing question and the goodbye that follows an unanswered one are one
  decision, and must never disagree about whether a question was asked.
- **The instruction is still written to work either way** ("If you have not
  already, thank them warmly…"), because the interviewer may have signed off
  inside the same turn as its question.
- **It forbids a further question**, because a question here restarts the exact
  problem the forced goodbye solves and the candidate has no window left to
  answer it in.
- **`GOODBYE_BACKSTOP_MS` (25s) bounds it**, deferring while anyone is still
  speaking. A reply that is produced but never spoken leaves no state change to
  close on, and without the bound the candidate sits on a finished interview
  until the half-hour call backstop while it rests at `screening_sent`. A
  `generateReply` that throws winds down immediately for the same reason: a
  goodbye we could not produce is bad, a room that never closes is worse.
- **Nothing counts down to it on screen.** The wrap-up counter that once did
  was removed the same day it shipped — see "The wrap-up window is NOT on
  screen" above. The candidate's only clock is the answer budget.
- **The pattern across all three is the same and worth stating once:** a
  Realtime voice model will not reliably call a tool because the prompt tells it
  to, no matter how the instruction is worded, where it sits in the prompt, or
  whether the easier path is removed. Anything the product cannot afford to lose
  must be driven by the worker from observable session state — `AgentStateChanged`,
  `UserStateChanged`, the app's own directive — with the tool as a fast path,
  never as the mechanism.

##### The candidate picks the language before the call, not in it (decision 2026-08-27)

Reported from the chair: *"why does it speak French?"*

The rule was *"greet in English, then match whatever language their FIRST real
answer is in"*. It was written to stop the interviewer flipping between Arabic,
French and English mid-call, and it did — but it left the CHOICE with the model,
which then made it before the candidate had said anything. The instructions
carry their name and a summary of their CV, so it read those, inferred French,
and greeted somebody who wanted English in French.

**The candidate picks on the page in front of them, before the room exists.**
Asking in the call was built first and rejected the same day: it made the answer
something a model had to hear correctly and act on, when the browser can simply
state it. Deterministic beats usually-right, and there is no reason to spend a
conversational turn on a question a form control answers.

- **The choice rides in on ROOM METADATA**, which is the second thing metadata
  has ever carried and a deliberate exception to "the application id and nothing
  else". That rule exists because LiveKit hands metadata to every participant —
  which is how the confidential topic guide once leaked into the candidate's
  browser. This costs nothing to expose for exactly the reason the id does: it
  came FROM that browser seconds earlier. It is their own choice handed back.
- **It belongs to the ROOM, not the application.** A re-record is a new call, so
  somebody who picked wrong gets to pick again by starting over — and no
  migration was needed to store a per-attempt setting.
- **`InterviewRoomMetadata` stopped being an alias of the screening one.** The AI
  interview has no such choice, and a field its worker never reads would be one
  more thing sitting in metadata that every participant receives.
- **A closed enum on BOTH sides, and this is a security property rather than
  tidiness.** The value is written into the interviewer's own instructions, so
  free text would let a candidate put their own directive in the prompt. The
  action parses it with `callLanguageSchema` and falls back to English on
  anything else; the worker re-checks with `readCallLanguage` because the two
  packages deploy separately. Tests cover an instruction dressed as a language.
  An unrecognised value **falls back rather than failing the call** — a language
  choice is not worth refusing an interview over.
- **The language is repeated on EVERY instruction, not set once** (`speakIn`).
  The questions reach the interviewer in English — that is the language they are
  STORED in — so every turn of a French call pulls it back toward English. The
  greeting, the goodbye and the technical-failure sentence all carry it, or the
  call changes language to say hello or goodbye.
- **`null` stays meaningful**: an older app opening a room without a language
  leaves it unpinned, which restores matching whatever the candidate speaks.
  Right when we do not know; wrong as a default, because pinning English would
  open an interview in a language somebody plainly is not using.
- **The prompt's blanket ban on the subject is back and stronger.** It now says
  the candidate already chose, so the interviewer never raises language at all —
  no asking, no offering to switch, no confirming. The flipping this area exists
  to prevent comes from raising it mid-call.
- This is the same division of labour as the questions: the model keeps the
  wording, the warmth and the accent, and has no discretion over the decision.

##### The greeting asks the audio check and waits (decision 2026-08-25)

The opening turn used to be told to greet **and** ask topic 1, with the worker
stamping topic 1 as that turn ended — the bootstrap that opened the first
question without needing the model to call `next_topic`.

On a live call the model did what those words actually invite:

```
"Hi Abdellah, great to have you here. I can hear you clearly—hope you can
 hear me well too."
```

…and stopped, waiting for the confirmation it had just asked for. **The stamp
fired anyway.** Topic 1 was marked asked without being asked, its sixty-second
clock started on a hello, and the candidate's "yes" was consumed as the answer
to a question nobody had put to them — the same "ledger says covered, transcript
holds nothing" failure that `stampSkippedTopic` was itself built to fix, only
now caused by it.

**An audio check nobody is allowed to answer is not a check.** The greeting is
therefore greeting-only — it asks whether they can hear you and stops — and
topic 1 belongs to the turn AFTER the candidate has spoken.

- **Three things can raise topic 1, in order of preference:** `next_topic` if
  the model calls it; `stampSkippedTopic` if it does not, which now bootstraps
  off the candidate having spoken (the honest signal, and reachable on exactly
  the call that needs it); and `armOpeningNudge` if the candidate never answers
  at all.
- **`OPENING_REPLY_GRACE_MS` (20s) is the one path out of a silent room.**
  Stopping after the check costs the call its old way forward: no topic is open,
  so no answer budget is running and the interviewer will not speak again on its
  own. The nudge opens topic 1 and THEN has the interviewer ask it — that order
  is the point, because opening a topic without asking it is the failure this
  whole area keeps producing. It is generous because the honest reading of
  silence here is somebody fighting a microphone permission dialog.
- **`toolChoice` is gone.** It was never observed to fire on @livekit/agents
  1.5.1 with `gpt-realtime` despite the plugin reporting
  `perResponseToolChoice`, and this turn must not raise a topic anyway.
- **The residual risk is accepted and named:** an interviewer whose second turn
  is a bare acknowledgement ("Great, glad you can hear me!") will have topic 1
  stamped against it. That costs one minute of clock, and the evidence still
  lands — `extractTranscriptEvidence` reads the whole transcript, not one
  answer. It is strictly better than the guaranteed misfire it replaces.

**The call has no clock; each QUESTION has one, and it only ever counts down
(decision 2026-08-25, superseding the speech-triggered scheme and both timing
schemes below).** There is no global call budget. Every question — a primary
topic or a follow-up — gets `SCREENING_ANSWER_BUDGET_MS` (**60s**), armed the
moment the interviewer finishes asking it, and the call ends when its topics are
covered, which the close guard already guarantees.

- **One clock, and it never goes up.** The budget used to start at the
  candidate's FIRST WORD, so thinking time was free and the counter therefore
  **jumped up** when they began speaking — from whatever the silence fallback
  had left to a fresh minute. That was deliberate and it was documented here as
  generous. It is also the first thing a real person watching a real call
  reported as a bug: *"when I speak it returns to 1"*. A timer that runs
  backwards reads as broken however generous it actually is, and a candidate
  mid-interview cannot be told "that's intentional".
- **The cost is real and was accepted.** Seconds spent deciding what to say now
  come out of the answer. A minute absorbs it — the competency answer this stage
  looks for runs 30-45 seconds — and one honest falling number beats two clocks
  that are individually correct and jointly incomprehensible.
- **`SCREENING_SILENCE_BUDGET_MS` is retired**, kept only as an alias. It
  existed because a candidate who never spoke never started the answer clock;
  a budget armed at the question already covers silence, because they simply run
  it out.
- **`answerStartedAt` is still recorded, as evidence, and moves nothing.** How
  long somebody took to start is worth having on the transcript. `applyAnswerStarted`
  therefore writes only that field — a test asserts the deadline is untouched.
- **The clock starts when the question has been DELIVERED, not when it was
  raised.** `next_topic` is called before the interviewer speaks, and an agent
  turn is finalized when its TEXT completes — both run ahead of the audio. On a
  live call the clock armed at `01:13:23` while the interviewer was still asking
  at `01:13:37`: thirteen seconds of the candidate's minute spent listening.
  `AgentStateChanged` leaving `speaking` is the only moment that means "they
  have heard the whole question", so the topic is stamped there.
- **The countdown is VISIBLE to the candidate**, published by the worker over
  the LiveKit data channel (`SCREENING_ANSWER_TOPIC`, `screening.answer`)
  whenever a question is outstanding — **including before they have said
  anything**. It carries REMAINING milliseconds, never an absolute deadline:
  the browser anchors to arrival, so a candidate whose system clock is wrong
  still sees the right number. It is **display only** — the interviewer moves on
  when the worker's timer says so, identically for a candidate whose tab is
  backgrounded and rendering nothing.
- **A deadline the product enforces is one the candidate is entitled to see.**
  The counter was briefly hidden until the candidate started speaking, to keep a
  clock off the pause while somebody decides what to say. That removed the
  *warning* rather than the pressure — the fallback was still a real deadline,
  so a candidate who sat thinking for fifty-five seconds was moved on with no
  notice at all. Do not reintroduce the gate.
- **At zero the interviewer asks the next question** (amended 2026-08-25 — see
  "The minute is the minute" below). The counter reaches 0:00, the label reads
  "Time's up — moving on to the next question", and it does. The 15s grace this
  bullet used to describe — sitting on the expired timer until the candidate
  stopped talking — is gone, along with `SCREENING_ANSWER_GRACE_MS` itself. The
  visible countdown is what makes that fair: nobody is cut off by a deadline
  they could not see coming.

**The countdown died after the candidate's first answer (fixed 2026-08-25).**
It appeared on question one and never came back. The cause was
`beginNextTopic`'s **duplicate-call guard**, and it was a race the guard could
not see:

```
+30.0s  candidate stops -> turn_completed posted (evaluator, 3-5s)
+30.5s  interviewer calls next_topic -> topic_started
        ledger still has topic 1 in_progress, followUpsUsed 0
        -> read as "asked twice for the same topic", swallowed
+34.0s  evaluator lands, settles topic 1 -> answerDueAt: null
        topic 2 was never raised; the tool call is spent
```

The guard exists for a real case — a retried control call must not burn a
second topic on one spoken question. But **the ordinary order is the one it
mistook for a duplicate**: the model calls `next_topic` about half a second
after the candidate stops, and `turn_completed` is an OpenAI round-trip three to
five seconds behind it. So on nearly every hand-off the next topic was never
raised. `answerDueAt` was never re-armed, and while nothing is open both
`applyAnswerStarted` and `applyAnswerTimeout` are no-ops — so the countdown
vanished, the answer had no deadline, and the topic stayed `pending` and scored
the candidate **0** on whatever the rubric graded it against.

`ledger.answerStartedAt` is the discriminator, and it is the whole fix: null
means nothing has happened since we raised the topic (a genuine duplicate,
still handed back unchanged); non-null means the candidate answered and the
interviewer is moving on, so the topic is settled and the next one raised in the
same step. It settles **`complete`**, not `insufficient` — the same call
`applyEvaluatorFailure` makes, for the same reason: they answered, and our
evaluator being slower than the conversation says nothing about what they said.
The verdict still lands moments later and fills the evidence summary through
`annotateSettledTopic`.

The regression test drives the real concurrency through
`applyScreeningControlEvent` against a store that **compare-and-swaps on the
ledger version**, the way `UPDATE ... WHERE topic_state->>version` does. A test
double that accepts every write hides this entire class of bug — the first two
attempts at reproducing it did exactly that and showed a healthy call.

Three smaller repairs shipped alongside it, each a different assumption about
who arms the clock:

- **A skipped `next_topic` took the clock down with it — for the whole call.**
  This is the one a live call actually showed: the candidate's console carried
  three `answer clock {remainingMs: null}` packets and nothing else, start to
  finish. The transport, the worker and the browser were all fine; the app was
  returning `answer_due_in_ms: null` on every response because **no topic was
  ever opened**. The interviewer never called `next_topic` — the same failure
  `deferTopicsToTool` was built for after it called the tool *zero times in 33
  turns*, and withholding the topic list turns out not to be enough on its own.

  It costs the countdown because the clock lives in the same place as coverage:
  `answerDueAt` is only ever set by opening a topic, and while nothing is open
  both `applyAnswerStarted` and `applyAnswerTimeout` are no-ops. So no answer
  had a deadline either.

  **Asking the model to call `next_topic` has now failed three times**, and the
  third attempt is worth recording so nobody spends the afternoon on a fourth.
  The greeting is a `generateReply` the worker controls, so it passes
  `toolChoice: {type: "function", function: {name: "next_topic"}}`. The plugin
  reports `perResponseToolChoice: true`, so this should bind that one response
  — and on a live call it **did not fire**: that very response ran
  `performToolExecutions` and called nothing. The line is kept because it is
  correct as written and costs nothing if a later SDK honours it, but **nothing
  may depend on it**. (A session-wide toggle is not available either:
  `AgentSessionUpdateOptions` carries no `toolChoice`.)

  What actually opens topic 1 is the stamp below, fired the moment the greeting
  finishes. That path needs no cooperation from the model at all, which is the
  only property worth having here.

  The worker notices an interviewer turn ending with a primary question
  outstanding and no timer armed, and stamps `topic_started` itself —
  `shouldStampSkippedTopic` in `agents/screening/src/control.ts`, pure and
  tested. **The bootstrap condition is `openingTurnComplete`, and that choice is
  the whole subtlety.** The obvious gate — "a topic has been opened properly at
  least once" — was written first and is unusable: if the tool is never called,
  no topic is ever opened, the condition is never met, and the repair never
  runs. It is a safety net for a failure that cannot happen, and it shipped
  once. Past the opening turn the same situation can only mean the interviewer
  asked without announcing. *During* it, an interviewer that greets and waits
  looks identical, so nothing is stamped there.

  **It also requires the turn to have ASKED something** (`lastTurnWasQuestion`,
  2026-08-25). Every interviewer turn ending with a primary question
  outstanding used to stamp a topic — bridges and acknowledgements ("That's
  okay.", "Thanks for that.") included. Each one burns a topic: marked asked,
  never asked, scored 0. The asymmetry decides it — a stamp MISSED is
  recoverable, since the topic stays outstanding, the next turn that does ask
  something stamps it, and the scorer reads the whole transcript anyway; a
  stamp made IN ERROR is not recoverable at all, because that topic is spent
  and nothing will ever put its question to the candidate.

  **`openingTurnComplete` is "the candidate has spoken", and nothing else
  (decision 2026-08-25).** It used to also accept "the greeting turn has
  finished", which made the guard vacuous — the greeting IS the opening turn,
  so the one turn the condition exists to exclude was the one it stamped, on
  every call. See the next section for what that cost.

  Fixing this in `reconcileAddressedTopic` instead was tried and reverted: it
  runs *after* the answer it was meant to time, so every path out of it either
  sets its own clock or clears one.
- **A follow-up never started the answer budget.** A follow-up is asked with no
  tool call, so the only response that re-arms is `turn_completed` — a 3-5s
  evaluator round-trip the candidate routinely starts talking inside.
  `UserStateChanged` had already fired and does not fire again until they stop,
  so `answer_started` was never sent and the follow-up ran on the *silence*
  fallback: the number never jumped up at the first word, and a long answer
  could time out mid-sentence. Arming a clock now re-checks `session.userState`
  and reports the onset if they are already speaking.
- **One packet per question, never re-sent.** LiveKit does not buffer data for
  anyone not in the room at the instant of the send, so a browser reconnecting
  after a blip, still finishing its join, or simply dropping the packet lost the
  countdown outright — and the next send was a whole question away. The worker
  re-publishes every 5s while a clock is armed. That heals reconnects, late
  joins and dropped packets with one mechanism, and each repeat doubles as a
  drift correction because the browser anchors to arrival. Heartbeats are not
  logged; only state changes are, so the log stays readable.

**The clock may only start once the question has been DELIVERED (2026-08-25).**
Both obvious trigger points run ahead of the audio the candidate is listening
to: `next_topic` is called *before* the interviewer speaks, and an agent turn is
finalized when its TEXT completes. On a live call the clock armed at `01:13:23`
and the interviewer was still asking at `01:13:37` — **thirteen seconds of the
candidate's minute spent on the interviewer's own airtime**, against a screen
that says the minute starts when they begin speaking.

`AgentStateChanged` leaving `speaking` is the only moment that means "they have
now heard the whole question", so the topic is stamped there. Two rules follow:

- **Candidate speech while the interviewer is talking never starts the budget.**
  It is an interruption, a backchannel, or an answer to the greeting — not the
  start of an answer to a question they have not finished hearing. This was a
  real regression from the "already speaking" repair: a candidate who talked
  over the greeting had their onset stamped before the question existed.
- **It is picked up again the instant the interviewer stops.** Somebody talking
  over the tail of a question still gets their full minute, measured from there.

The same transition is what lets the stamp bootstrap: the first time the
interviewer stops speaking, the opening turn is over by definition.

**The counter is also HELD off the screen for the whole of any interviewer turn
(2026-08-25).** A clock ticking at the candidate while it is not their turn is
the screen disagreeing with the call, and it reached a live call from two
directions:

- **A follow-up re-arms the budget from `turn_completed`,** which lands about
  two seconds after the candidate stops — while the interviewer is still asking.
  This is the same "clock started before the question was delivered" bug the
  stamp fixed for primary questions, and it had simply never been fixed for
  follow-ups: they raise no topic, so they pass through no stamp.
- **The last question's held-open minute** keeps running through the
  interviewer's closing turn, so the counter sat on screen underneath it.

`holdClockWhileSpeaking` / `releaseClockAfterSpeaking` own both, and **held
means PAUSED, not merely hidden.** Hiding alone still let the interviewer's own
airtime drain the budget: a ten-second closing turn took ten seconds off a
candidate's last answer, so a minute barely touched came back reading thirty
seconds. The timer is stopped for the duration and re-armed with exactly what
was left, so the clock still only ever counts down and never advances during a
turn that was not theirs. It is the same principle that arms a primary
question's clock at delivery rather than when it was raised, applied mid-clock.

Two things follow, and both are load-bearing:

- **`startAnswerTimer` is the only place a running answer clock is created**, so
  the app's number and a released pause cannot drift into different behaviours.
  It owns the "not over the interviewer's voice" rule for both.
- **A paused clock is still the candidate's time**, so `answerClockLive()` — not
  `answerTimer !== undefined` — is what the close guard, the skipped-topic stamp
  and the held-open last minute all read. A pause is the interviewer talking
  over their budget, not the budget ending.

The release runs ahead of every early return in the `AgentStateChanged` handler
— a held counter must come back whatever else that turn also settled or closed.

A fourth, smaller one: a response reporting an **already-expired** budget
published nothing and armed nothing, having just cleared the outstanding timer
— leaving the counter frozen at 0:00 with no "time's up" line and the topic with
no deadline left. It now publishes `(0, expired)` and settles once,
`expiredSettleFired` stopping a run of zero-valued responses from re-firing.

A single clock over a whole call was a guillotine in every version it had. The
cost of a slow first answer was paid by the LAST topic, which went unasked and
scored the candidate **0** on whatever the rubric graded it against — a penalty
for someone else's pacing. Stretching the clock (10 min) and shrinking it (5
min) both moved that penalty around instead of removing it. A per-answer budget
puts the cost of a rambling answer on that answer, where it belongs, and it
structurally cannot reach the topics behind it.

- **~~It never cuts anyone off mid-word.~~** Superseded 2026-08-25 — see "The
  minute is the minute" below. The budget expiring used to wait for the
  candidate to stop talking before moving on; it no longer waits at all. The
  reasoning below stands for the SHAPE of the budget — one clock per question,
  falling only — but not for what happens when it reaches zero.
- **The interviewer is told explicitly NOT to manage time.** It is the one
  participant that cannot perceive it, and every instruction that asked it to
  produced hurrying — a candidate rushed through an answer to protect a budget
  the app was already protecting for them. The prompt no longer quotes any
  duration at all; `realtime.test.ts` asserts that.
- **`SCREENING_CALL_BACKSTOP_MINUTES` (30) is a failure bound, not a duration.**
  Nothing quotes it, nothing displays it, and a behaving call never approaches
  it. It exists for the worker that dies mid-call and the tab abandoned in an
  empty room, both of which otherwise bill a Realtime session by the minute
  forever. It is 30 because eight topics with a follow-up each is sixteen
  questions, each of which may spend its minute AND its grace — twenty-four
  minutes before the interviewer has said a word. A bound below the worst
  legitimate case would start cutting real calls, which is the thing being
  removed.
- **This retired the `MAX_SCREENING_CALL_MINUTES <= INTERVIEW_DURATION_MINUTES`
  invariant.** That bound said the cheap filter must not outrun the deep stage,
  and it was right while screening had a fixed length. It no longer has one: the
  EXPECTED call is `screeningCallEstimateMinutes` (topics + 2, floor 5 — about
  seven minutes at five topics, still well under the interview), and the
  backstop is a failure bound. Asserting one against the other would compare two
  different kinds of thing and force the safety net below the point of being one.
- **The estimate is copy and enforces nothing.** It appears in the invitation
  email and on the pre-call screen so nobody starts a call not knowing what they
  are agreeing to. Before this, ONE function fed both the copy and the hard cut,
  so "about 5 minutes" was a promise and a threat in the same sentence.
- **An eight-topic rubric is a twenty-minute conversation in the worst case.**
  That is the honest read of the arithmetic above, and the remedy is fewer
  topics — the same one `checkScreeningQuestionCoverage` already pushes.

`answer_started` and `answer_timeout` are the fifth and sixth control events.
`applyAnswerStarted` starts the clock — idempotent per question, and a no-op
when no topic is open, so speech over the greeting starts nothing.
`applyAnswerTimeout` settles the
open topic on the evidence it already has (`complete` if any, `insufficient`
otherwise) and advances. It is deliberately a **no-op** when nothing is
outstanding: the worker's timer and the evaluator race constantly, and a
timeout able to settle a topic nobody was answering would cut the NEXT question
short.

**The five-minute flat call it replaced (decision 2026-08-24, superseded same
day):** `MIN_SCREENING_CALL_MINUTES` and
`MAX_SCREENING_CALL_MINUTES` are both **5**, so `screeningCallMinutes` returns a
flat five whatever the topic count. The range described below was correct for
the world it was written in and is kept because the reasoning still explains the
shape of the code — but the lever it depended on has been replaced.

The stretch existed because a flat five was a **guillotine**: nothing tracked
what had actually been asked, so a call that ran out of time died mid-sentence
and every unraised topic scored the candidate 0 on whatever the rubric graded it
against. Widening the clock was the only remedy available. Runtime topic
coverage is a better one — the wrap-up reserve stops probing and raises whatever
is left, and the close guard refuses to end the call while anything is `pending`
— so the call now fits its topics by covering them faster rather than by running
longer.

What is given up is **depth**, and it is a real cost: five minutes minus the
60-second reserve is four minutes of interviewing, roughly 48 seconds a topic at
five topics and about 30 at the eight-topic ceiling. At the top of that range
follow-ups will be scarce. The remedy is fewer topics, which is the same thing
`checkScreeningQuestionCoverage` already pushes. `screeningCallMinutes` stays a
function and the two constants stay separate, so restoring a range is one line.

**The rubric-sized range it replaced (decision 2026-08-24, superseded same day):**
`screeningCallMinutes(topicCount)` in `src/lib/constants.ts` — ~1.2 minutes a
topic plus two of overhead, clamped to **5-10**. Three things read it and must
never disagree: the client's hard cut (`voice-screening.tsx`), the length quoted
to the candidate (the pre-call copy **and** the invite email), and the pacing
`buildScreeningInstructions` gives the interviewer.

It was a flat **5** in all three places, and that was a guillotine rather than a
target. The question set is sized from the rubric
(`screeningQuestionCountForRubric`, 3-8) while the cap was not, so five minutes
fitted three topics and cut eight off half-finished — and an unreached topic
leaves its rubric dimension with no evidence, scoring the candidate **0** on it.
The prompt made it worse by asking for 1-2 follow-ups on every topic: at the
ceiling that is 24 exchanges in 300 seconds.

- **A function, not a constant, because one number cannot honestly serve the
  range.** A flat ten would quote a ten-minute call to someone facing three
  questions — a promise that costs completions at the top of the funnel.
- **The ceiling is `MAX_SCREENING_CALL_MINUTES` (10) and must never exceed
  `INTERVIEW_DURATION_MINUTES`** (asserted in `constants.test.ts`): screening is
  the cheap filter, the AI interview is the deep stage, and a screen that outran
  the interview would have the funnel upside down. Where the clamp bites, the
  instructions tell the interviewer to **drop the follow-up, never the topic**.
  A recruiter wanting more depth per topic should trim the rubric — the same
  remedy `checkScreeningQuestionCoverage` already pushes.
- **The cap is a backstop, not the expected length.** The interviewer is told to
  stop as soon as it has covered everything and never to pad, so the headroom
  costs nothing on a normal call.
- **The invite email was fixed in the same change.** It still described the
  typed form #161 deleted — "15-25 minutes to complete them", a button reading
  "Answer the questions" — so a candidate budgeted twenty minutes of typing and
  landed on a live call needing a microphone and a quiet room.

##### The worker is one finite state machine (refactor 2026-08-27)

The push protocol below is unchanged — the app still decides every question and
the worker still only speaks it. What changed is **how the worker holds its own
state**: `agents/screening/src/machine.ts` is now the single source of truth for
the conversation, and `agent.ts` is only the adapter into it.

Seven states (`IDLE`, `GREETING`, `ASKING`, `LISTENING`, `FINISHING`, `DONE`,
`FAILED`), one `turnOwner`, one **pure reducer**, and one **synchronously
drained event queue**. Every asynchronous source — LiveKit session events,
timers, backend replies — is converted into an `InterviewEvent` and enqueued; a
callback may record what only it can observe, and may not decide.

- **The problem it solves is not a missing feature, it is concurrency.** The
  worker kept its state in a dozen loose booleans (`windingDown`,
  `awaitingGoodbye`, `goodbyeInterrupted`, `clockArmPending`, `budgetExpired`,
  `agentSpeaking`, `degraded`) each written from whichever callback happened to
  observe the thing it described. Callbacks fire concurrently, so "the state"
  was whatever combination a given interleaving produced — and every bug in
  this worker's history is a combination nobody had enumerated. They are now
  either in the transition table or unreachable.
- **`turnOwner` is what makes "never interrupt the candidate" checkable.** The
  agent speaks only while it is `"AGENT"`. A question decided while the
  candidate is still talking is held in `pendingQuestion` and asked on
  `CANDIDATE_SPEECH_STOPPED`, bounded by `SPEAK_HOLD_MS`. The one exception is
  `budgetExpired` — holding a question until they pause is exactly the grace
  "the minute is the minute" removed.
- **`openingQuestion` is a separate field from `pendingQuestion`, and it has to
  be.** Both are questions the machine is holding, but they are asked on
  different signals: a deferred question the instant the candidate pauses
  (their answer was already banked), the opening question only once the audio
  check has SETTLED. Sharing one field gave topic 1 the deferred trigger, which
  asks the first real question over a candidate who said "yes —" and kept going.
- **The goodbye waits for a pause, exactly like a question does** (reported from
  the chair: *"while speaking it submits"*). The close branch used to enter
  `FINISHING` the instant the directive arrived, with no check on who held the
  floor — while the question branch immediately below it checked. So the
  ORDINARY end of a call cut people off: the candidate answers the last
  question, pauses, `turn_completed` goes out, the evaluator takes its three to
  five seconds, the candidate resumes ("…and yeah, that's basically it"), the
  `close` directive lands, and the sign-off plays over the top of them. Their
  speech cancels it, the one redelivery is spent, and `screening.finished`
  publishes mid-sentence — and since the browser submits on that packet and the
  server finalizes from the reported draft, whatever they were saying reaches no
  transcript at all. `pendingClose` holds the ending until they stop.
- **`budgetExpired` does NOT override that wait, and this is the one place it
  does not.** It exists so running out of time cannot delay the NEXT QUESTION,
  because delaying that is the grace period the visible countdown promises does
  not exist. At the close there is no next question: nothing is delayed but the
  ending of a call that is already over.
- **`CLOSE_HOLD_MS` (20s) is longer than `SPEAK_HOLD_MS` (10s)** for the same
  reason — a held question delays the interview, a held goodbye delays nothing.
  Both are bounded, because a candidate who never stops would otherwise hold the
  room open, give up on a screen that looks frozen, close the tab, and be
  rejected by the expiry sweep for an interview they actually sat.
- **`LISTENING` has exactly one timer.** `questionDelivered` — set by
  `QUESTION_FINISHED` and nothing else — decides whether it is the candidate's
  minute (with the visible countdown) or the silence watchdog (without one).
  Both expire into `ANSWER_TIMER_EXPIRED`. The app's `wait` directive re-arms
  the WATCHDOG, never a second minute: their budget was already spent.
- **There is no improvisation and no kill switch.** `SCREENING_TOPIC_CONTROL`
  and the `improvise` move are gone. The switch's off position restored
  `create_response: true` and handed the call back to the model's own topic
  guide — which is the failure mode, not the fallback: an interviewer choosing
  its own questions holds a normal-sounding conversation that evidences no
  rubric dimension, so the candidate is scored 0 across the board and nothing
  in the record says why. A kill switch whose off position reinstates the bug
  is not a safety measure. An unusable directive now reaches `FAILED`, which
  says one short technical sentence and closes the room; the recruiter re-sends
  the link.
- **`FAILED` is nearly terminal, with exactly one edge out.** `GOODBYE_FINISHED`
  carries it to `DONE`. Without that the room sits open until the half-hour
  backstop, the browser is never told to submit, and the expiry sweep rejects a
  candidate for an interview they actually sat.
- **`shouldRedeliverGoodbye` moved into the reducer** — same decision (an
  interrupted goodbye is not a goodbye; say it again, exactly once), now a field
  of one state rather than two booleans two callbacks write. `decideNextMove`
  keeps its `wait` move, which is deliberately NOT an error: the ledger reports
  `ask_follow_up` for any open topic, including the seconds before a candidate
  draws breath.
- **`BACKEND_RESPONSE` carries a `kind`.** It is the one field added to the
  event shape, and it is load-bearing: a primary question is reported to the app
  as `topic_started` (which stamps `askedAt`, and is therefore what "this topic
  was covered" means) and a probe must not be, or every follow-up burns a topic
  nobody asked.
- **The app's API is untouched.** Same routes, same events, same wire shapes —
  only how the worker calls them changed.

##### The app pushes the conversation; the interviewer only speaks it (decision 2026-08-25)

**`create_response: false`.** The screening worker's Realtime session no longer
lets OpenAI start a turn. Nothing is said on a screening call unless the worker
asked for it with `generateReply`, and the worker only ever asks for the
question the app's directive named. The call is one loop:

```
greet -> candidate speaks -> POST turn_completed -> the app names the next
question -> generateReply(it) -> POST topic_started -> arm the candidate's
minute -> ... -> directive `close` -> generateReply(goodbye) -> wind down
```

**Everything below this section describes the PULL protocol it replaces, and is
kept for the reasoning rather than the facts.** The mechanisms named there —
`next_topic`, `end_interview`, `stampSkippedTopic`, `takeBackWrongStamp`,
`shouldCountFollowUp`, `decideClose`, `closeSettleMs`, `needsSpokenGoodbye`,
`heldClockSurvivesTurn`, `grantsClosingMinute`, `closeOnUnreachableApp`, the
`CLOSE_*_SETTLE_MS` windows and the `INTERVIEW CONTROL` block — **no longer
exist in the worker.** The app-side ledger is unchanged.

- **Every one of them existed to observe and correct a second controller.** With
  auto-reply on, the model chose when to speak, what to ask and when to stop, so
  the worker had to infer all three from session state after the fact. Remove
  its ability to speak unbidden and there is nothing left to infer: it cannot
  raise an unannounced topic, so nothing has to guess which one; it cannot
  improvise a probe, so nothing has to detect one; it cannot trail off instead of
  saying goodbye, because the worker asks for the goodbye.
- **This is the fourth attempt at the same problem and the first that worked.**
  The prompt was reworded, the tool protocol was moved to the top, the topic
  list was withheld, and `toolChoice` was pinned per response. The model called
  `next_topic` zero times in 33 turns through all of it. A Realtime model will
  not reliably call a tool because it was asked to — but it also cannot ignore
  a turn it was never allowed to start.
- **The worker now owns the answer clock, reversing the old rule that its
  `ANSWER_BUDGET_MS` was "a number to display, never a deadline".** That rule
  existed because the app armed the deadline when it opened a topic — which is
  before the question is spoken, so the candidate's minute started while they
  were still listening (thirteen seconds, on one call). Only the worker can see
  when an asking turn ended. The DURATION is still single-sourced from
  `SCREENING_ANSWER_BUDGET_MS` and pinned by a test; the app's `answerDueAt`
  stays as a record and enforces nothing. `topic_started` is also posted AFTER
  the question is asked, so `askedAt` means what it says.
- **The topic list is withheld from the prompt again** (`withholdTopics`),
  restoring docs/voice-screening.md mitigation #2. Withholding was tried under
  the pull protocol and was a disaster — the model invented a whole interview —
  but that failure required it to be able to start a turn. An interviewer with
  nothing to ask now says nothing, which a watchdog recovers, rather than making
  something up. The fallback guide (`buildScreeningTopicFallback`) survives for
  a worker that loses the app mid-call, and is the only circumstance in which
  this interviewer chooses its own questions.
- **Silence is the failure this buys, and it is the only new mechanism.** If the
  worker does not speak, nothing will. `SILENCE_NUDGE_MS` (20s with no answer
  clock running) posts `answer_timeout` and advances — which also covers an
  unanswered greeting, since `applyAnswerTimeout` is a no-op with nothing open
  and the directive comes back "ask topic 1". `SPEAK_BACKSTOP_MS` (45s) bounds
  one turn, because `generateReply` resolves on playout and the drive chain is a
  single lane: a hung reply would otherwise stop every later turn, every answer
  timeout, and the watchdog itself.
- **The close waits for an answer already spoken (`createFinalAnswerBarrier`).**
  Speech and transcription are two different events. `onInputSpeechStopped`
  fires when the candidate stops; the finalized `ConversationItemAdded` lands
  later, and only then is the answer in the transcript and queued for
  reporting. Anything closing in between publishes `screening.finished` over a
  draft missing the last thing they said — and since the browser submits on
  that packet and the server finalizes from the draft, nothing recovers it.
  - **The ordinary path was never exposed**: the transcript item is what posts
    `turn_completed`, so a `close` directive cannot exist before the item that
    produced it. **The answer timeout is**, because it advances the ledger from
    a timer that knows nothing about a transcript in flight.
  - The barrier opens on speech, closes on the finalized item, and is awaited
    before the goodbye, before the timeout may settle a topic, and again in
    `windDown` as a backstop. A timeout whose answer turns up **stands down**
    rather than settling the topic a second time.
  - **`FINAL_TURN_SETTLE_MS` (8s) bounds it.** Waiting forever is the
    mirror-image failure — the candidate sits on a finished call, closes the
    tab, nothing submits, and the expiry sweep rejects them for an interview
    they sat. Giving up logs `screening.worker.final_turn_unsettled` with the
    application id, and records both halves of the fact: speech WAS observed,
    the transcript was NOT. Those need different investigations.
- **An interrupted goodbye is not a goodbye (decision 2026-08-25).**
  `generateReply` resolves on a CANCELLED playout exactly as it does on a
  completed one, so its returning meant "the sign-off stopped", not "the
  sign-off was delivered". With `interrupt_response: true`, a candidate who
  starts talking over it cancels the turn — and on a live call the room shut
  120ms later:

  ```
  21:17:59.296  the goodbye starts playing
  21:18:01.369  the candidate begins talking over it
  21:18:01.370  response cancelled, reason=turn_detected
  21:18:01.488  generateReply resolves -> wind down
  21:18:01.49   screening.finished published, browser submits
  21:18:01.894  candidate disconnects, still mid-sentence
  ```

  From the chair that is the product hanging up on you, and whatever they were
  saying reached no transcript at all. The worker now hears them out
  (`finalAnswer.wait`), says goodbye ONCE more, and only then winds down —
  `shouldRedeliverGoodbye`, bounded at one retry with `GOODBYE_BACKSTOP_MS`
  outside it.
- **The barrier opens for speech during the CLOSE, not only during an answer.**
  Gating it on the answer clock excluded the one case that actually fired: the
  clock is deliberately stopped for the close, so somebody talking over the
  sign-off opened no barrier and the room shut before their item arrived.
- **A transcript is attributed to the question that was on the floor when the
  candidate STARTED speaking**, not when the words came back. Reading the
  sequence at arrival was a real hole in `questionSeq`, not a theoretical one:
  a late item from a topic that had already timed out arrives once the next
  question has been asked, at which point the arrival-time sequence matches the
  current one, the guard waves it through, and one answer is graded against a
  question the candidate had not yet heard.
- **A redelivered `ConversationItemAdded` is dropped by item id.** The app is
  idempotent on `event_id`, but the worker's `turns` array is not — a duplicate
  would show the answer twice in the transcript the scorer reads.
- **`turn_completed` is now on the audio path**, which is the honest cost. The
  evaluator's 3-5s round-trip used to hide behind the model's instant auto-reply
  and is now silence the candidate hears between their answer and the next
  question. The reply to the audio check is exempt — it is not an answer to
  anything, and that latency would land at the worst possible moment.
- **A queued report is dropped if the call has moved past the question it
  belongs to** (`questionSeq`). The race is routine: a candidate who over-runs is
  given their grace, `answer_timeout` settles the topic and the next question is
  asked, and only then does their final fragment finish transcribing. It costs
  the evidence summary on that answer — the topic was already settled — where
  the alternative is grading it against a question they had not heard.
- ~~**The kill switch restores auto-reply in the same move.**~~ **Retired
  2026-08-27 with the FSM refactor** — see the section above. The reasoning here
  was sound as far as it went (a state where nothing pushes and nothing
  auto-replies is a permanently silent room) but it took the wrong exit:
  `SCREENING_TOPIC_CONTROL=0` set `create_response: true` and handed the
  conversation back to the model, so the switch's off position reinstated the
  second controller this whole design exists to remove. Silence is now answered
  by the watchdog and by `FAILED`, both of which keep the app in charge.
- `SCREENING_PROMPT_VERSION` is `sc-v6`. The app still accepts `close_requested`,
  `follow_up_asked` and a `stamped` topic flag, because **workers deploy before
  the app** and an older one mid-rollout still speaks the old protocol. Nothing
  new should send them.

##### A finalized turn is not a finished answer (decision 2026-08-25)

Reported from the chair, mid-QA: *"it doesn't let me finish the answer"* — with
**time still on the counter**, which is what rules out the budget and points at
turn detection.

Turn detection runs on OpenAI's server-side VAD, so a beat of silence mid-answer
ends the turn and lands a finalized `ConversationItemAdded`. Under the push
protocol that item is the event that drives the entire call: the worker posts
`turn_completed`, the app settles the topic on what it has, and the next
question is asked. **So a detector that reads a thinking pause as an ending does
not merely interrupt somebody — it spends their topic on half an answer**, and
the rubric dimension behind that topic is then graded on the fragment they had
reached.

`eagerness: "low"` was the first attempt and is not enough on its own: it tunes
how long the DETECTOR waits, and the detector is reading one utterance rather
than deciding whether an ANSWER is over. Two additions finish the job, and both
are the worker declining to act for a moment:

- **The answer is held** (`ANSWER_SETTLE_MS`, 3s, `SCREENING_ANSWER_SETTLE_MS`
  to tune, `0` to switch off). If they start again inside the window it was one
  answer all along — `createAnswerAssembly` joins the fragments, the window is
  re-armed by each one, and nothing was spent. Their clock keeps running
  throughout, because it is still their minute, and **the budget expiring
  flushes the held answer as a `turn_completed` rather than an
  `answer_timeout`** — they answered; only the hold was still open.
- **The interviewer never starts a turn over the candidate** (`SPEAK_HOLD_MS`,
  10s). The window cannot cover the whole race: the evaluator is a
  three-to-five-second round trip, so somebody who resumes while it is in flight
  has already had their topic settled, and the worker would come back with a
  question and put it over the top of them. It costs more than rudeness —
  `interrupt_response` is on, correctly, so speaking across them gets the
  question CANCELLED partway through and the clock is then armed on a question
  they only half heard.

- **`flushAnswer` is the one place a turn becomes a `turn_completed`**, so the
  two things that can decide an answer is over — the window elapsing, the budget
  running out — cannot report it twice or report half of it. Pinned by a test.
- **The greeting reply is held, but for a second rather than three (revised
  2026-08-27).** A candidate who says "yes —" and keeps going must not be asked
  topic 1 over the top of themselves, so the hold stays — but "can you hear me?"
  is answered in one word, and the window an interview answer needs is pure dead
  air at the very top of the call. Reported from the chair as a delay after
  *"do you hear me"*, and it was about five seconds all in: this hold, plus
  transcription, plus the model generating the first question. A candidate who
  has just joined cannot tell a thinking interviewer from a broken one, and this
  is the moment they are most likely to decide it is broken.
  `greetingSettleMs` takes the SMALLER of the two, so switching the hold off
  switches it off everywhere and lengthening it for interview answers does not
  lengthen the one pause where a longer hold buys nothing. It still skips the
  evaluator: it is not an answer to anything.
- **A fragment is keyed on the question that was on the floor when they started
  speaking**, and one for a question the call has left behind starts a fresh
  answer rather than being appended — the same hazard `questionSeq` guards
  everywhere else.
- **The cost is dead air on every answer**, this window and then the evaluator
  behind it, and it is the honest price of not cutting people off. It is bounded
  from both ends: the hold can never outlive the question, and the override is
  clamped to 10s so a typo cannot turn a call into silence.
- **The budget is untouched at 60s.** The complaint was not that the minute was
  short; the counter still had time on it.
- **A pause no longer ends a barely-started answer; the candidate does
  (decision 2026-08-27).** A fixed window asks whether the UTTERANCE is over,
  and the ANSWER was being treated as over with it: somebody who said "I don't
  know." and paused to think had their topic settled on three words, with
  fifty-five seconds still showing on their screen. That is the counter
  promising a minute and a three-second pause spending it.

  `answerHoldMs` returns **`null`** below `SUBSTANTIAL_ANSWER_WORDS` (12) — no
  early settle at all, their countdown carries the answer and the budget
  expiring flushes whatever is held — and the ordinary window above it, so a
  normal call stays snappy. Re-read on every fragment, so somebody who opens
  with "Hmm." waits on their clock and drops to 3s the moment they have actually
  answered. The interviewer is forbidden from asking anything answerable with
  yes or no, so a handful of words is the START of an answer, not a short one.
- **That default is only affordable because of the "I'm done" button**
  (`SCREENING_DONE_TOPIC`, the one packet that travels browser → worker).
  Without it, somebody who genuinely finished in eight words sits through fifty
  seconds of unskippable silence watching a counter — and a screen that looks
  frozen is what makes people close the tab on a call that is nearly over. With
  it, the generous default costs nobody anything: a pause is never read as an
  ending, and anyone who has actually finished says so.
  - **It carries no content and could not be trusted with any.** The transcript
    is what the worker reported and the app decides every question, so the most
    a forged packet can do is end the sender's own answer early — which is the
    button's entire purpose.
  - **Best-effort.** If the packet never lands, the countdown runs to zero and
    the call moves on by itself, so a failure is a slower answer rather than a
    lost one. Nothing is surfaced to the candidate.
  - **Pressing it with nothing transcribed yet posts `answer_timeout`, not an
    empty turn.** That path already waits on the final-answer barrier, so words
    still in transcription are reported rather than lost.
  - **The button returns on a fresh minute, keyed on the number going UP.** The
    clock heartbeat re-sends the same value every five seconds, so keying on a
    packet merely arriving put the button back mid-answer, seconds after it was
    pressed.
- **This made a latent duplicate-report bug reachable, and it is now closed.**
  `ANSWER_TIMER_EXPIRED` while `awaitingBackend` used to return a CHANGED state
  (setting `budgetExpired`), and the side-effect pass — which is what posts —
  runs on any change. Two presses, or a press racing the budget, would have
  posted twice for one answer and come back as two questions, the second asked
  over the first. It now returns the state UNCHANGED, and the identity is the
  guard: the runner skips side effects when nothing moved. What is given up is
  bounded — a question arriving while they are still talking is held politely
  for up to `SPEAK_HOLD_MS` even though their minute has run out.

##### An answer we could not hear is counted, not scored as silence (decision 2026-08-28)

Found by reading production: **84% of every screening ever scored came out 0**,
and on 12 of 24 rubric-era calls the transcript held FEWER answers than the
interviewer asked questions. The clearest one is a whole call in four lines:

```
[0] AGENT: Hi Abdellah, can you hear me clearly?
[1] CANDIDATE: Yes.
[2] AGENT: <question 1>
[3] AGENT: "Merci pour ta réponse."   <- thanks for an answer that IS NOT RECORDED
[4] AGENT: goodbye
```

The candidate answered. The interviewer heard it and thanked them for it. The
transcript has nothing, so `extractTranscriptEvidence` honestly reported
`not_present` for every rubric dimension and the call scored **0**.

**The scoring was never at fault, and this is worth stating plainly because the
number looks exactly like a scoring bug.** Driving a real transcript through the
live pipeline scores it correctly — `very_strong` 100 × 0.6 + `strong` 80 × 0.4
= **92**, every quote verified against the candidate's own speech. The rubric
path has been live and correct since 2026-08-24. What failed is upstream of it.

**The cause is that the interviewer and the record come from two different
places.** OpenAI Realtime is speech-to-speech: the model understands the audio
NATIVELY, so the conversation carries on perfectly whatever else breaks. The
TEXT comes from a separate transcription sidecar (`gpt-4o-mini-transcribe`, the
plugin default), and when that fails the plugin logs an error and emits an
**empty** transcript — which `ConversationItemAdded` drops on `if (!text)
return`. Silently: no log, no counter, nothing that distinguishes it from a
candidate who said nothing.

- **The barrier already knew, and threw it away.** `createFinalAnswerBarrier`
  holds the only state that can tell "they said nothing" from "we failed to hear
  them" — speech observed against words arrived — and its own comment said *"A
  previous question's turn never arrived"* at the exact point of the loss. It
  now books that as a `LostAnswer` and warns `screening.worker.answer_unheard`
  with the application id. No new module: a second one tracking the same state
  is how the two drift.
- **The detection point is race-free, and that is why it is trusted.** Every
  path that could leave a transcript legitimately in flight has already been
  awaited by the time the candidate answers a NEW question — the timeout waits
  on this barrier before settling a topic, and the ordinary hand-off is driven
  BY the transcript item itself. So an outstanding older question at that moment
  is genuinely lost, not merely late.
- **It is counted per CALL, never attributed to a topic.** The worker only
  learns an answer was lost once the call has moved on, so `currentTopicId` by
  then is the wrong topic — and a stamp made in error is the one kind of mistake
  this area has twice learned nothing downstream can undo. `unheardAnswers` on
  the ledger is the honest unit.
- **`answer_unheard` is not a quieter `answer_timeout`.** That one says nobody
  spoke in the time allowed — a fact about the candidate. This says somebody DID
  and we lost it — a fact about us. They produce the same 0 and demand opposite
  readings of it.
- **It settles nothing, advances nothing, and touches no clock.** Writing our
  own outage onto a candidate's coverage record is the thing
  `applyEvaluatorFailure` already refuses to do; this follows the same rule.
  Fire-and-forget at the worker, because a candidate is mid-conversation and a
  report about a lost answer is not worth a round-trip of their time.
- **The recruiter is told before they read a number.** An amber notice sits
  ABOVE the rubric breakdown, says the score may be understated, says the
  failure is ours and not the candidate's, and points at the transcript or a
  fresh link — never at a rejection on a score we have just called unreliable.
- **It is a diagnostic and never an input.** Nothing in
  `src/lib/screening-scoring/` reads it, and no rule branches on it.

The count does **not** repair the score, and deliberately so: the words are gone
and inventing evidence for them is the one thing worse than the 0. What it buys
is that a 0 can no longer quietly mean two opposite things.

##### The minute is the minute (decision 2026-08-25)

Stated from the chair, as the rule: *"if that 1 min finished we move to the next
question, that is it."*

It did not. The budget expiring **armed a second timer** and sat on it until the
candidate stopped talking — `SCREENING_ANSWER_GRACE_MS`, 15s. So the deadline
the counter had been showing for a minute was not a deadline: a candidate still
going at zero got a quarter of an answer more than one who finished at 0:59, and
the person handed the extra time was by definition the one who had already used
all of theirs.

**Zero now moves the call on, whoever is talking**, and both halves of the wait
had to go or the grace comes back under another name:

- **The grace timer is deleted**, along with `moveOnPending`,
  `ANSWER_GRACE_MS` and `SCREENING_ANSWER_GRACE_MS`. A constant naming a rule
  that no longer exists is worse than no constant — the same reason
  `is_required` was dropped and Must-Have left the interview stage. A worker
  test asserts the app exports no grace, so it cannot come back on one side
  alone.
- **`budgetExpired` stands the politeness down.** The worker otherwise never
  starts a turn over the candidate (`SPEAK_HOLD_MS`), which is right for an
  answer that ended by itself and is exactly the removed wait when applied to an
  expiry. Set before the flush branch too: a held answer at zero is still an
  expiry.
- **It waits for words already SPOKEN, never for words not yet said.** The
  timeout is the one path where a timer rather than a transcript item moves the
  call on, so an answer finishing transcription can be outrun — they stopped at
  0:59, the item is milliseconds away, and posting a timeout over it would
  record a topic they answered as one they did not. A candidate **mid-sentence**
  at zero has nothing in flight, so that case skips the barrier entirely. Their
  words are not lost either way: every finalized item joins the transcript the
  scorer reads, whenever it lands.
- **The screen was changed in the same breath.** "Time's up — finish your
  thought and we'll move on" was an instruction the call no longer honours; it
  now reads "Time's up — moving on to the next question". A countdown that lies
  at zero is worse than either being strict or being generous.
- **What makes this fair is the counter, and only the counter.** The candidate
  watches the minute fall for its whole length, so nobody is cut off by a
  deadline they could not see coming. If the visible countdown is ever removed,
  this decision has to be revisited with it.
- **This is not in tension with holding a pause.** A pause INSIDE the minute is
  still not an ending — the fragments are one answer and the hold above still
  applies. The minute ending is a different event, and it ends the answer.

**Topic coverage is enforced at runtime, not asked for in a prompt (decision
2026-08-24).** "Cover every topic" used to be a sentence in
`buildScreeningInstructions` and nothing else: the interviewer was handed a
confidential numbered guide and told to raise all of it, and nothing observed
whether it did. That mattered more than a missed question usually would, because
the overall is the weighted mean over **every** rubric dimension and a dimension
with no evidence scores 0 — so a topic the interviewer *skipped* cost the
candidate exactly what refusing to answer it would have, for a decision nobody
made and nobody could see. `checkScreeningQuestionCoverage` could not catch it:
it runs at campaign creation, against the *question list*, not against the call.

The app now owns a **topic ledger** (`src/lib/screening/topic-ledger.ts`, pure)
recording per topic: status (`pending` | `in_progress` | `complete` |
`insufficient`), `askedAt`, follow-ups used, and a one-line evidence note. It is
persisted on `screening_question_responses.topic_state` and driven by the worker
through `POST /api/agent/screening/control` (`AGENT_API_SECRET`, same guard as
the other agent routes).

- **Two constraints decide the whole shape.** The Realtime model runs on OpenAI
  **server-side VAD**, so LiveKit never calls `onUserTurnCompleted` and the model
  is already generating its reply by the time a turn is finalized — **nothing can
  gate an individual response**. But a **function tool's result is fed back into
  the same generation**, so `end_interview()` returning a refusal genuinely stops
  a close. Tools are therefore the enforcement and `updateInstructions` is only
  steering. Do not "simplify" this into prompt text: the prose version is what
  was already there, and it is what failed.
- **`next_topic` is the only way to raise a topic**, and it returns the topic
  text — never an id. The interviewer is never given a UUID, so "never mention
  internal topic IDs" holds by construction rather than by instruction.
- **`end_interview` refuses while a question is still owed an answer** and
  answers with what to do instead. The refusal never explains itself: no "I
  forgot", no "the system requires". A candidate must only ever hear an
  interviewer thinking of one more thing to ask, or giving them a moment.

  **It refuses on two grounds, and the second was missing until 2026-08-25.**
  A topic still `pending` — never raised — has always blocked it. A topic
  `in_progress` — asked, and not yet answered — did not, which made the LAST
  question of every call the one most likely to be cut short:

  ```
  interviewer raises the final topic   -> answerDueAt armed, 60s, countdown on screen
  control block now reads "topics not yet raised: 0"
  interviewer calls end_interview      -> no pending topics, so ALLOWED
                                       -> answerDueAt nulled, countdown vanishes
  interviewer: "Goodbye!"              -> over a question nobody answered
  ```

  It also produced the wrap-up counter appearing "again and again" mid-call: an
  early allowed close leaves `outstandingTask` at `close` and `awaitingGoodbye`
  set for the rest of the call, so the counter armed, was cancelled by the
  candidate speaking, and armed again after every exchange. One bug, both
  symptoms.

  **`answerStartedAt` is the discriminator**, exactly as it is in
  `beginNextTopic`. Null means nothing has happened since the question was
  raised, so nobody has answered it — refuse. Non-null means they DID answer
  and the interviewer is closing ahead of the evaluator, which is the ordinary
  order (three to five seconds of OpenAI round-trip behind the conversation);
  refusing there would deadlock the close on our own latency.

  **Nothing is written on the refusal path** — no version bump, and above all
  not `answerDueAt`, so the minute keeps running straight through it.

  **The refusal has its own wording**, keyed on the directive coming back as
  `ask_follow_up`: *"they have not answered your last question yet — give them
  a moment"*, explicitly forbidding a repeat or rephrase. The topic-shaped
  refusal would have pointed the interviewer at the very question the candidate
  was in the middle of thinking about, and it would have re-asked it over them.
- **The evaluator (`services/screening-turn.ts`) advises; the rule decides.** It
  reports whether one answer needs a probe, and reconciles which topic an
  exchange actually covered — the self-healing net for an interviewer that
  raised a topic without calling the tool, which would otherwise deadlock the
  close guard forever. Its `nextAction` field is captured for the audit trail
  and **overridden** by `decideNextInterviewAction`. Candidate speech reaches it
  fenced and labelled untrusted.
- ~~**Follow-ups are a counted budget.**~~ **Follow-ups were REMOVED entirely
  (decision 2026-08-27)** — see "One question, one answer, the next question"
  below. Every answer settles its topic, however thin.
- **`SCREENING_WRAP_UP_RESERVE_MS` (60s) buys the last minute back.** Crossing
  it stops probes and raises whatever is left, once each. Since the per-answer
  budget landed this is carved out of `SCREENING_CALL_BACKSTOP_MINUTES` rather
  than out of the call, so it only ever matters on a call that has already gone
  wrong — but it still matters there: arriving at the backstop having raised the
  remaining topics beats arriving mid-sentence with three of them unasked.
- **`insufficient` is a coverage word, not a score.** Nothing in
  `src/lib/screening-scoring/` reads `topic_state`, and
  `extractTranscriptEvidence` still reads the WHOLE transcript per dimension —
  narrowing evidence to "that topic's answer" would recreate the per-question
  bug retired on 2026-08-22.
- **Every failure path resolves to a usable directive; a candidate is on the
  phone.** A dead evaluator retries once then settles the topic **`complete`**
  (not `insufficient` — our outage must not land on their file) and advances,
  degrading a whole broken call to "every topic asked once, no follow-ups,
  clean close". An unreachable control route sends the interviewer back to the
  guide in its own instructions, and **`end_interview` fails open — but not on
  the first blip** (bounded 2026-08-25). A refusal the app actually returned is
  always honoured.

  Failing open on the FIRST unreachable request ended interviews outright: one
  six-second timeout on the tool budget at question two of five closed the call,
  and because the worker sets `awaitingGoodbye` on that path — which overrides
  `decideClose`'s directive check — nothing downstream could stop it. Three
  topics went unasked and scored the candidate 0, for an outage of ours.
  `closeOnUnreachableApp` keeps the reason the fail-open was chosen (nobody is
  held in a room by a service of ours being down) without spending a whole
  interview on one blip:

  - the app already said `close` before it went dark → end the call; this is the
    ordinary goodbye that happened to race an outage;
  - otherwise refuse, up to `UNREACHABLE_CLOSE_REFUSAL_LIMIT` (**1**) times,
    then end it regardless. A blip costs one more topic; an outage costs the
    same one topic and then lets go.

  **The tool's answer and the wind-down come from ONE decision.** A tool that
  says "close the call warmly and stop" while the worker declines to wind down
  leaves the candidate sitting in a room after a goodbye — worse than either
  failure alone. A refused close also runs `applyControl(null, …)` so the
  degraded path hands over the topic guide; skipping that was right while the
  null branch always closed, but an interviewer told to carry on needs a list to
  carry on from.
- `SCREENING_PROMPT_VERSION` is `sc-v5`; `SCREENING_TOPIC_RULES_VERSION` is
  `v4_correctable_stamp` and is stored in the ledger. `topic_state` is NULL
  for every call taken before this and is not back-filled — a coverage record
  should show what was observed, not what today's code would have observed.
  `SCREENING_TOPIC_CONTROL=0` on the worker restores the previous behaviour
  exactly; it is an operational kill switch, not a feature flag, so it defaults
  **on**.

##### One question, one answer, the next question (decision 2026-08-27)

**Follow-up probes are gone from the screening call**, on both sides of the
wire. A call is now: ask the question, wait for the answer, ask the next one,
close. Nothing probes, nothing drafts a probe, nothing counts one.

What was deleted, and it is a lot: `maxFollowUpsForTopicCount` /
`TWO_FOLLOWUP_TOPIC_LIMIT`, `followUpsUsed` / `maxFollowUps` on every topic,
`applyFollowUpAsked` and the `follow_up_asked` control event,
`decideNextInterviewAction`'s probe branch, the evaluator's `needs_follow_up`
status / `follow_up_question` / `next_action` fields, the worker's
`ask_follow_up` move and its wording, and the control block's probe lines.

- **The prompt was the half that mattered.** *"After each answer, ask 1–2 SHORT,
  UNSCRIPTED follow-up questions"* was unconditional, needed no tool call, and
  fired three to five seconds ahead of the verdict that would have counted it —
  which is why the budget bounded nothing (`followUpsUsed` read 0 on calls
  carrying four probes). Removing the machinery without removing the invitation
  would leave the model probing exactly as before, with nothing left to observe
  it. The prompt now says so outright: *"Never probe, never ask a spontaneous
  follow-up."*
- **The cost is depth on a vague answer, and it is real.** What it buys is a
  call with nothing to reason about — the probe machinery was the single
  largest source of complexity in this area, and most of it existed to observe
  and correct probes the model asked without being told to. It also buys time:
  a probe spent a whole extra minute re-asking a topic already covered, and
  evidence for a rubric dimension is read from the WHOLE transcript, never from
  one answer.
- **`ask_follow_up` became `await_answer`.** The ledger returned `ask_follow_up`
  for ANY open topic, so it covered both "probe this thin answer" and "they have
  not spoken yet" — and a separate `awaitingAnswer` boolean existed only to tell
  them apart. With one meaning left, the task says it and the boolean is gone.
  The worker still accepts `ask_follow_up` as a synonym for a mid-rollout app.
- **The evaluator got smaller, and it is on the audio path.** The candidate
  hears it as the gap between their answer and the next question, so every field
  it is asked to write is latency they sit through. It now reports two statuses
  and a one-line summary, and nothing else.
- **`BACKEND_RESPONSE` lost its `kind`.** Every question is a topic now, so
  `topic_started` is posted unconditionally — there is no probe that must not
  burn one.
- **`enterWrapUp`'s `complete` branch was unreachable and is gone.** It read
  `evidenceSummary ? "complete" : "insufficient"`, and only the probe path ever
  left a topic open *with* evidence recorded on it.

##### The interviewer is never cut off mid-question (decision 2026-08-27)

Barge-in was on, on the reasoning that *"a candidate who talks over a question
is answering it, and cutting the interviewer off is correct"*. On a live call
they far more often are not: a cough, a backchannel, somebody else in the room.
And the cost of reading one of those as an answer is the worst failure this
worker has.

```
question starts playing -> topic_started already posted (the topic is spent)
candidate coughs        -> OpenAI cancels the response mid-sentence
                        -> the machine hands the floor over
cough is transcribed    -> assembled as their ANSWER, reported as turn_completed
                        -> the app settles the topic and sends the next question
```

They never heard the question, their minute armed on the half of it that played,
and the rubric dimension behind it is scored on a cough. What barge-in bought
was a candidate skipping a question they had already understood — a convenience,
against a silent wrong answer on somebody's file.

- **It takes TWO settings, because two different parties do the cancelling**,
  and the first was shipped alone and did not work — reported straight back from
  the chair as *"i still can interrupt it and talk while it speaks"*.
  - `interrupt_response: false` on OpenAI's turn detection stops the MODEL
    cancelling its own response when its server-side VAD hears speech.
  - `handle.allowInterruptions = false` on the `SpeechHandle` stops the
    FRAMEWORK, which runs its own interruption on top:
    `onInputSpeechStarted` calls `activity.interrupt()` unconditionally on every
    `input_speech_started` event, which stops the playout locally no matter what
    OpenAI was told. The only thing that stops THAT is
    `currentSpeech.interrupt(false)` throwing, which the caller wraps in a
    try/catch — the framework anticipates it, its own comment reading *"this
    is going to raise when allow_interruptions is False"*.
- **The option and the setter share a name and only the setter works.**
  `allowInterruptions` passed to the session or to `generateReply` is silently
  forced back to `true` for a RealtimeModel with server-side turn detection,
  with nothing but a log warning — so passing it reads as a guarantee and
  provides none. A contract test pins both working assignments and pins that the
  useless option is never passed.
- **Expect one framework error line per attempt**, worded as though it were
  impossible: *"RealtimeAPI input_speech_started, but current speech is not
  interruptable, this should never happen!"*. It is expected here; it is the
  sound of a question surviving a cough.
- **Turn DETECTION is untouched.** The worker still hears every word, and
  anything said over a question still reaches the transcript the scorer reads —
  evidence extraction works off the whole transcript, so a real answer given
  over the tail of a question still counts. It simply cannot end the question or
  be mistaken for the answer to it.
- **The flag alone is not enough; the machine had to stop handing over the
  floor.** `GREETING`/`ASKING` + `CANDIDATE_SPEECH_STARTED` used to enter
  `LISTENING`, which with an uninterruptible turn would have the machine believe
  it was listening while the interviewer was still talking — and, worse, would
  let the cough be assembled as the answer anyway, since the transcript handler
  assembles only while `LISTENING`. That guard is now the whole defence, so the
  transition is load-bearing rather than cosmetic.
- **Their minute still starts at `QUESTION_FINISHED`**, so somebody who talks
  over the tail gets the full sixty seconds from the moment the audio stops.
- **The goodbye redelivery is gone with it.** `goodbyeInterrupted` /
  `goodbyeRedelivered` recorded that a sign-off had been CANCELLED and owed the
  candidate a second one. It cannot be cancelled now, so the flag could only
  ever be a false positive — and "thanks, bye!" over the sign-off is the most
  natural thing a candidate says, which would have earned every polite one of
  them a redundant second goodbye. What survives is the part that mattered: the
  room does not close while they are talking.
- **The residual hole is small and named.** A cough that STARTS during the
  question but ENDS after it lands while the machine is listening, so it can
  still be assembled as the answer. The window is the length of the cough rather
  than the length of the question.

##### The goodbye may not end on a question, and the prompt is only half of that (decision 2026-08-27)

Reported from the chair: *"at the end it asks a follow-up and it submits."*

With `create_response: false` the model cannot start a turn, so exactly one turn
can speak at the end of a call — the **goodbye**, which the worker asks for. Its
words are still the model's, and closing an interview by inviting questions is
one of the strongest habits it has. So the sign-off ended *"…before we wrap up,
is there anything you'd like to add?"* — and that is the worst possible moment
for a question, because `GOODBYE_FINISHED` takes the machine straight to `DONE`,
`windDown` publishes `screening.finished`, and **the browser submits on that
packet**. The candidate is asked something real and hung up on mid-thought, and
what they were about to say reaches no transcript at all.

- **The prompt already forbade it, in the weakest available form.** *"Do not ask
  them anything further"* had been in `GOODBYE_INSTRUCTIONS` for the whole time
  the bug was live. A negation is a poor way to argue with a habit that strong,
  so the instruction is now positive — the last sentence must **be a
  statement** — names the two forms it actually took, and gives the impulse
  somewhere to go: a real question from the candidate is answered by the hiring
  team, by email.
- **And the prompt is still only the first half.** This is the same lesson as
  `next_topic` and `end_interview`: anything the product cannot afford to lose
  is driven from observable state, with the wording as the fast path.
  `endsOnAQuestion` reads the goodbye's own transcript turn at the moment its
  playout ends — an agent turn is finalized when its TEXT completes, which runs
  ahead of the audio, so the words are always there to read — and the room is
  held open (`CLOSING_ANSWER_MS`, 20s) instead of closing.
- **It reads the GOODBYE's own turn, never "the interviewer's last turn".** The
  obvious call is wrong by a hair of timing: an agent turn is finalized when its
  TEXT completes, which normally beats the end of its own audio — but on a run
  where it does not, the most recent interviewer turn is still the previous
  QUESTION, and a question ends in a question mark by definition. Every call
  would then hold its room open at the end, waiting for an answer to something
  asked and answered a minute ago. So `sayGoodbye` snapshots the transcript
  length before requesting the sign-off and reads only what came after
  (`interviewerTurnSince`). Nothing after it means the words never arrived,
  which is read as "no question asked" — the safe direction, because a miss
  costs a question the prompt already forbids while a false positive costs
  twenty seconds of dead air on every call that ever ends.
- **A trailing question mark, and nothing cleverer.** An open question is
  routinely an imperative ("Tell me about a time you disagreed"), and the
  interviewer is explicitly told to ask that way, so anything reading for intent
  would fire on half the questions on the call. The mark is read **only in the
  direction of waiting longer**: a false positive costs seconds of dead air on a
  call that is over, a false negative costs somebody their answer. Arabic and
  full-width marks count — the call settles into whatever language the candidate
  answered in, and an ASCII-only check would hold for English and quietly fail
  for every Arabic call.
- **Their answer ends the wait**, so a candidate who does answer never sits
  through the window. Bounded at two windows for one who never pauses, because
  dead air is not free either: a screen that looks frozen is what makes people
  close the tab on a finished interview, and nothing submits when they do.
- **And the close itself must not run over the candidate**, which is the half
  the first version missed. Reported from the chair: *"it asked the last
  question, I answered I DON'T KNOW, and instead of submitting it asks another
  follow-up question — while speaking it submits."* The ordinary end of a
  redelivery reaches it: the sign-off probes instead of closing, the candidate
  starts answering the probe, that cancels the turn, the redelivery branch runs
  FIRST (so `askedSomething` is never consulted), the second goodbye is spoken,
  they are still talking, and the second `GOODBYE_FINISHED` falls through to
  `beginDone` with `candidateSpeaking` still true. The browser submits on it,
  and what they were saying reached no transcript at all. `GOODBYE_FINISHED`
  now routes a speaking candidate into the same wait as a question — it was the
  last close in the machine that did not check who held the floor, and being
  terminal it was the most expensive one to get wrong. **A test was asserting
  the bug**: it drove two interruptions, never let the candidate stop, and
  expected `DONE`. Its real property — bounded at one redelivery, no loop — is
  kept; the close over a live speaker is not.
- **The prompt names the trigger, because "I don't know" is what produces it.**
  A non-answer is the strongest possible invitation for a model to help — to
  rephrase, offer a hint, try an easier angle — and that is what the "follow-up"
  was. The goodbye now says a short answer or a flat "I don't know" is complete,
  and to close exactly as it would after their best answer.
- **Answering the sign-off is not interrupting it.** `CANDIDATE_SPEECH_STARTED`
  in `FINISHING` sets `goodbyeInterrupted`, which re-says the goodbye once — the
  right reading for somebody talking OVER it, and exactly wrong for somebody
  answering the question it just asked. `awaitingClosingAnswer` separates them.
  An interrupted goodbye is still re-said first, and it is the RE-SAID one whose
  words are read for a question: the first was cut off, so what it would have
  ended on is unknown.
- **`beginDone` is now the single door into `DONE`**, because four things reach
  it — a delivered goodbye, a redelivered one, an answered closing question, and
  a window running out — and they must leave the same state behind.
- The nearest thing in the pull protocol was `CLOSE_ANSWER_SETTLE_MS` (*"its
  last words were a question — an answer is owed"*), retired with that protocol
  because the model could no longer start a turn. The hazard survived it: the
  worker stopped choosing *when* the interviewer speaks, never *what* it says.

##### The follow-up budget is spent by the interviewer, not asked for by the app (decision 2026-08-25, superseded 2026-08-27)

**Superseded — follow-ups no longer exist; see the section above.** Kept for the
reasoning, which is the clearest statement of why a prompt instruction is not a
bound.

The budget was a rule the code stated and never applied. `followUpsUsed` read
**0** on calls carrying four probes, `evaluateTurn` was told the whole allowance
remained, and the thing the budget exists to prevent — a call spending its
minutes improving one answer while topics nobody has raised score 0 — was
bounded by nothing at all.

Two causes, and the prompt is the larger one:

1. **The prompt ordered a probe after every answer.** *"After each answer, ask
   1–2 SHORT, UNSCRIPTED follow-up questions"* — unconditional, and paired with
   *"Follow-up probes are yours alone and need no tool"*. So the interviewer
   probed constantly, and never told anyone.
2. **The only path that spent a probe could not be reached.**
   `decideNextInterviewAction` spends one when the evaluator says
   `needs_follow_up` AND the topic is still open when that verdict lands. The
   interviewer calls `next_topic` about half a second after the candidate stops;
   `turn_completed` is an OpenAI round-trip three to five seconds behind it. So
   `beginNextTopic` settles the topic `complete` first and the verdict arrives
   to a closed topic, where it may only annotate. The suggested probe was
   discarded on every hand-off.

**The candidate felt the second half of this before anyone noticed the first.**
An improvised probe raised no topic and re-armed no clock, so it inherited
whatever was left of the PREVIOUS question's minute: somebody who spent fifty
seconds on their first answer got ten to answer the follow-up, with the counter
to match — or none at all, if the topic had already settled.

**The count now comes from the worker, which is the only party that can see a
probe happen.** `shouldCountFollowUp` reads: a topic is open, the candidate has
ALREADY answered it, and the turn that just ended asked something. That can only
be a probe. It posts `follow_up_asked`, and `applyFollowUpAsked` spends one from
the allowance and arms a fresh minute — the same rule the app applies to a probe
it asked for itself.

- **This is the pattern, not a new one.** A Realtime voice model will not call a
  tool because the prompt says to, so anything the product cannot afford to lose
  is driven from observable session state with the tool as a fast path. The
  stamp, the goodbye and the close all work this way; the probe count is the
  fourth.
- **`answerRunning` is the discriminator.** A question the candidate has not
  answered yet is the interviewer repeating or rephrasing itself. Counting it
  would exhaust the allowance without the candidate being asked anything new,
  and the fresh minute would reset on every restatement — the budget meaning
  nothing at all.
- **Mutually exclusive with the stamp by construction.** The stamp needs
  `ask_primary_question` (nothing open), this needs `ask_follow_up` (a topic
  open). One interviewer turn is one question and cannot be both; a test pins
  it, because a turn that both spent budget and burned a topic would be the
  worst of the two.
- **A misfire here is cheap, unlike the stamp's**, which is why it needs none of
  the rollback machinery. If the turn was really a new main topic asked without
  the tool, this spends one probe on a topic the reconciler is about to settle
  anyway. Nothing is burned and no question goes unasked.
- **The count is not capped.** An interviewer that asks a third probe against an
  allowance of two has asked three, and a record that capped the number would
  hide exactly the behaviour this event exists to make visible.

**The count is deliberately incomplete, and the gap is the evaluator's
latency.** A probe on a turn longer than that round-trip arrives to find its
topic settled, where `applyFollowUpAsked` is a no-op — the worker's stamp fires
instead, which is what still gets the candidate a minute and a countdown, and
`takeBackWrongStamp` credits the probe to the topic the reading names. So the
record is right in both orders; only the *steering* reaches the fast case, since
a settled topic has nothing left to steer.

**`SCREENING_PROMPT_VERSION` is `sc-v5`, and the prompt change is the load-bearing
half.** Probing is conditional again — it happens when an answer is vague,
generic or sounds read off a script, which the next line already said — and the
prompt no longer names a number: *"How many probes a topic may draw is counted
for you and is none of your concern."* `TWO_FOLLOWUP_TOPIC_LIMIT` is gone from
`realtime.ts` entirely; the allowance still comes from
`maxFollowUpsForTopicCount`, it is simply never narrated. This is the same
treatment pacing got in v4, for the same reason: a number this model cannot
count is not a bound, it is a suggestion.

The control block gained the state the old prompt had no way to reach — with the
allowance spent it says *"No probes left on this topic. Do not ask another — let
them finish, then move on to what you are given next."* A refusal with no
alternative is how the interviewer ends up improvising.

##### The stamp is a guess, and the evaluator may take it back (decision 2026-08-25)

`stampSkippedTopic` opens a topic when an interviewer turn ends on a question
with a primary question outstanding and no clock running. It exists because the
model ignores `next_topic`, and the clock lives in the same place as coverage —
`answerDueAt` is only ever set by opening a topic — so without it no answer on
such a call carries a deadline and the countdown never appears.

**It cannot hear WHAT was asked, and the interviewer's own prompt guarantees
most of those turns are follow-ups.** `buildScreeningInstructions` says
"Follow-up probes are yours alone and need no tool" and "after each answer, ask
1–2 short, unscripted follow-up questions". So the routine sequence is:

```
candidate answers topic 1
+0.3s  interviewer starts an improvised follow-up (no tool call)
+4s    the evaluator lands, settles topic 1 -> task becomes ask_primary_question,
       the clock is cleared
+5s    that follow-up turn ends -> stamped -> TOPIC 2 IS MARKED ASKED
```

Topic 2 was never spoken. The answer to the follow-up is filed against it,
`reconcileAddressedTopic` cannot rescue it (it only ever marks `pending` topics
raised, and topic 1 is already `complete`), and the rubric dimension behind
topic 2 scores **0** for a question nobody heard.

**So the stamp stays optimistic and becomes reversible.** `takeBackWrongStamp`
hands a topic back to `pending` when the turn evaluator reports the exchange
addressed a topic that is already settled while the ledger believes a
different, stamp-opened topic is in progress. That is the same division of
labour as everywhere else on this call: the worker acts on what it can observe,
the reading corrects it.

- **The worker says which topics were guesses.** `topic_started` carries
  `stamped: true` from the stamp path and nothing from either `next_topic`
  path; the ledger records it as `openedByStamp`. Only the worker knows how an
  event was raised. An older worker sends no flag, which reads as "the tool
  asked for it" — the direction that withholds a correction rather than
  inventing one.
- **A topic the tool asked for is never second-guessed.** That is a stated
  intention, not a guess.
- **Bounded by the WRAP-UP PHASE, not by a per-topic count**, and getting that
  wrong shipped a topic burn. It was one rollback per topic first, reasoning
  that a candidate whose answer wanders back to an earlier topic looks exactly
  like an interviewer probing one, so an unlimited correction would loop the
  call. That priced the trade backwards: **two long improvised probes in a row**
  — the interviewer's turn outrunning the evaluator twice — spent the allowance
  and burned the next topic outright, `complete` and never asked. A stall is the
  better failure and this file says so everywhere else: the topic stays
  `pending`, the close guard holds the call open, the block keeps handing the
  topic over, and whatever was said is still in the transcript the scorer reads.
  Correcting stops at wrap-up because its reserve exists to raise whatever is
  left, once each, and a rollback there would fight the one mechanism
  guaranteeing coverage — and because a stamp is far likelier to be genuine by
  then, the interviewer having been told to raise the remaining topics and
  nothing else. `rolledBack` stays as a record that it happened.
- **The clock goes back with it.** Nothing is outstanding once a question is
  un-asked, so a deadline left armed would time out an answer to a question
  that no longer exists.
- **Making the stamp reluctant instead was rejected.** Every gate that
  distinguishes a follow-up from a main question from session state alone also
  suppresses the stamp on the call it exists for — the one where `next_topic` is
  never called and every topic would otherwise run with no clock at all.

**`pendingDirective` is dropped by the stamp, in the same change.** It holds the
last evaluation's "ask topic N next", and the stamp is what OPENS topic N — so
serving the cache afterwards told the interviewer to ask a topic already marked
asked, while the background write advanced the ledger to N+1. The conversation
and the ledger then ran a topic apart for the rest of the call, each topic
settled by the answer to the one before it, and the last one never asked.

##### `ask_follow_up` also means "they have not answered yet" (decision 2026-08-25)

`currentDirective` returns `ask_follow_up` for **any** open topic, so it is what
the ledger reports in the seconds between a question being asked and the
candidate starting to speak — which is exactly when a late verdict on the
PREVIOUS topic lands and pushes a fresh control block. The block rendered
`Follow-up probes left on this topic: 2` at an interviewer whose candidate had
not drawn breath: an instruction to talk over somebody deciding what to say.

The ledger has always known the difference — `answerStartedAt`, which
`resolveCloseRequest` already uses to refuse a close over an unanswered
question, and which `endInterviewToolResult` already turns into "give them a
moment". The control block was the one place steering the interviewer that
could not see it.

- `ScreeningDirective.awaitingAnswer` carries that fact, and
  `buildInterviewControlBlock` renders "They have not answered this yet. Wait."
  in place of the probe lines — including the same "do not repeat or rephrase"
  the close refusal uses, so the two cannot drift.
- **It is not a new task value.** A directive that hands over a question or a
  probe is never awaiting an answer, so the flag is false on every
  `beginNextTopic` and every real follow-up. Adding a fourth `ScreeningTask`
  would have changed the wire enum the worker keys its stamp guard and its
  close refusal off, across two packages that deploy separately; an additive
  boolean leaves an older worker behaving exactly as it does today.

##### A guessed `complete` is corrected by the verdict that follows it

`beginNextTopic` settles the open topic `complete` the moment `next_topic`
arrives with an answer behind it, because reading the ordinary order as a
duplicate swallowed the next topic entirely. It has to guess, and it guesses in
the candidate's favour — but the verdict lands three to five seconds later and
knows what the answer was actually like. Leaving the guess standing recorded a
thin answer as `complete`, which is a lie in a record a person reads.

`annotateSettledTopic` now downgrades such a topic to `insufficient` when the
late reading says the answer was thin. **`complete` with no summary is the
signature of the guess, and only of it** — every other settle writes one,
including the two that must never be downgraded: the evaluator-failure fallback
(our outage stays off the candidate's file) and the wrap-up settle, which
records `insufficient` outright when it has nothing.

This is a coverage record, not a score: nothing in `src/lib/screening-scoring/`
reads `topic_state`, and the follow-up the verdict asked for is still not asked,
because the interviewer has already moved on. What changes is that the stored
record stops disagreeing with the transcript.
