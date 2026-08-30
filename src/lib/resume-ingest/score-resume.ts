import type { SupabaseDb } from "@/lib/supabase/types";
import type { Json } from "@/types/database.types";
import { saveResumeScore } from "@/lib/data/candidates";
import {
  fetchCampaignScoringConfig,
  fetchActiveRubricVersion,
} from "@/lib/data/campaigns";
import {
  fetchCachedResumeEvidence,
  saveCachedResumeEvidence,
} from "@/lib/data/resume-evidence-cache";
import {
  extractResumeEvidence,
  RESUME_EVIDENCE_MODEL,
  RESUME_EVIDENCE_PROMPT_VERSION,
} from "@/lib/services/openai";
import {
  buildDeterministicResumeScore,
  buildNormalizedResumeDocument,
  buildResumeEvidenceCacheKey,
  resumeScoreRationale,
  sha256Hex,
  validateResumeEvidence,
  RESUME_SCORING_RULES_VERSION,
  type DeterministicResumeScoreResult,
  type ResumeScoringAudit,
} from "@/lib/resume-scoring";
import type { CampaignScoringConfig } from "@/lib/rules/resume-scoring";

export interface ResumeEvaluationOutcome {
  result: DeterministicResumeScoreResult;
  config: CampaignScoringConfig;
}

export interface EvaluateApplicationResumeArgs {
  /** Supabase client to use — admin (service-role) for session-less callers. */
  db?: SupabaseDb;
  applicationId: string;
  campaignId: string;
  candidateId: string;
  /** Campaign owner — needed to load the (owner-scoped) scoring config. */
  ownerUserId: string;
  parsedResume: Record<string, unknown> | null;
  /**
   * The original extracted resume text, when the caller still has it. Ingest
   * does; a re-score months later does not. Its presence strengthens quote
   * verification (quotes are checked against the real document rather than the
   * extractor's reading of it) and changes the cache key, so the two paths
   * correctly do not share cached evidence.
   */
  rawResumeText?: string | null;
  /** Tag persisted on the audit row (e.g. "apply_form", "rescore"). */
  source: string;
  /**
   * The campaign's scoring config and active resume rubric version, when the
   * caller already holds them.
   *
   * Both are keyed on the campaign alone and identical for every application
   * in it, so a caller scoring a whole campaign was paying four round-trips
   * per CANDIDATE for four facts about the campaign — `fetchCampaignScoringConfig`
   * is three queries on its own. Omitted, they are fetched here exactly as
   * before, so the single-application callers are unchanged.
   */
  campaignContext?: CampaignScoringContext;
}

/** The campaign-level facts every application in one campaign is scored against. */
export interface CampaignScoringContext {
  config: CampaignScoringConfig;
  rubricVersion: number | null;
}

/**
 * Load the campaign-level half of a resume evaluation, once.
 *
 * Exported so a caller scoring many applications can hoist it out of its loop
 * and hand it back through {@link EvaluateApplicationResumeArgs.campaignContext}.
 * Returns null when the campaign has no active resume criteria — the same
 * "nothing to evaluate against" that makes `evaluateApplicationResume` return
 * null.
 */
export async function loadCampaignScoringContext(
  campaignId: string,
  ownerUserId: string,
  db?: SupabaseDb,
): Promise<CampaignScoringContext | null> {
  const [config, rubricVersion] = await Promise.all([
    fetchCampaignScoringConfig(campaignId, ownerUserId, db),
    fetchActiveRubricVersion(campaignId, "resume", db),
  ]);
  if (!config || config.screening_criteria.length === 0) return null;
  return { config, rubricVersion };
}

/**
 * Evaluate one application's resume, end to end: build the document, get
 * evidence (cached or fresh), verify the quotes, score deterministically, and
 * persist the result with its audit trail.
 *
 * Lifted out of both callers — the ingest pipeline and the recruiter re-score
 * action — because a single flow with two entry points that drifted apart would
 * mean the same CV could be graded two different ways depending on how it
 * arrived. It NEVER transitions: it returns the result and the campaign config
 * so the rule layer decides and the caller executes (Control > AI > Data).
 *
 * Returns null when the campaign has no active resume criteria — there is
 * nothing to evaluate against, and inventing a verdict would be worse than
 * leaving the application unscored.
 */
export async function evaluateApplicationResume(
  args: EvaluateApplicationResumeArgs,
): Promise<ResumeEvaluationOutcome | null> {
  const { db, applicationId, campaignId, candidateId, ownerUserId, parsedResume, source } = args;

  const context =
    args.campaignContext ?? (await loadCampaignScoringContext(campaignId, ownerUserId, db));
  if (!context) return null;

  const { config, rubricVersion } = context;
  const criteria = config.screening_criteria;

  // One document, used for the prompt, for quote verification, and for the
  // cache key. See buildNormalizedResumeDocument on why they must be identical.
  const resumeText = buildNormalizedResumeDocument({
    parsed: parsedResume,
    rawText: args.rawResumeText,
  });
  const resumeTextHash = sha256Hex(resumeText);

  const cacheKey = buildResumeEvidenceCacheKey({
    normalizedResumeText: resumeText,
    criteria,
    rubricVersion,
    promptVersion: RESUME_EVIDENCE_PROMPT_VERSION,
    model: RESUME_EVIDENCE_MODEL,
    scoringRulesVersion: RESUME_SCORING_RULES_VERSION,
  });

  const cached = await fetchCachedResumeEvidence(cacheKey, db);
  const extraction =
    cached ??
    (await extractResumeEvidence({
      resumeText,
      criteria,
      jobDescription: config.description,
    }));

  if (!cached) {
    await saveCachedResumeEvidence(
      {
        cacheKey,
        campaignId,
        resumeTextHash,
        model: extraction.model,
        promptVersion: extraction.promptVersion,
        rulesVersion: RESUME_SCORING_RULES_VERSION,
        rubricVersion,
        systemFingerprint: extraction.systemFingerprint,
        rawOutput: extraction.rawOutput,
        evidence: extraction.evidence,
      },
      db,
    );
  }

  // Recomputed on every run, cache hit or miss, so a served result can never
  // predate the rules it claims to follow.
  const validated = validateResumeEvidence(extraction.evidence, criteria, resumeText);
  const result = buildDeterministicResumeScore(validated, criteria);
  const rationale = resumeScoreRationale(result, validated.extraction_summary);

  const audit: ResumeScoringAudit = {
    raw_model_output: extraction.rawOutput,
    model: extraction.model,
    prompt_version: extraction.promptVersion,
    system_fingerprint: extraction.systemFingerprint,
    normalized_resume_text_hash: resumeTextHash,
    rubric_version: rubricVersion,
    scoring_rules_version: RESUME_SCORING_RULES_VERSION,
    criteria: criteria.map((c) => ({ label: c.label, priority: c.priority })),
    cache_hit: cached !== null,
    extracted_evidence: extraction.evidence,
    validation_warnings: validated.warnings,
    deterministic_result: result,
    source,
  };

  await saveResumeScore(
    {
      applicationId,
      campaignId,
      candidateId,
      result,
      rationale,
      rubricVersion,
      audit: {
        model: extraction.model,
        promptVersion: extraction.promptVersion,
        rawOutput: extraction.rawOutput,
        systemFingerprint: extraction.systemFingerprint,
        inputSnapshot: audit as unknown as Json,
      },
    },
    db,
  );

  return { result, config };
}
