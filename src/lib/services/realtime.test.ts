import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildInterviewControlBlock,
  buildScreeningInstructions,
  buildScreeningTopicFallback,
} from "./realtime";

// The Realtime session itself now runs in the agent worker (LiveKit migration);
// what remains here — and what these tests pin — is the instruction composer,
// because the anti-gaming interview design lives in its wording.
describe("buildScreeningInstructions", () => {
  const questions = [
    { prompt: "Tell me about a hard scaling problem you solved." },
    { prompt: "What is your favorite tool and why?" },
  ];

  /** Past `TWO_FOLLOWUP_TOPIC_LIMIT`, so the budget has to tighten. */
  const sixQuestions = Array.from({ length: 6 }, (_, i) => ({
    prompt: `Topic number ${i + 1}?`,
  }));

  it("includes every question prompt as an internal topic", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toContain("Tell me about a hard scaling problem you solved.");
    expect(out).toContain("What is your favorite tool and why?");
  });

  /**
   * Replaces a test that asserted [required] / [optional] markers. Screening
   * has no must-have gate, and the overall is the weighted mean over EVERY
   * rubric dimension — so a topic the agent skips leaves whatever it graded
   * with no evidence and scores 0 against the candidate. Telling the
   * interviewer some topics were optional was telling it that costing someone
   * points was acceptable pacing.
   */
  it("tells the agent to cover every topic, with no optional ones", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).not.toMatch(/\[required\]|\[optional\]/);
    expect(out).toMatch(/scored exactly as though the candidate had nothing to say/i);
    // "never save a topic for the end" went with the cut-off it warned about.
    // Coverage is now guaranteed by the close guard rather than argued for by
    // pacing advice, so what the prompt must still carry is WHY it matters.
    expect(out).toMatch(/penalises them for your pacing, not for their answer/i);
  });

  /**
   * Who chooses the questions is the FIRST thing the prompt settles, because
   * every failure this stage has had came from the model believing it had a
   * say. It called `next_topic` zero times in 33 turns, it said goodbye rather
   * than calling `end_interview`, and it probed after every answer against a
   * budget of one.
   *
   * None of those instructions exist any more. The model cannot start a turn
   * (`create_response: false`), so the prompt no longer has to argue — its job
   * is to make sure that when the worker hands over a question, what comes back
   * is that question and nothing else.
   */
  it("tells the interviewer it chooses neither the question nor the moment", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toMatch(/You do NOT choose what to ask, and you do not choose when to speak/);
    expect(out).toMatch(/Never invent a question/);
    expect(out).toMatch(/One turn is one question/);
  });

  /** Nothing may ask the model to use a tool it no longer has. */
  it("names no tools", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).not.toContain("next_topic");
    expect(out).not.toContain("end_interview");
    expect(out).not.toContain("INTERVIEW CONTROL");
  });

  /**
   * The inline guide is what a worker driving the call itself — an older one,
   * or one with topic control switched off — still receives, so it must remain
   * self-sufficient.
   */
  it("hands a self-driving worker a complete topic guide", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toMatch(/Cover every one of these, one at a time, in order/);
    expect(out).toContain(questions[0]!.prompt);
  });

  /**
   * Withholding was tried under the pull protocol and was a disaster: the model
   * ignored the tool anyway and, still able to start turns, held a full-length
   * interview of INVENTED questions — five improvised, not one of the
   * recruiter's, scoring every rubric dimension 0 on a call that sounded fine.
   *
   * It is safe now for one reason only: the model cannot start a turn. An
   * interviewer with nothing to ask says nothing — which the worker's silence
   * watchdog recovers — rather than making something up. That restores
   * docs/voice-screening.md mitigation #2.
   */
  it("withholds the topic list when the app pushes each question", () => {
    const out = buildScreeningInstructions({ questions, withholdTopics: true });

    for (const q of questions) expect(out).not.toContain(q.prompt);
    expect(out).toMatch(/You have no topic list, and you do not need one/);
    expect(out).toMatch(/handed each one, in order, at the moment you are to ask it/);
  });

  /**
   * It still knows HOW MANY, because the alternative is an interviewer that can
   * say nothing at all about the shape of the call. It must not know what they
   * are.
   */
  it("tells the agent how many topics the call has without naming them", () => {
    const out = buildScreeningInstructions({ questions, withholdTopics: true });

    expect(out).toContain(`${questions.length} topics to cover`);
  });

  /**
   * The safety net for the above: a worker that has lost the app has nothing to
   * hand over, and an interviewer with no list would improvise a full call that
   * evidences no rubric dimension, scoring every one of them 0 — worse than the
   * gap this feature closes. The worker holds this in reserve and injects it
   * only on a control failure.
   */
  it("offers the guide separately as a fallback block", () => {
    const fallback = buildScreeningTopicFallback(questions);

    for (const q of questions) expect(fallback).toContain(q.prompt);
    expect(fallback).toMatch(/never mention or read it aloud/i);
    expect(fallback).toMatch(/only while the interview cannot be steered for you/i);
  });

  /**
   * The interviewer was flipping between Arabic, French and English inside one
   * call. The original rule — "if they answer in a different language from your
   * greeting, switch to theirs" — was re-evaluated every turn, so a candidate
   * who code-switches (normal in Morocco, and normal anywhere multilingual)
   * made "the language the candidate speaks" a different answer each time they
   * opened their mouth. Locking it to their FIRST answer fixed the flipping and
   * left the choice with the model, which then made it BEFORE they spoke: given
   * their name and a summary of their CV, it inferred French and greeted a
   * candidate who wanted English in French.
   *
   * The candidate chooses now. The interviewer asks in the greeting and is told
   * the answer on every subsequent turn, so it has no language decision left to
   * make or to drift on.
   */
  it("leaves the language to the candidate rather than deciding it", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toMatch(/you do not choose it, you are TOLD it/);
    expect(out).toMatch(/picked it before this call opened/);
    expect(out).toMatch(/Never decide it from their name, their CV/);
    // The rules it replaced, both of which put the choice back on the model.
    expect(out).not.toMatch(/decide once, then never change/);
    expect(out).not.toMatch(/FIRST real answer/);
    expect(out).not.toMatch(/switch to theirs and stay there/);
  });

  /**
   * The greeting asks which language they want, so a blanket ban on the subject
   * forbids the one question the call opens with. It is allowed exactly once,
   * and closed off immediately after.
   */
  it("never asks the candidate about language, having been told", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toMatch(/Never raise the subject of language at all/);
    expect(out).toMatch(/they already chose, on the page before this call/);
  });

  it("treats mixing languages mid-sentence as speech, not as a request to switch", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toMatch(/NOT a request for you to switch/);
  });

  /**
   * The second cause, and a regression from the tool protocol: topics used to
   * be read once at the start, and now arrive mid-call as fresh English text
   * from `next_topic` — right after the interviewer may have settled into
   * another language. A realtime model reads new English as a cue to speak it.
   */
  it("says English topic text is storage, not the language to speak", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toMatch(/reach you in English/);
    expect(out).toMatch(/Receiving English text never changes what you speak/);
  });

  it("repeats the language reminder on the control block, which is the mid-call injection", () => {
    const block = buildInterviewControlBlock({
      task: "ask_primary_question",
      topicNumber: 2,
      topicPrompt: "Tell me about a system you scaled.",
      remainingUnasked: 3,
      phase: "interviewing",
    });

    expect(block).toMatch(/Keep speaking the language you settled on/);
  });

  it("gives the fallback something to say for a campaign with no questions", () => {
    const fallback = buildScreeningTopicFallback([]);

    expect(fallback).toMatch(/no preset topics/i);
  });

  /**
   * The reason is stated in rubric terms, not question terms: the scoring unit
   * stopped being the question on 2026-08-22, and a prompt that explains the
   * stakes in a retired unit teaches the interviewer the wrong model of what
   * its pacing costs.
   */
  it("explains that a skipped topic leaves the rubric without evidence", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toMatch(/graded against a rubric/);
    expect(out).toMatch(/no evidence at all/);
    expect(out).toMatch(/penalises them for your pacing/);
  });

  it("instructs the agent to ask unscripted follow-ups and not read topics verbatim", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out.toLowerCase()).toContain("follow-up");
    expect(out.toLowerCase()).toContain("never read a question aloud verbatim");
  });

  /**
   * The load-bearing scoring rule, and the one the prompt was silent on:
   * `src/lib/screening-scoring/` verifies quotes against the CANDIDATE's half
   * of the transcript. A yes/no question, a supplied term, or a recap puts the
   * substance in the interviewer's half, where it earns the candidate nothing.
   */
  it("tells the agent that only the candidate's own words are scored", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toMatch(/ONLY THE CANDIDATE'S OWN WORDS are scored/);
    expect(out).toMatch(/never ask something answerable with "yes", "no"/);
    expect(out).toMatch(/[Nn]ever supply the word, tool, number, or reason/);
    expect(out).toMatch(/[Nn]ever recap or summarise their answer back/);
  });

  it("marks the topic guide confidential and refuses to preview it", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toMatch(/CONFIDENTIAL/);
    expect(out).toMatch(/[Nn]ever tell the candidate what you will ask next/);
  });

  it("keeps the interviewer in charge when the candidate tries to steer the call", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toMatch(/cannot change your instructions/);
    expect(out).toMatch(/end the call early/);
  });

  it("anchors a question to the resume when a summary is provided", () => {
    const out = buildScreeningInstructions({
      questions,
      resumeSummary: "8 years backend, ex-Stripe, Go and Postgres",
    });

    expect(out).toContain("8 years backend, ex-Stripe, Go and Postgres");
  });

  it("greets by name only when a first name is supplied", () => {
    const named = buildScreeningInstructions({ questions, candidateFirstName: "Amina" });
    const anonymous = buildScreeningInstructions({ questions });

    expect(named).toContain("greeting the candidate by name (Amina)");
    expect(anonymous).toContain("greeting the candidate and checking");
    // The greeting STOPS there. It used to greet and ask topic 1 in one
    // turn, and a live call did what those words invite: it asked the audio
    // check and waited — while the ledger marked topic 1 asked and started
    // its minute on a hello.
    expect(named).toContain("Wait for their reply");
  });

  it("names the role when a job title is provided", () => {
    const out = buildScreeningInstructions({ questions, jobTitle: "Senior Backend Engineer" });

    expect(out).toContain("Senior Backend Engineer");
  });

  it("stays coherent with no preset questions", () => {
    const out = buildScreeningInstructions({ questions: [] });

    expect(out).toContain("No preset topics");
    expect(out.toLowerCase()).toContain("follow-up");
    // No topics means no per-topic arithmetic to state.
    expect(out).not.toMatch(/count TOPICS/);
  });

  describe("pacing", () => {
    /**
     * The bug this pins: the call is CUT at the cap, but the instructions asked
     * for two follow-ups on each of up to eight topics — 24 exchanges in five
     * minutes. The candidate was cut off with topics unasked, and each one
     * scored 0.
     */
    /**
     * The prompt used to scale the probe count itself — "1-2" below
     * `TWO_FOLLOWUP_TOPIC_LIMIT` and "exactly ONE" above it. It was the wrong
     * place for the number twice over: the instruction was unconditional, so it
     * asked for a probe after every answer whether or not one was warranted,
     * and the model cannot count, so neither figure bounded anything. Four
     * probes on one topic came out of the topics behind it.
     *
     * There is no count to narrate at any call size now: follow-ups themselves
     * are gone (2026-08-27), so the prompt says the same thing either way — one
     * question, one answer, and never a probe.
     */
    it("narrates no probe count at any call size", () => {
      const few = buildScreeningInstructions({ questions });
      const many = buildScreeningInstructions({ questions: sixQuestions });

      for (const out of [few, many]) {
        expect(out).not.toMatch(/1–2 SHORT/);
        expect(out).not.toMatch(/exactly ONE SHORT/);
        expect(out).not.toMatch(/how many follow-ups/i);
        expect(out).toMatch(/Never probe, never ask a spontaneous follow-up/i);
      }
    });

    /**
     * The 2026-08-24 change. Pacing moved onto each ANSWER — enforced by the
     * ledger and the worker's timer — so the call has no global clock at all.
     *
     * The prompt must not threaten one. The old text promised the call would be
     * "CUT OFF automatically after N minutes, mid-sentence if it comes to
     * that", which was true then and is a lie now: nothing cuts a behaving call
     * short. An interviewer told it is racing a clock that does not exist will
     * hurry a candidate for no reason, and hurrying costs the candidate the
     * evidence their score is made of.
     */
    it("never threatens a cut-off the call no longer has", () => {
      const out = buildScreeningInstructions({ questions: sixQuestions });

      expect(out).not.toMatch(/CUT OFF/i);
      expect(out).toContain("there is NO clock on this call");
    });

    it("tells the interviewer not to manage time at all", () => {
      const out = buildScreeningInstructions({ questions });

      // It is the one participant that cannot perceive time. Every instruction
      // that asked it to manage time produced hurrying instead of pacing.
      expect(out).toContain("Do not manage time");
      expect(out).toContain("NEVER rush the candidate");
    });

    /**
     * The per-topic seconds budget is gone with the clock it was carved out of.
     * A budget stated in seconds was always fiction — a realtime model cannot
     * count them — and now there is nothing to divide up in the first place.
     */
    it("states no per-topic time budget", () => {
      const out = buildScreeningInstructions({ questions: sixQuestions });

      expect(out).not.toMatch(/seconds each/);
      expect(out).not.toMatch(/count TOPICS, not minutes/);
    });

    /**
     * Nothing in the interviewer's instructions may quote a duration. There is
     * no longer a single number that would be true for a whole call, and a
     * figure here would be one the candidate's screen does not agree with —
     * which is exactly the drift that produced the original guillotine.
     */
    it("quotes no duration to the interviewer", () => {
      for (const set of [questions, sixQuestions]) {
        const out = buildScreeningInstructions({ questions: set });
        expect(out).not.toMatch(/\d+\s*(?:[–-]\s*\d+\s*)?minutes?/);
      }
    });

    it("tells the interviewer that moving on is handled for it", () => {
      const out = buildScreeningInstructions({ questions });

      // The worker moves the ledger on when an answer runs past its budget.
      // The interviewer has to know a topic can change under it WITHOUT
      // treating that as something to explain, apologise for, or announce.
      expect(out).toContain("you will simply be handed the next question");
      expect(out).toMatch(/never apologise for it, never refer to time/i);
    });

    /**
     * The candidate sees a countdown PER ANSWER and none for the call.
     *
     * The distinction is the whole design. A call-level clock made one topic's
     * slowness fall on a later topic, which then went unasked and scored zero.
     * An answer-level clock's cost lands on the answer that ran long, and the
     * candidate can see it coming and wrap up — which is what makes the short
     * 15s grace fair rather than brutal.
     *
     * So: the backstop stays a bare timeout with nothing rendered from it, and
     * the visible clock is whatever the worker publishes rather than anything
     * this component derives for itself. A countdown computed locally from a
     * call budget is exactly the regression to catch.
     */
    it("shows a per-answer countdown and no call countdown", () => {
      const component = readFileSync(
        join(process.cwd(), "src/components/realtime/voice-screening.tsx"),
        "utf8",
      );
      const page = readFileSync(
        join(process.cwd(), "src/app/respond/[token]/page.tsx"),
        "utf8",
      );

      // The backstop is armed once and never rendered.
      expect(component).toContain(
        "const backstopMs = SCREENING_CALL_BACKSTOP_MINUTES * 60_000;",
      );
      expect(component).toContain("setTimeout(handleTimeUp, backstopMs)");
      expect(component).not.toMatch(/formatClock\(backstop/);
      expect(component).not.toMatch(/secondsLeft/);

      // The visible clock is the worker's, received over the data channel and
      // anchored locally — never computed here from a call-length constant.
      expect(component).toContain('const SCREENING_ANSWER_TOPIC = "screening.answer"');
      expect(component).toContain("answerClockRef.current =");
      // Anchored to the moment the packet ARRIVED, carrying the remaining time
      // rather than an absolute deadline, so a candidate whose system clock is
      // wrong still sees the right number.
      expect(component).toContain("{ remainingMs, at: Date.now(), paused:");
      expect(component).toContain(
        'typeof packet.remainingMs === "number" ? packet.remainingMs : null;',
      );

      expect(page).toContain("questionCount={ctx.questions.length}");
    });

    /**
     * The interviewer must be given the recruiter's actual questions.
     *
     * `deferTopicsToTool` withheld them so that `next_topic` would be the only
     * way to learn them — the theory being that removing the easier path would
     * force the tool. It did not. The model called the tool zero times and,
     * with a prompt telling it "your topics are NOT listed here, you cannot
     * guess them", held a full-length interview of INVENTED questions. A live
     * call asked five improvised questions and not one of the recruiter's,
     * which would have scored every rubric dimension 0 on a conversation that
     * sounded perfectly good.
     *
     * An interviewer with the real questions and no tool call is recoverable —
     * the worker stamps coverage itself. An interviewer with no questions is
     * not recoverable at all.
     */
    it("withholds the list, because the app hands over every question", () => {
      const worker = readFileSync(
        join(process.cwd(), "agents/screening/src/agent.ts"),
        "utf8",
      );

      // **Always withheld now** (state-machine refactor, 2026-08-27). It used
      // to be conditional on `SCREENING_TOPIC_CONTROL`, whose off position
      // handed the call back to the model and therefore needed the list inline.
      // That switch is gone: an interviewer that cannot start a turn cannot
      // improvise, and one with no directive to speak fails visibly instead.
      expect(worker).toContain('"&topics=tool"');
      expect(worker).toContain("async function fetchInstructions(applicationId: string)");
    });

    /**
     * The counter never shares the screen with the interviewer's own voice.
     *
     * A clock ticking at the candidate while it is not their turn is the screen
     * disagreeing with the call, and under the pull protocol it took real
     * machinery to prevent — a running budget had to be paused when the
     * interviewer started speaking and restored with exactly what was left,
     * because a follow-up re-armed the clock from `turn_completed`, which lands
     * while the interviewer is still asking.
     *
     * None of that is needed now, and the reason is worth recording: a clock is
     * only ever armed at the END of an asking turn, so one can never be running
     * underneath the interviewer in the first place. What survives is the
     * DISPLAY half — the minute that is coming, shown standing still — because
     * a counter that simply disappears for the whole of every question is
     * absent for most of a screening call, which is how a candidate ends up
     * reporting there is no countdown at all.
     */
    it("shows the coming minute frozen while the interviewer is asking", () => {
      const worker = readFileSync(
        join(process.cwd(), "agents/screening/src/agent.ts"),
        "utf8",
      );

      // Published paused for the whole asking turn...
      expect(worker).toContain(
        "publishClock(ANSWER_BUDGET_MS, false, `asking q${state.questionSeq}`, true);",
      );
      // ...and started only once that turn has actually been spoken, which the
      // machine records as `questionDelivered` — set by `QUESTION_FINISHED` and
      // by nothing else.
      expect(worker).toContain("publishClock(budget ? ANSWER_BUDGET_MS : null, false, why);");
      const machine = readFileSync(
        join(process.cwd(), "agents/screening/src/machine.ts"),
        "utf8",
      );
      expect(machine).toContain("return beginListening(state, { questionDelivered: true });");

      // And the browser must hold it there rather than tick it down.
      const component = readFileSync(
        join(process.cwd(), "src/components/realtime/voice-screening.tsx"),
        "utf8",
      );
      // A paused clock reports the number it was given; only a running one
      // has the elapsed time taken off it.
      expect(component).toContain("clock.paused");
      expect(component).toContain(
        "Math.max(0, clock.remainingMs - (Date.now() - clock.at))",
      );
      expect(component).toContain("starts when they finish asking");
    });
  });
});

describe("buildInterviewControlBlock — a question that is still open", () => {
  const base = {
    topicNumber: 2,
    topicPrompt: "Tell me about a system you scaled.",
    remainingUnasked: 1,
    phase: "interviewing" as const,
  };

  /**
   * **`await_answer` is the only thing an open topic can mean now** (decision
   * 2026-08-27). It used to be `ask_follow_up`, which the ledger reported for
   * ANY open topic — including the seconds between a question being asked and
   * the candidate starting to answer, which is exactly when a late verdict on
   * the PREVIOUS topic lands and pushes a fresh control block. The block then
   * rendered "Follow-up probes left on this topic: 2": an instruction to probe
   * somebody who had not drawn breath yet.
   */
  it("tells the interviewer to wait, and never to probe", () => {
    const block = buildInterviewControlBlock({ ...base, task: "await_answer" });

    expect(block).toMatch(/They have not finished answering this yet\. Wait\./);
    expect(block).not.toMatch(/probe/i);
    expect(block).not.toMatch(/follow-up/i);
  });

  /** Never re-ask the question they are thinking about. */
  it("forbids repeating the question they are thinking about", () => {
    const block = buildInterviewControlBlock({ ...base, task: "await_answer" });

    expect(block).toMatch(/[Dd]o not repeat or rephrase the question/);
  });

  /** A directive handing over a question says nothing about waiting. */
  it("says nothing about waiting when there is a question to ask", () => {
    const block = buildInterviewControlBlock({ ...base, task: "ask_primary_question" });

    expect(block).not.toMatch(/Wait\./);
    expect(block).toMatch(/Tell me about a system you scaled\./);
  });
});

describe("nothing invites a follow-up any more", () => {
  const questions = [
    { prompt: "Tell me about a hard scaling problem you solved." },
    { prompt: "What is your favorite tool and why?" },
  ];

  /**
   * **The prompt is the half that mattered** (decision 2026-08-27).
   *
   * "After each answer, ask 1–2 SHORT, UNSCRIPTED follow-up questions" told the
   * interviewer to probe every single time — unconditionally, with no tool
   * call, and three to five seconds ahead of the verdict that would have
   * counted it. That is why the old budget bounded nothing: the ledger read
   * `followUpsUsed: 0` on calls carrying four probes.
   *
   * Removing the machinery without removing the invitation would leave the
   * model probing exactly as before, with nothing left to observe it.
   */
  it("never tells the interviewer to probe", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).not.toMatch(/After each answer, ask/);
    expect(out).not.toMatch(/1–2 SHORT/);
    expect(out).not.toMatch(/exactly ONE SHORT/);
    expect(out).not.toMatch(/how many follow-ups a topic gets/i);
  });

  /** Said outright, so there is no room to infer permission from silence. */
  it("forbids it in as many words", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toMatch(/Never probe, never ask a spontaneous follow-up/i);
    expect(out).toMatch(/One question, one answer, then the next question/i);
  });
});