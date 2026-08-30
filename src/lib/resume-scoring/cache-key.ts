import { createHash } from "node:crypto";
import type { ResumeCriterion } from "./criteria";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface ResumeEvidenceCacheKeyInput {
  /** The exact document sent to the model (see buildNormalizedResumeDocument). */
  normalizedResumeText: string;
  criteria: ResumeCriterion[];
  rubricVersion: number | string | null;
  promptVersion: string;
  model: string;
  scoringRulesVersion: string;
}

/**
 * Identity of one extraction run: same key ⇒ the LLM would be asked exactly the
 * same question about exactly the same document, under the same rules.
 *
 * Every input that can change the answer is in here, and nothing that can't.
 * Criterion **ids are excluded on purpose** — re-saving a rubric mints new ids
 * for unchanged criteria, and keying on them would throw away every cached
 * result each time a recruiter edited an unrelated field. What identifies a
 * criterion is its label, its priority, and its position in the list, because
 * those are the three things the extraction prompt actually depends on.
 *
 * The rules version is in the key even though it does not affect extraction:
 * cached rows carry the deterministic result too, and a result computed under
 * older rules must not be served after the mapping changes.
 */
export function buildResumeEvidenceCacheKey(input: ResumeEvidenceCacheKeyInput): string {
  const payload = JSON.stringify({
    v: 1,
    resume: sha256Hex(input.normalizedResumeText),
    criteria: input.criteria.map((c) => [c.label.trim(), c.priority]),
    rubric_version: input.rubricVersion ?? null,
    prompt_version: input.promptVersion,
    model: input.model,
    rules_version: input.scoringRulesVersion,
  });

  return sha256Hex(payload);
}
