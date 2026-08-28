/**
 * The transcript: what was said, deduplicated, and kept durable at the app.
 *
 * The durable record of a screening is the transcript, and the browser submits
 * against the draft THIS worker reported — so an answer that never reaches the
 * app is an answer nobody scores. Reported after every turn rather than once at
 * the end, so a crashed worker or a dropped call loses at most the final turn.
 */

/**
 * The interviewer's last turn among those recorded since `from`, or null if it
 * has not said anything since.
 *
 * **Exists so the close reads the GOODBYE and never the question before it.**
 * "The interviewer's last turn" is the obvious thing to ask for and is wrong
 * here by a hair of timing: an agent turn is finalized when its TEXT completes,
 * which normally beats the end of its own audio — but only normally. On the run
 * where it does not, the last recorded turn is still the previous QUESTION, and
 * a question ends in a question mark by definition. Every call would then hold
 * its room open at the end, waiting for an answer to something that was asked
 * and answered a minute ago.
 *
 * So the close snapshots the transcript when it asks for the sign-off and reads
 * only what came after. Nothing after it means the goodbye's words never
 * arrived, which is read as "no question asked" — the room closes as it always
 * did. That is the safe direction: the cost of missing one is a question the
 * prompt already forbids, and the cost of a false positive is twenty seconds of
 * dead air on every call that ever ends.
 */
export function interviewerTurnSince(turns: TranscriptTurn[], from: number): string | null {
  for (let i = turns.length - 1; i >= Math.max(from, 0); i -= 1) {
    const turn = turns[i];
    if (turn && turn.role === "agent") return turn.text;
  }
  return null;
}

/**
 * Did the interviewer's turn end on a question?
 *
 * Read only at the close, where the answer decides whether the room may shut.
 * The sign-off is the last thing spoken and the browser submits when it ends,
 * so one that finishes "…anything you would like to add?" asks a real question
 * and then hangs up on the answer.
 *
 * **A trailing question mark, and nothing cleverer.** An open question is
 * routinely an imperative — "Walk me through the migration", "Tell me about a
 * time you disagreed" — and the interviewer is actively told to ask that way,
 * so reading a full stop as a goodbye is the mistake that costs somebody their
 * answer. The mark is the one signal that is not ambiguous, and it is only ever
 * read in the direction of waiting longer: a false positive costs seconds of
 * dead air on a call that is over, a false negative cuts a candidate off.
 *
 * Arabic and full-width marks count. This call settles into whatever language
 * the candidate answered in, so an ASCII-only check would hold for an English
 * call and quietly fail for every Arabic one.
 */
export function endsOnAQuestion(text: string | null): boolean {
  if (!text) return false;
  // Closing quotes and brackets sit outside the mark, so they are stripped
  // before the last character is read.
  const trimmed = text.trim().replace(/[)\]}"'»”’\s]+$/u, "");
  const last = trimmed.at(-1);
  return last === "?" || last === "؟" || last === "？";
}

/** Mirrors `VoiceTranscriptTurn` in the app (src/lib/data/screening-questions.ts). */
export interface TranscriptTurn {
  role: "agent" | "candidate";
  text: string;
  at: string;
}

export interface Transcript {
  /**
   * Fold in one finalized conversation item. Returns false if it has already
   * been recorded.
   *
   * LiveKit may redeliver an item. The app is idempotent on `event_id`, but the
   * turn list is not, and a duplicate would show the answer twice in the
   * transcript the scorer reads.
   */
  add(role: TranscriptTurn["role"], text: string, itemId: string): boolean;
  /** The interviewer's most recent turn, for the control report. */
  lastInterviewerText(): string | null;
  /** Everything recorded so far. */
  turns(): TranscriptTurn[];
  /** Resolves once every report queued so far has been delivered. */
  drain(): Promise<void>;
  /** Send everything once more, and wait for it. */
  flush(): Promise<void>;
}

export function createTranscript(options: {
  applicationId: string;
  /** Injectable, so the queueing can be tested without a network. */
  send?: (applicationId: string, turns: TranscriptTurn[]) => Promise<void>;
  now?: () => Date;
}): Transcript {
  const { applicationId, send = reportTranscript, now = () => new Date() } = options;

  const turns: TranscriptTurn[] = [];
  const seenItemIds = new Set<string>();
  // Serialized, so a fast exchange cannot interleave two overwrites out of
  // order and leave the app holding the older one.
  let reporting: Promise<void> = Promise.resolve();

  const queueReport = () => {
    const snapshot = [...turns];
    reporting = reporting.then(() => send(applicationId, snapshot));
  };

  return {
    add(role, text, itemId) {
      if (seenItemIds.has(itemId)) return false;
      seenItemIds.add(itemId);
      turns.push({ role, text, at: now().toISOString() });
      queueReport();
      return true;
    },

    lastInterviewerText() {
      for (let i = turns.length - 1; i >= 0; i -= 1) {
        const turn = turns[i];
        if (turn && turn.role === "agent") return turn.text;
      }
      return null;
    },

    turns: () => [...turns],
    drain: () => reporting,

    async flush() {
      await reporting;
      await send(applicationId, [...turns]);
    },
  };
}

/** Overwrite the draft at the app. Best-effort: a lost report costs one turn. */
async function reportTranscript(applicationId: string, turns: TranscriptTurn[]): Promise<void> {
  const origin = process.env.SCREENR_APP_ORIGIN;
  const secret = process.env.AGENT_API_SECRET;
  if (!origin || !secret) {
    console.error("SCREENR_APP_ORIGIN / AGENT_API_SECRET not configured; cannot report transcript");
    return;
  }
  if (turns.length === 0) return;

  try {
    const res = await fetch(`${origin}/api/agent/screening/transcript`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ application_id: applicationId, transcript: turns }),
    });
    if (!res.ok) {
      console.error(`transcript report failed (${res.status}) for ${applicationId}`);
    }
  } catch (err) {
    console.error("transcript report failed:", err instanceof Error ? err.message : err);
  }
}
