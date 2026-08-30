"use server";

import { requireUserId } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { screeningCoverageInputSchema } from "@/lib/validations";
import { checkScreeningQuestionCoverage } from "@/lib/services/screening-coverage";
import type { ScreeningCoverageResult } from "@/lib/screening/coverage";

/**
 * Ask whether the current questions give candidates a chance to demonstrate
 * every rubric dimension.
 *
 * Advisory, and never persisted. It is deliberately given the rubric and the
 * questions as arguments rather than a campaign id, because the case that
 * matters most is the wizard — where neither has been saved yet and the
 * recruiter is still holding both on screen. There is nothing to look up.
 *
 * Rate-limited in its OWN bucket, not the shared `ai-generate` one. A coverage
 * check is triggered by editing, and a recruiter working through several
 * campaigns could otherwise spend their whole drafting allowance on checks —
 * leaving "Draft from the role" refusing to work for reasons they never
 * triggered and cannot see. Two kinds of call, two budgets.
 */
export async function checkScreeningCoverage(input: {
  dimensions: { id: string; name: string }[];
  questions: { prompt: string }[];
}): Promise<ScreeningCoverageResult> {
  const userId = await requireUserId();
  checkRateLimit(userId, {
    name: "screening-coverage",
    maxRequests: 20,
    windowMs: 5 * 60 * 1000,
  });

  const validated = screeningCoverageInputSchema.parse(input);

  return checkScreeningQuestionCoverage({
    dimensions: validated.dimensions,
    questions: validated.questions,
  });
}
