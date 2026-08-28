import OpenAI from "openai";
import { z } from "zod/v4";
import { assertApiKeyConfigured } from "@/lib/services/openai";
import {
  coverageWithoutQuestions,
  reconcileCoverage,
  type CoverageDimension,
  type ScreeningCoverageResult,
} from "@/lib/screening/coverage";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const SCREENING_COVERAGE_MODEL = "gpt-4o-mini";

export const SCREENING_COVERAGE_PROMPT_VERSION = "v1_screening_coverage";

/**
 * A verdict for EVERY dimension, not a list of gaps.
 *
 * Asking only "which are missing?" made the model over-report badly: given
 * "walk me through the hardest production bug you've solved" it called
 * *Debugging method* uncovered, and given one question about designing for
 * rising traffic it credited only *System design* while calling *Scaling* and
 * *Performance* uncovered. Listing gaps lets a model skip the work of looking
 * for a match; being made to rule on each dimension, and to name the question
 * that covers it, forces it to go and find one first.
 *
 * `covering_question` is the 1-based index of a question. Requiring it is the
 * point — a "covered" verdict has to be attached to something real.
 *
 * Still no scores, no weights, no ranking. Only `appears_uncovered` verdicts
 * ever leave this module, and the wording is hedged because it is a reading.
 */
const CoverageResponseSchema = z.object({
  dimensions: z.array(
    z.object({
      dimension_id: z.string(),
      verdict: z.enum(["covered", "appears_uncovered"]),
      covering_question: z.number().nullable().optional(),
      reason: z.string(),
    }),
  ),
});

/**
 * Does the current question set give a candidate a reasonable chance to
 * demonstrate every rubric dimension?
 *
 * Advisory only, and structurally incapable of being anything else — it is
 * handed a rubric and a list of questions, never a candidate, a transcript or a
 * score. Nothing it returns reaches `src/lib/screening-scoring/`.
 *
 * The judgement asked of the model is semantic, which is exactly why it is a
 * model and not string matching: "Team communication" is covered by "tell me
 * about a disagreement with a teammate", and the two share no words at all.
 *
 * Deliberately asymmetric about what counts as a problem. A dimension with no
 * question is a problem, because it scores zero for every candidate. A question
 * that maps to no dimension is NOT a problem — "why do you want to work here"
 * is a reasonable thing to ask and is simply not part of the score. There is no
 * field in the response for the model to complain about one.
 */
export async function checkScreeningQuestionCoverage(params: {
  dimensions: CoverageDimension[];
  questions: { prompt: string }[];
}): Promise<ScreeningCoverageResult> {
  const dimensions = params.dimensions.filter((d) => d.name.trim().length > 0);
  const questions = params.questions.filter((q) => q.prompt.trim().length > 0);

  // Nothing to cover. Not a model's call to make.
  if (dimensions.length === 0) return { uncoveredDimensions: [] };

  // Nothing can be covered by nothing. Asking a model to confirm that invites
  // it to be agreeable about an empty list — the same reasoning that keeps a
  // silent transcript away from the scorer.
  if (questions.length === 0) return coverageWithoutQuestions(dimensions);

  assertApiKeyConfigured();

  const dimensionList = dimensions.map((d) => `- [${d.id}] ${d.name}`).join("\n");
  const questionList = questions.map((q, i) => `${i + 1}. ${q.prompt.trim()}`).join("\n");

  const response = await openai.chat.completions.create({
    model: SCREENING_COVERAGE_MODEL,
    // A configuration check should give the same answer twice.
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are reviewing the setup of a screening interview, BEFORE any candidate has been interviewed. You are not evaluating anybody.

You are given an evaluation rubric (the competencies candidates will be scored on) and the questions the interviewer will ask. For EVERY listed dimension you must answer ONE question:

  "If a candidate answered these questions, would any of them give them a natural opening to demonstrate this dimension?"

If yes — even partly, even as a side of a broader answer — the verdict is "covered", and you must name the question number that provides the opening. If you cannot point to a question, the verdict is "appears_uncovered".

BE GENEROUS. This is the most common mistake, so read these carefully:

- A question does NOT have to name the dimension. "Walk me through the hardest production bug you've solved" COVERS "Debugging method", because a candidate answering it will inevitably describe how they went about it. Do not mark it uncovered because the words "method" or "approach" are absent.
- A question does NOT have to be dedicated to the dimension. ONE question routinely covers SEVERAL. "Tell me about a system you designed that had to handle rapidly increasing traffic" covers "System design" AND "Scaling experience" AND "Performance" all at once — a candidate answering it would naturally speak to all three. Credit that one question for every one of them.
- Several questions may cover the same dimension. That is fine and not worth remarking on.
- "Tell me about a disagreement with a teammate and how you resolved it" covers "Team communication", "Collaboration", "Conflict resolution" and similar, despite sharing no words with any of them.

Only answer "appears_uncovered" when NO question in the list would give the candidate any natural opening to show the dimension. You are looking for an obvious hole — a competency nobody thought to ask about — not judging whether the questions are well written.

IMPORTANT — a question that matches no rubric dimension is NOT a problem and must never be reported. Questions about motivation, interest in the company or notice periods are legitimate and simply do not contribute to the score. You report dimensions with no question; you never report questions with no dimension.

You never score anyone, never rate a question's quality, never rank the dimensions, never suggest weights, and never return numbers other than the question index.

Return JSON in this exact format:
{
  "dimensions": [
    {
      "dimension_id": "string",
      "verdict": "covered" | "appears_uncovered",
      "covering_question": 1,
      "reason": "one sentence"
    }
  ]
}

Rules:
- exactly one entry per listed dimension, in the order given
- dimension_id must be copied verbatim from the listed ids
- when "covered", covering_question is the 1-based number of a question that provides the opening
- when "appears_uncovered", covering_question is null and the reason says what is missing, addressed to the recruiter who wrote these questions`
      },
      {
        role: "user",
        content: `## Rubric dimensions
${dimensionList}

## Screening questions
${questionList}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response for the screening coverage check");
  }

  const parsed = CoverageResponseSchema.parse(JSON.parse(content));

  // Only the gaps travel onward; a "covered" verdict has served its purpose by
  // forcing the model to look for a question before ruling. Every correction
  // that matters then happens in the pure layer: unknown ids dropped, omissions
  // read as covered, names taken from the rubric.
  const gaps = parsed.dimensions
    .filter((d) => d.verdict === "appears_uncovered")
    .map((d) => ({ dimension_id: d.dimension_id, reason: d.reason }));

  return reconcileCoverage(gaps, dimensions);
}
