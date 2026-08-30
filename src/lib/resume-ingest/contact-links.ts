/**
 * Contact links, recovered from the document instead of asked for.
 *
 * Marker preserves a PDF's hyperlink annotations, so a CV whose contact block
 * is three icons comes through as `[LinkedIn](https://www.linkedin.com/in/x)`.
 * The extractor is told to read prose and not to invent — and a URL hidden
 * behind the word "LinkedIn" is not prose, so it returns null for a link that
 * is sitting right there in the text. That is the whole of the bug this fixes:
 * the link was never missing from the document, only from the reading of it.
 *
 * So the links are taken deterministically, which is the house rule anyway —
 * a model produces evidence, code decides. Three properties make that safe:
 *
 * 1. **It can only ever fill a blank.** A value the model did find is never
 *    overwritten, so this can add a link but never change one. The single
 *    exception is punctuation: a link the CV printed without its `https://`
 *    gets it back, because a schemeless string in an `href` is a path on this
 *    site rather than a link out of it.
 * 2. **It cannot invent.** Every URL returned appears verbatim in the document
 *    (bar a missing `https://` and stripped trailing punctuation). Nothing is
 *    guessed from a name, a handle or a company.
 * 3. **A bare domain only counts for LinkedIn and GitHub**, where the shape is
 *    unmistakable. A portfolio must spell out its own `http(s)://`, because
 *    "Node.js" and "socket.io" are also a word, a dot and a suffix — a skills
 *    list would otherwise become somebody's personal website, and so would
 *    Marker's own `_page_0_Picture_0.jpeg`.
 * 4. **A URL is only a portfolio if the document says whose it is.** LinkedIn
 *    and GitHub carry their owner in the URL; a personal site does not, so
 *    "the first link that is not a known profile" turned an employer's website
 *    into the candidate's own — a fact about somebody else, printed on their
 *    file as though they had claimed it. A portfolio must therefore be either
 *    *labelled* as one or sit in the *contact block*, and must not name an
 *    organisation the CV says they worked or studied at. A CV that links no
 *    site of its own gets no portfolio, which is the honest answer.
 */

import { toExternalUrl } from "@/lib/candidates/contact-url";

/** The three link fields on a parsed resume, and nothing else. */
export interface HarvestableLinks {
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
}

/** `linkedin.com/in/<slug>` or the older `/pub/<slug>`, scheme optional. */
const LINKEDIN_RE =
  /(?:https?:\/\/)?(?:[a-z0-9-]+\.)?linkedin\.com\/(?:in|pub)\/[^\s<>()[\]"'`,]+/gi;

/** `github.com/<user>`, scheme optional. The path is trimmed to the profile. */
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s<>()[\]"'`,]+/gi;

/** A markdown link: the text a reader sees, then the target they do not. */
const MARKDOWN_LINK_RE = /\[([^\]\n]*)\]\(\s*<?([^)<>\s]+)>?[^)]*\)/g;

/**
 * Link text that says the target is the candidate's own site.
 *
 * A CV writes "Portfolio" about itself and a company's name about a company,
 * so this label is worth trusting anywhere in the document — including deep in
 * a projects section, which is exactly where a personal site often ends up.
 */
const PERSONAL_SITE_LABEL_RE =
  /\b(portfolio|personal\s+(?:web\s?site|site|page)|home\s?page|web\s?site|website|blog)\b/i;

/**
 * How far down the page the contact block can still be.
 *
 * Counted in non-empty lines and stopped early by the first section heading. A
 * URL up here is contact detail by position; the same URL under "Experience"
 * is a fact about an employer.
 */
const CONTACT_BLOCK_LINES = 12;

/** Suffixes that are not part of the name an organisation's domain would use. */
const ORGANISATION_SUFFIXES = new Set([
  "inc",
  "llc",
  "ltd",
  "limited",
  "gmbh",
  "bv",
  "nv",
  "sa",
  "sas",
  "sarl",
  "srl",
  "spa",
  "ag",
  "plc",
  "co",
  "corp",
  "corporation",
  "company",
  "group",
  "holding",
  "holdings",
  "university",
  "universite",
  "college",
  "school",
  "institute",
]);

/** A URL that spells out its own scheme. The only shape a portfolio may take. */
const EXPLICIT_URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/gi;

/** The same requirement, asked of one candidate rather than scanned for. */
const EXPLICIT_SCHEME_RE = /^https?:\/\//i;

/**
 * Hosts that are never somebody's portfolio.
 *
 * Two kinds: the XML namespaces a DOCX drags into its converted text, and the
 * profiles that are a link but not a personal site. Matched on the registrable
 * suffix, so `www.` and regional subdomains are covered.
 */
const NOT_A_PORTFOLIO = [
  // Converter and document-format noise.
  "w3.org",
  "openxmlformats.org",
  "purl.org",
  "microsoft.com",
  "adobe.com",
  "datalab.to",
  // Links, but not a portfolio.
  "linkedin.com",
  "github.com",
  "githubusercontent.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "t.me",
  "wa.me",
  "indeed.com",
  "glassdoor.com",
  "monster.com",
  "doi.org",
];

/**
 * GitHub paths that are the site talking about itself rather than a person.
 * A CV citing `github.com/features/actions` has not given us a profile.
 */
const GITHUB_RESERVED = new Set([
  "about",
  "enterprise",
  "explore",
  "features",
  "login",
  "marketplace",
  "orgs",
  "pricing",
  "search",
  "settings",
  "signup",
  "sponsors",
  "topics",
  "trending",
]);

/** Trailing sentence punctuation is never part of the URL it follows. */
function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?'"`)\]}>]+$/, "");
}

function withScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** The host, lowercased, or null when the string is not an absolute URL. */
function hostOf(url: string): string | null {
  try {
    const { hostname, protocol } = new URL(withScheme(url));
    if (protocol !== "http:" && protocol !== "https:") return null;
    return hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

function firstMatch(document: string, re: RegExp): string | null {
  // The regexes are module-level and `g`-flagged, so `lastIndex` has to be
  // reset or a second call resumes where the first stopped.
  re.lastIndex = 0;
  const match = re.exec(document);
  return match ? trimTrailingPunctuation(match[0]) : null;
}

function findLinkedIn(document: string): string | null {
  const found = firstMatch(document, LINKEDIN_RE);
  return found ? withScheme(found) : null;
}

/**
 * The GitHub *profile*, trimmed back from whatever depth the CV linked to.
 *
 * A repo URL names its owner in the first path segment, so shortening
 * `github.com/alice/thing` to `github.com/alice` reads a fact off the URL
 * rather than guessing one — and the field is documented as the profile.
 */
function findGithub(document: string): string | null {
  GITHUB_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = GITHUB_RE.exec(document)) !== null) {
    const raw = trimTrailingPunctuation(match[0]);
    const path = raw.slice(raw.toLowerCase().indexOf("github.com/") + "github.com/".length);
    const user = path.split("/")[0]?.trim();
    if (!user || GITHUB_RESERVED.has(user.toLowerCase())) continue;
    return `https://github.com/${user}`;
  }

  return null;
}

/**
 * The top of the CV: everything before the first section heading, capped.
 *
 * A `# Alice Ng` title line is still the header — it is the candidate's name.
 * `## Experience` is where the document stops being about how to reach them,
 * so it ends the block. The line cap covers the CVs Marker returns with no
 * headings at all, where "before the first heading" would be the whole file.
 */
function contactBlock(document: string): string {
  const block: string[] = [];
  let counted = 0;

  for (const line of document.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^#{2,}\s/.test(trimmed)) break;
    if (trimmed !== "") {
      counted += 1;
      if (counted > CONTACT_BLOCK_LINES) break;
    }
    block.push(line);
  }

  return block.join("\n");
}

/**
 * The name an organisation's own domain would be built from.
 *
 * "Acme Corporation" and "ACME Corp." both key to `acme`, which is what
 * `acme.com` keys to as well. Letters and digits only — a domain cannot hold
 * anything else, so neither should the thing it is compared against.
 */
function organisationKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "" && !ORGANISATION_SUFFIXES.has(word))
    .join("");
}

/**
 * The registrable label of a host: `www.acme.com` and `careers.acme.co.uk`
 * both give `acme`. Not a public-suffix implementation — it only has to be
 * right enough to recognise a company's own domain.
 */
function hostKey(host: string): string {
  const parts = host.split(".").filter((part) => part !== "");
  if (parts.length < 2) return parts[0] ?? "";

  parts.pop(); // the TLD
  const last = parts[parts.length - 1] ?? "";
  if (parts.length > 1 && last.length <= 3 && ORGANISATION_SUFFIXES.has(last)) parts.pop();

  return (parts[parts.length - 1] ?? "").replace(/[^a-z0-9]/g, "");
}

/**
 * Whether this host is one of the organisations on the CV.
 *
 * Deliberately generous about what counts as a match, because the two mistakes
 * are not the same size: refusing a real portfolio loses a link the recruiter
 * can still find on the CV itself, while accepting an employer's site puts a
 * claim on the candidate's file that they never made.
 */
function belongsToAnOrganisation(host: string, organisations: readonly string[]): boolean {
  const key = hostKey(host);
  if (key.length < 3) return false;

  return organisations.some((name) => {
    const org = organisationKey(name);
    if (org.length < 3) return false;
    return org.startsWith(key) || key.startsWith(org);
  });
}

/**
 * The candidate's own site, or null — never "the first URL that was left".
 *
 * Two things can say a URL belongs to the candidate: a label that names it as
 * theirs, or a position in the contact block. A URL with neither is somebody
 * else's — most often an employer's, since a CV is largely a list of
 * organisations and the sites they run.
 */
function findPortfolio(document: string, organisations: readonly string[]): string | null {
  const candidates: string[] = [];
  let link: RegExpExecArray | null;

  // 1. A link that says what it is, wherever it sits.
  MARKDOWN_LINK_RE.lastIndex = 0;
  while ((link = MARKDOWN_LINK_RE.exec(document)) !== null) {
    if (PERSONAL_SITE_LABEL_RE.test(link[1])) candidates.push(link[2]);
  }

  // 2. Anything in the contact block. Markdown targets first, because that is
  //    where a PDF's linked contact icons land and they carry their URL
  //    nowhere else.
  const header = contactBlock(document);

  MARKDOWN_LINK_RE.lastIndex = 0;
  while ((link = MARKDOWN_LINK_RE.exec(header)) !== null) {
    candidates.push(link[2]);
  }

  EXPLICIT_URL_RE.lastIndex = 0;
  let url: RegExpExecArray | null;
  while ((url = EXPLICIT_URL_RE.exec(header)) !== null) {
    candidates.push(url[0]);
  }

  for (const candidate of candidates) {
    const cleaned = trimTrailingPunctuation(candidate.trim());
    // An explicit scheme is the whole filter. Marker's cross-page anchors
    // (`#page-3-0-0`) and its inline image targets (`_page_0_Picture_0.jpeg`)
    // are relative, and a relative target is not a link out of the document —
    // but the image filename has a dot in it, so "looks like a host" is not a
    // test that can tell the two apart.
    if (!EXPLICIT_SCHEME_RE.test(cleaned)) continue;
    const host = hostOf(cleaned);
    if (!host || !host.includes(".")) continue;
    if (NOT_A_PORTFOLIO.some((suffix) => hostMatches(host, suffix))) continue;
    if (belongsToAnOrganisation(host, organisations)) continue;
    return cleaned;
  }

  return null;
}

/**
 * Every link this document actually contains, whether or not the model saw it.
 *
 * Pure and independently useful — `withHarvestedLinks` is what callers want,
 * but this is the half worth testing directly.
 *
 * `organisations` are the employers and schools the CV names. They are used
 * only to *reject* a portfolio, never to find one: a site whose domain is the
 * name of a company on the same page is that company's, and the candidate has
 * not claimed it by having worked there. Passing none is safe — it only means
 * that one check has nothing to check against.
 */
export function harvestContactLinks(
  document: string,
  organisations: readonly (string | null)[] = [],
): HarvestableLinks {
  const named = organisations.filter((name): name is string => Boolean(name?.trim()));

  return {
    linkedin_url: findLinkedIn(document),
    github_url: findGithub(document),
    portfolio_url: findPortfolio(document, named),
  };
}

/**
 * The parsed resume with its blank link fields filled from the document.
 *
 * Blank means null, undefined or whitespace — the extractor is asked for null
 * but an empty string is the same absence and should be treated as one. A
 * field the model filled is returned untouched, so this is only ever additive.
 */
export function withHarvestedLinks<T extends HarvestableLinks>(
  parsed: T,
  document: string,
  organisations: readonly (string | null)[] = [],
): T {
  const harvested = harvestContactLinks(document, organisations);

  /**
   * The model's reading first, but only where it is a link at all.
   *
   * A CV printing `github.com/alice` is reported that way, so the scheme is
   * restored. A value that is not a URL in any form — a bare handle, a
   * sentence — loses to a link harvested from the document, which was matched
   * verbatim and is followable. Only when there is no such link does the raw
   * value survive, unfollowable but visible, because dropping what the CV said
   * is worse than showing it as text.
   */
  const prefer = (value: string | null, fallback: string | null): string | null => {
    const linkable = toExternalUrl(value);
    if (linkable) return linkable;
    if (fallback) return fallback;
    const raw = value?.trim();
    return raw ? raw : null;
  };

  return {
    ...parsed,
    linkedin_url: prefer(parsed.linkedin_url, harvested.linkedin_url),
    github_url: prefer(parsed.github_url, harvested.github_url),
    portfolio_url: prefer(parsed.portfolio_url, harvested.portfolio_url),
  };
}

/**
 * The organisations a parsed CV names — the employers and schools whose own
 * websites must never be harvested as the candidate's personal site.
 *
 * The rule for what counts is load-bearing (it is the only thing standing
 * between an employer's domain and the `portfolio_url` column), so it is
 * stated once rather than once per caller. All three callers re-read a CV:
 * first ingest, the reprocess retry, and the contact-link backfill.
 */
export function organisationsNamedOn(parsed: {
  experience?: { company: string | null }[] | null;
  education?: { institution: string | null }[] | null;
}): (string | null)[] {
  return [
    ...(parsed.experience ?? []).map((role) => role.company),
    ...(parsed.education ?? []).map((entry) => entry.institution),
  ];
}
