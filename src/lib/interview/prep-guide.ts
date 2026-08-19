import { INTERVIEW_DURATION_MINUTES, type InterviewPersona } from "@/lib/constants";

/**
 * Content for the candidate-facing interview prep guide (`/prep/[token]`, I23).
 *
 * Pure and separate from the page so the one genuinely delicate decision here —
 * how much of the interviewer's stance to reveal — is written down once and
 * testable, rather than buried in JSX.
 */

export interface PrepSection {
  title: string;
  items: string[];
}

/**
 * What the candidate is told about the interviewer's stance.
 *
 * Deliberately describes the **experience**, never the tactic.
 * `PERSONA_DIRECTIVE` in `services/interview.ts` tells the agent things like
 * "when an answer sounds comfortable or well-rehearsed, push back on it
 * directly" — repeating that to the candidate is a coaching manual for
 * defeating the probe, and the probe is the whole point of an unscripted
 * follow-up.
 *
 * Saying nothing at all is the other bad option. A candidate who is pressed
 * hard with no warning reads it as hostility and performs worse for reasons
 * that have nothing to do with their ability, which makes the score less
 * informative rather than more. So: tell them what it will feel like, not how
 * to game it.
 */
const PERSONA_EXPECTATION: Record<InterviewPersona, string> = {
  neutral:
    "The interviewer keeps an even, professional tone throughout and will ask follow-up questions to understand your reasoning.",
  pressure:
    "Expect to be challenged. The interviewer will dig into the specifics behind your answers and may question your reasoning — that is the format, not a signal that anything is going badly.",
  collaborative:
    "The conversation is meant to feel like working a problem together. Thinking out loud is welcome, and so is changing your mind partway through an answer.",
  socratic:
    "The interviewer leads with questions rather than answers, and will keep going a layer deeper. It will not confirm whether you are on the right track — that is by design, not a bad sign.",
};

export function personaExpectation(persona: InterviewPersona): string {
  return PERSONA_EXPECTATION[persona];
}

export interface PrepGuide {
  sections: PrepSection[];
  durationMinutes: number;
}

/**
 * Everything the prep page renders, derived from the campaign's configuration.
 *
 * `roleTitle` is included in the copy because a guide that never names the role
 * reads like a form letter, and this is the last thing a candidate sees before
 * the interview.
 */
export function buildPrepGuide(params: {
  roleTitle: string;
  persona: InterviewPersona;
  durationMinutes?: number;
}): PrepGuide {
  const { roleTitle, persona, durationMinutes = INTERVIEW_DURATION_MINUTES } = params;

  return {
    durationMinutes,
    sections: [
      {
        title: "What to expect",
        items: [
          `A live, AI-led video interview for the ${roleTitle} role, lasting about ${durationMinutes} minutes.`,
          "There is no time slot to book — start whenever you are ready, before the deadline on your invitation.",
          personaExpectation(persona),
          "Questions are drawn from your own application, so expect to be asked about specific things you have actually worked on.",
          // Said plainly because it is the single most common candidate worry,
          // and because it is true: the call ends on a timer.
          `The interview ends automatically at ${durationMinutes} minutes, so lead with your strongest example rather than saving it.`,
        ],
      },
      {
        title: "Before you start",
        items: [
          "Use a desktop or laptop computer. The interview will not run on a phone or tablet.",
          "Use a recent version of Chrome, Edge, or Safari.",
          "Check your camera and microphone — both are required to begin.",
          "Find a quiet, well-lit room where you will not be interrupted.",
          "A stable internet connection matters more than a fast one.",
        ],
      },
      {
        title: "What is recorded",
        items: [
          // The 2026-08-04 decision, stated to the person it most affects.
          "Your video is not recorded or stored. The camera is live only.",
          "A written transcript of the conversation is kept and reviewed by the hiring team.",
          "The interview is monitored for integrity — for example, whether you leave the tab or someone else appears on camera. Findings are reviewed by a person, never acted on automatically.",
        ],
      },
      {
        title: "How to prepare",
        items: [
          "Re-read your own application. Being able to talk specifically about what you did, and why, matters more than anything else.",
          "Have concrete examples ready: what the situation was, what you decided, and how it turned out.",
          "Numbers help. Scale, timelines, and outcomes make an answer checkable.",
          "You do not need to prepare a script — you will be asked follow-ups, and a rehearsed answer is harder to follow up on than an honest one.",
        ],
      },
      {
        title: "If something goes wrong",
        items: [
          "If your connection drops, reopen the link from your invitation email.",
          "If your camera or microphone is blocked, check your browser's site permissions and reload.",
          "If the link no longer works, reply to your invitation email and the hiring team can send a new one.",
        ],
      },
    ],
  };
}
