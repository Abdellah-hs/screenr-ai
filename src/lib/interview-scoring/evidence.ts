import type { EvidenceLevel } from "@/lib/scoring/evidence-levels";

/**
 * What each level means in a full AI interview, as handed to the model.
 *
 * The ladder is shared with the resume and screening stages — a `strong` is
 * worth 80 everywhere, which is what lets a recruiter read two stage scores as
 * two readings rather than two different rulers. These DEFINITIONS are not
 * shared, and the difference from screening is deliberate rather than cosmetic.
 *
 * A voice screening is a short filter: the question it answers is "can this
 * candidate say something real about the work", so describing one example
 * properly is `strong` there. An interview is the deep stage — twenty minutes
 * of system design, technical Q&A or behavioural probing, with follow-ups — so
 * the same answer is only `partial` here. Reusing the screening wording would
 * hand out `strong` for clearing the filter's bar, and the two stages would
 * stop discriminating between candidates at exactly the point the interview
 * exists to discriminate.
 *
 * The direction of that difference matters and must not be reversed: the deeper
 * stage asks for MORE evidence per level, never less.
 *
 * Kept next to the stage's scorer so the prompt and the rules cannot drift, and
 * exported because the audit log records which wording produced a run.
 */
export const INTERVIEW_EVIDENCE_LEVEL_DEFINITIONS: Record<EvidenceLevel, string> = {
  not_present:
    "Nothing anywhere in the interview bears on this. The interviewer never reached it, or the candidate explicitly declined to answer.",
  unclear:
    "The candidate said something touching this, but it does not establish the competency — a deflection, a restatement of the question, or an answer too vague to tell whether they have done the work.",
  weak:
    "The candidate claims this but supplies nothing behind it: naming a technology, a pattern, or a responsibility without any account of what they actually did or why.",
  partial:
    "One concrete example, described at a surface level — what was built or what happened, without the reasoning behind it. Also: solid textbook knowledge with no evidence of having applied it.",
  strong:
    "A worked example the candidate clearly owned, with their REASONING visible: the constraints they were under, the options they weighed, what they chose and why. Answers follow-up questions without retreating to generalities.",
  very_strong:
    "Depth that holds up under pressure across the conversation — trade-offs argued both ways, failure modes and limits volunteered unprompted, decisions revisited with hindsight, or several substantial examples each carrying this competency.",
};
