/**
 * A contact link, resolved to something a browser can actually follow.
 *
 * A CV prints its links the way a person reads them — `github.com/alice`,
 * `www.alice.dev` — and the extractor is told to report what the document says,
 * so that is what lands in `parsed_data`. Put straight into an `href`, a
 * schemeless string is not a link to GitHub at all: the browser reads it as a
 * path on *this* site, so the row labelled "GitHub Profile" navigated to our
 * own 404. The label promised one destination and the anchor went somewhere
 * else, which is the worst version of the bug — the recruiter has no reason to
 * doubt it.
 *
 * So the scheme is restored here rather than assumed anywhere. Two rules keep
 * it honest:
 *
 * 1. **It adds a scheme; it never invents a destination.** `https://` in front
 *    of a host is the same link the CV printed. A bare handle (`alice`,
 *    `in/alice`) is *not* — turning it into a profile URL would be guessing at
 *    which site, so it returns null and the caller shows the text as text.
 * 2. **Only `http(s)` comes back.** `javascript:` and `data:` are strings a
 *    resume can contain and an `href` will execute, so anything carrying
 *    another scheme is refused outright.
 */

/** The two schemes a profile link may use. */
const SAFE_SCHEME_RE = /^https?:\/\//i;

/** Any scheme at all — `mailto:`, `javascript:`, `data:`, `ftp:`. */
const ANY_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The value as an absolute `http(s)` URL, or null when it is not a link.
 *
 * Null is a real answer, not a failure: it means "this string is not something
 * to click", and the caller is expected to render it as plain text rather than
 * drop it.
 */
export function toExternalUrl(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;

  // A URL has no spaces in it. "See my GitHub" is a sentence.
  if (/\s/.test(raw)) return null;

  // `//host/path` is an absolute URL missing only its scheme.
  const candidate = raw.startsWith("//") ? `https:${raw}` : raw;

  if (!SAFE_SCHEME_RE.test(candidate) && ANY_SCHEME_RE.test(candidate)) return null;

  const absolute = SAFE_SCHEME_RE.test(candidate) ? candidate : `https://${candidate}`;

  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  // A hostname with no dot is a handle or a word, not a domain. `https://alice`
  // parses cleanly and resolves nowhere.
  if (!parsed.hostname.includes(".")) return null;

  // The input with its scheme restored, not `URL`'s re-serialisation — the
  // point is to make the CV's own link followable, not to rewrite it.
  return absolute;
}
