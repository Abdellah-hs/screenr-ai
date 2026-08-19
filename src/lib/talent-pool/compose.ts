import type { TalentPoolEntry } from "@/lib/constants";
import type {
  PooledCandidateEvidenceRow,
  TalentPoolEntryRow,
} from "@/lib/data/talent-pool-entries";

/**
 * Assemble curated entries and the applications behind them into the shape the
 * pool page searches over.
 *
 * Pure so the interesting decisions — what "best score" means, which resume's
 * skills win, what happens when the evidence has gone — are testable without a
 * database. The data layer fetches; this decides what the fetched rows mean.
 */

/** The parsed-resume fields the pool reads. Everything else is ignored. */
interface ParsedResumeFragment {
  headline?: unknown;
  skills?: unknown;
}

function readParsed(value: unknown): { headline: string | null; skills: string[] } {
  if (!value || typeof value !== "object") return { headline: null, skills: [] };

  const parsed = value as ParsedResumeFragment;
  const headline = typeof parsed.headline === "string" && parsed.headline.trim()
    ? parsed.headline.trim()
    : null;
  const skills = Array.isArray(parsed.skills)
    ? parsed.skills.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];

  return { headline, skills };
}

/**
 * The highest number this application produced at any stage.
 *
 * Stage scores are independent by design and there is no composite — this is
 * not one. It is "the best they have ever done", which is the only sensible
 * axis for a range filter over a history where different people stopped at
 * different stages: comparing someone's resume score to someone else's
 * interview score would be worse, and comparing nothing at all leaves the
 * 3.11.2 filter with no field to bind to.
 */
function bestOf(row: PooledCandidateEvidenceRow): number | null {
  const scores = [row.resume_score, row.screening_q_score, row.interview_score].filter(
    (s): s is number => typeof s === "number",
  );

  return scores.length > 0 ? Math.max(...scores) : null;
}

export function composeTalentPoolEntries(
  entries: TalentPoolEntryRow[],
  evidence: PooledCandidateEvidenceRow[],
): TalentPoolEntry[] {
  // Evidence arrives newest-first, so the first row seen for a candidate is
  // their most recent application — the resume whose skills should win.
  const byCandidate = new Map<string, PooledCandidateEvidenceRow[]>();
  for (const row of evidence) {
    const list = byCandidate.get(row.candidate_id);
    if (list) list.push(row);
    else byCandidate.set(row.candidate_id, [row]);
  }

  return entries.map((entry) => {
    const rows = byCandidate.get(entry.candidate_id) ?? [];

    const scores = rows.map(bestOf).filter((s): s is number => s !== null);
    const bestScore = scores.length > 0 ? Math.max(...scores) : null;

    // The newest resume that actually parsed. An application whose resume never
    // parsed contributes nothing rather than blanking out an older good parse.
    let headline: string | null = null;
    let skills: string[] = [];
    for (const row of rows) {
      const parsed = readParsed(row.parsed_data);
      if (!headline && parsed.headline) headline = parsed.headline;
      if (skills.length === 0 && parsed.skills.length > 0) skills = parsed.skills;
      if (headline && skills.length > 0) break;
    }

    const campaigns = new Map<string, { id: string; title: string }>();
    for (const row of rows) {
      if (!campaigns.has(row.campaign_id)) {
        campaigns.set(row.campaign_id, { id: row.campaign_id, title: row.campaigns.title });
      }
    }
    // The source campaign may be soft-removed and therefore absent from the
    // evidence join. Keep it as a filter option anyway — "everyone I pooled
    // from that closed role" is exactly the question a pool is for.
    if (entry.campaigns && !campaigns.has(entry.campaigns.id)) {
      campaigns.set(entry.campaigns.id, entry.campaigns);
    }

    const candidate = entry.candidates;
    const name = `${candidate.first_name} ${candidate.last_name}`.trim() || candidate.email;

    return {
      id: entry.id,
      candidateId: entry.candidate_id,
      name,
      email: candidate.email,
      phone: candidate.phone,
      location: candidate.location,
      headline,
      skills,
      tags: entry.tags,
      notes: entry.notes,
      addedAt: entry.added_at,
      sourceApplicationId: entry.source_application_id,
      sourceCampaignId: entry.source_campaign_id,
      sourceCampaignTitle: entry.campaigns?.title ?? null,
      bestScore,
      campaigns: [...campaigns.values()],
    };
  });
}
