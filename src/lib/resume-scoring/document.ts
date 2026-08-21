/**
 * The resume document, assembled once and used for three things that MUST agree:
 * what the model is shown, what its quotes are checked against, and what the
 * cache key hashes.
 *
 * If they could differ, quote verification would be theatre — the model could
 * quote something real from a document the validator never saw and be marked a
 * fabricator, or quote something the validator happens to hold and be believed
 * on text the model was never given. So there is exactly one builder, and
 * everything downstream takes its output.
 */

const MAX_RESUME_TEXT_CHARS = 70_000;
const RESUME_HEAD_CHARS = 50_000;
const RESUME_TAIL_CHARS = 20_000;

const TRUNCATION_MARKER = "[Middle of resume text truncated because it was too long]";

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter((s): s is string => s !== null);
}

function asRecordList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v),
  );
}

function section(heading: string, body: string | null): string | null {
  return body ? `## ${heading}\n${body}` : null;
}

/**
 * Flatten the AI-extracted resume fields into readable prose sections.
 *
 * The parsed data is itself model output, so quoting from it verifies a
 * narrower claim than quoting from the original file: "the extractor saw this",
 * not "the CV says this". Callers that still hold the source text (the ingest
 * pipeline does) pass it as `rawText`, and it is appended verbatim so the
 * strong version of the check is available wherever the text survives. A
 * re-score months later only has the parsed row, and gets the weaker check
 * rather than none.
 */
export function buildResumeDocument(source: {
  parsed: Record<string, unknown> | null | undefined;
  rawText?: string | null;
}): string {
  const parsed = source.parsed ?? {};
  const parts: (string | null)[] = [];

  const name = [asString(parsed.first_name), asString(parsed.last_name)]
    .filter((s): s is string => s !== null)
    .join(" ");

  parts.push(section("Name", name || null));
  parts.push(section("Headline", asString(parsed.headline)));
  parts.push(section("Summary", asString(parsed.summary)));

  const skills = asStringList(parsed.skills);
  parts.push(section("Skills", skills.length > 0 ? skills.join(", ") : null));

  const experience = asRecordList(parsed.experience)
    .map((entry) => {
      const header = [asString(entry.title), asString(entry.company)]
        .filter((s): s is string => s !== null)
        .join(" at ");
      const duration = asString(entry.duration);
      const description = asString(entry.description);
      const line = [header || null, duration ? `(${duration})` : null]
        .filter((s): s is string => s !== null)
        .join(" ");
      return [line || null, description].filter((s): s is string => s !== null).join("\n");
    })
    .filter((entry) => entry.length > 0);
  parts.push(section("Experience", experience.length > 0 ? experience.join("\n\n") : null));

  const education = asRecordList(parsed.education)
    .map((entry) => {
      const years = [asString(entry.year_start), asString(entry.year_end)]
        .filter((s): s is string => s !== null)
        .join("–");
      return [asString(entry.degree), asString(entry.institution), years || null]
        .filter((s): s is string => s !== null)
        .join(", ");
    })
    .filter((entry) => entry.length > 0);
  parts.push(section("Education", education.length > 0 ? education.join("\n") : null));

  const certifications = asStringList(parsed.certifications);
  parts.push(
    section("Certifications", certifications.length > 0 ? certifications.join(", ") : null),
  );

  const languages = asStringList(parsed.languages);
  parts.push(section("Languages", languages.length > 0 ? languages.join(", ") : null));

  const interests = asStringList(parsed.interests);
  parts.push(section("Interests", interests.length > 0 ? interests.join(", ") : null));

  parts.push(section("Original resume text", asString(source.rawText)));

  return parts.filter((p): p is string => p !== null).join("\n\n");
}

/**
 * Collapse incidental whitespace and cap the length, keeping the head and tail
 * (a CV's identity and its oldest roles) when a document is too long to send.
 *
 * Truncation happens HERE rather than at the prompt boundary so the discarded
 * middle is discarded for the validator too: a quote from text the model never
 * received cannot be verified, and shouldn't be.
 */
export function normalizeResumeDocument(rawDocument: string): string {
  const cleaned = rawDocument
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) {
    throw new Error("Resume text is empty after extraction.");
  }

  if (cleaned.length <= MAX_RESUME_TEXT_CHARS) {
    return cleaned;
  }

  const head = cleaned.slice(0, RESUME_HEAD_CHARS);
  const tail = cleaned.slice(-RESUME_TAIL_CHARS);
  return `${head}\n\n${TRUNCATION_MARKER}\n\n${tail}`;
}

/** Build and normalize in one step — the only entry point callers should use. */
export function buildNormalizedResumeDocument(source: {
  parsed: Record<string, unknown> | null | undefined;
  rawText?: string | null;
}): string {
  return normalizeResumeDocument(buildResumeDocument(source));
}
