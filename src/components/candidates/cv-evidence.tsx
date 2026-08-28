import { toExternalUrl } from "@/lib/candidates/contact-url";
import { interviewAbsence } from "@/lib/candidates/detail-header";
import type { ApplicationState } from "@/lib/constants";
import type { ParsedResumeData } from "@/lib/services/openai";

const CARD = "rounded-xl border border-[#E5E7EB] bg-white p-5";

const CARD_TITLE =
  "text-sm font-semibold uppercase tracking-wider text-[#111827]";

/** Heroicons outline, one path each, at the size the contact rows use. */
const CONTACT_ICON = {
  email:
    "M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75",
  phone:
    "M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z",
  portfolio:
    "M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418",
} as const;

const LOCATION_PATHS = [
  "M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  "M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z",
];

/** Brand marks, filled — the only two glyphs on this page that are not outline. */
const LINKEDIN_PATH =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z";

const GITHUB_PATH =
  "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.513 11.513 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";

/**
 * The CV as the extractor left it: every field, in the shape a CV is read in.
 *
 * This is the record the assessment is an opinion *about*, so it is a page tab
 * of its own rather than a panel inside the evidence file — a document is not a
 * sub-item of a reading of it, and at full width it can be laid out the way a
 * person expects to meet someone: who they are and how to reach them on the
 * left, what they have done on the right.
 *
 * It carries no indigo rail. Extraction is transcription, not an opinion, and
 * railing it would spend the AI signal on something nobody needs warning about.
 * The original document opens from here and nowhere else, beside its own
 * transcript, where the parse can be checked against the page it came from.
 */
export function ParsedCvView({
  parsed,
  fallbackSkills,
  fallbackHeadline,
  resumeUrl,
  email,
  phone,
  location,
  linkedinUrl,
  githubUrl,
  portfolioUrl,
}: {
  parsed: ParsedResumeData | null;
  /** Skills off the application row, for CVs parsed before structured output. */
  fallbackSkills: string[];
  /** "Staff Engineer at Nordbank", derived, for a CV with no tagline of its own. */
  fallbackHeadline?: string | null;
  resumeUrl: string | null;
  /** Off the candidate record — the values the parse was persisted into. */
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
}) {
  const experience = parsed?.experience ?? [];
  const education = parsed?.education ?? [];
  const headline = parsed?.headline || fallbackHeadline || null;

  const contactEmail = parsed?.email || email || null;
  const contactPhone = parsed?.phone || phone || null;
  const contactLocation = parsed?.location || location || null;
  const linkedin = parsed?.linkedin_url || linkedinUrl || null;
  const github = parsed?.github_url || githubUrl || null;
  const portfolio = parsed?.portfolio_url || portfolioUrl || null;

  // Named rather than silently omitted. A CV with no GitHub link and a parse
  // that missed one look identical on screen otherwise, and only the first is
  // a fact about the candidate.
  const missing = [
    !contactEmail && "email",
    !contactPhone && "phone",
    !contactLocation && "location",
    !linkedin && "LinkedIn",
    !github && "GitHub",
    !portfolio && "portfolio",
  ].filter((label): label is string => Boolean(label));

  const chips = [
    { label: "Skills", items: parsed?.skills?.length ? parsed.skills : fallbackSkills },
    { label: "Languages", items: parsed?.languages ?? [] },
    { label: "Certifications", items: parsed?.certifications ?? [] },
    { label: "Interests", items: parsed?.interests ?? [] },
  ];

  const nothingParsed =
    !parsed ||
    (experience.length === 0 &&
      education.length === 0 &&
      !parsed.summary &&
      chips.every((group) => group.items.length === 0));

  return (
    <div className="flex flex-col gap-5">
      {/* The extractor's own verdict on what it was handed. A motivation letter
          parsed as a CV produces plausible-looking empty sections, so the label
          goes above them rather than into a log nobody reads. */}
      {parsed && parsed.document_type !== "cv" && (
        <p className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-[13px] leading-[1.55] text-[#92400E]">
          The extractor classified this document as{" "}
          <span className="font-semibold">
            {parsed.document_type === "motivation_letter"
              ? "a motivation letter"
              : "something other than a CV"}
          </span>
          . The fields below are a best-effort read of it, so treat thin sections
          as a fact about the document rather than about the candidate.
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Who they are and how to reach them. */}
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-1">
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Contact</h2>

            {/* The tagline a CV prints under the name. It is the candidate's
                own words about themselves, so it belongs with the document
                rather than in the page header beside a stage and an SLA. */}
            {headline && (
              <p className="mt-1.5 text-sm leading-relaxed text-[#6B7280]">{headline}</p>
            )}

            <div className="mt-4 space-y-3">
              {contactEmail && (
                <ContactRow href={`mailto:${contactEmail}`} d={CONTACT_ICON.email}>
                  {contactEmail}
                </ContactRow>
              )}

              {contactPhone && (
                <ContactRow href={`tel:${contactPhone}`} d={CONTACT_ICON.phone}>
                  {contactPhone}
                </ContactRow>
              )}

              {contactLocation && (
                <ContactRow paths={LOCATION_PATHS}>{contactLocation}</ContactRow>
              )}

              {linkedin && (
                <ContactRow {...profileLink(linkedin, "LinkedIn Profile")} brand={LINKEDIN_PATH} />
              )}

              {github && (
                <ContactRow {...profileLink(github, "GitHub Profile")} brand={GITHUB_PATH} />
              )}

              {portfolio && (
                <ContactRow {...profileLink(portfolio, "Portfolio")} d={CONTACT_ICON.portfolio} />
              )}
            </div>

            {/* "Not in the document" was too strong a claim for this line to
                make. Half these fields have a second source — the candidate
                types their own email, LinkedIn and website on the apply form —
                and a link the extractor failed to read is missing from the
                reading, not from the CV. What the line can honestly say is
                that nothing anywhere has one. */}
            {missing.length > 0 && (
              <p className="mt-4 border-t border-[#F3F4F6] pt-3 text-xs leading-[1.5] text-[#9CA3AF]">
                Nothing on file for: {missing.join(", ")}.
              </p>
            )}
          </section>

          <section className={CARD}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className={CARD_TITLE}>Resume</h2>
              {resumeUrl ? (
                <a
                  href={resumeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-3 text-xs font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                    />
                  </svg>
                  Open the original
                </a>
              ) : (
                <span className="text-xs text-[#9CA3AF]">No file on record</span>
              )}
            </div>

            <div className="space-y-4">
              {chips.map((group) => (
                <ChipGroup key={group.label} label={group.label} items={group.items} />
              ))}
              {chips.every((group) => group.items.length === 0) && (
                <p className="text-[13px] text-[#6B7280]">
                  No skills, languages or certifications were extracted.
                </p>
              )}
            </div>
          </section>
        </div>

        {/* What they have done. */}
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          {parsed?.summary && (
            <section className={CARD}>
              <h2 className={`${CARD_TITLE} mb-3`}>About</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-[#4B5563]">
                {parsed.summary}
              </p>
            </section>
          )}

          {experience.length > 0 && (
            <section className={CARD}>
              <h2 className={`${CARD_TITLE} mb-4`}>Experience</h2>
              <div className="space-y-4">
                {experience.map((exp, i) => (
                  <TimelineEntry
                    key={`exp-${i}`}
                    heading={[exp.title, exp.company].filter(Boolean).join(" · ") || "Role"}
                    when={exp.duration}
                    detail={exp.description}
                  />
                ))}
              </div>
            </section>
          )}

          {education.length > 0 && (
            <section className={CARD}>
              <h2 className={`${CARD_TITLE} mb-4`}>Education</h2>
              <div className="space-y-4">
                {education.map((edu, i) => (
                  <TimelineEntry
                    key={`edu-${i}`}
                    heading={edu.institution || "Institution"}
                    when={[edu.year_start, edu.year_end].filter(Boolean).join(" – ")}
                    detail={edu.degree}
                  />
                ))}
              </div>
            </section>
          )}

          {nothingParsed && (
            <section className="rounded-xl border border-dashed border-[#E5E7EB] bg-white p-6">
              <p className="mb-1 text-sm font-semibold text-ink">
                Nothing was extracted from this CV
              </p>
              <p className="max-w-[64ch] text-[13px] leading-[1.55] text-[#6B7280]">
                The parser found no experience, education or skills in the
                document. The original file is the only copy — open it from the
                Resume card and judge it by eye.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The href and label for a profile row, given whatever the CV carried.
 *
 * "GitHub Profile" is a promise about where the row goes, and a CV that printed
 * `github.com/alice` gives us a string the browser reads as a path on *this*
 * site — so the row kept its label and landed on our own 404. A value that
 * resolves to a real external URL becomes a link; anything else is shown as the
 * text it actually is, unlinked, so the recruiter can read what the CV said
 * without being sent somewhere it never pointed.
 */
function profileLink(
  value: string,
  label: string,
): { href?: string; external: boolean; children: React.ReactNode } {
  const href = toExternalUrl(value);
  return href
    ? { href, external: true, children: label }
    : { external: false, children: value };
}

/**
 * One line of the contact block: an icon, the value, and — when it leaves the
 * app — the arrow that says so. A row is a link wherever the value is
 * actionable, because a phone number a recruiter has to retype is a phone
 * number they get wrong.
 */
function ContactRow({
  href,
  external = false,
  d,
  paths,
  brand,
  children,
}: {
  href?: string;
  external?: boolean;
  /** A single Heroicons outline path. */
  d?: string;
  /** Two-path outline icons (the location pin). */
  paths?: string[];
  /** A filled brand mark — LinkedIn, GitHub. */
  brand?: string;
  children: React.ReactNode;
}) {
  const icon = brand ? (
    <svg
      className="h-4 w-4 shrink-0 text-[#9CA3AF] transition-colors duration-150 group-hover:text-primary"
      fill="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d={brand} />
    </svg>
  ) : (
    <svg
      className="h-4 w-4 shrink-0 text-[#9CA3AF] transition-colors duration-150 group-hover:text-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {(paths ?? [d ?? ""]).map((path) => (
        <path key={path} strokeLinecap="round" strokeLinejoin="round" d={path} />
      ))}
    </svg>
  );

  const label = (
    <span className="min-w-0 break-words text-sm text-[#4B5563] transition-colors duration-150 group-hover:text-primary">
      {children}
    </span>
  );

  if (!href) {
    return (
      <div className="flex items-center gap-2.5">
        {icon}
        <span className="min-w-0 break-words text-sm text-[#4B5563]">{children}</span>
      </div>
    );
  }

  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="group flex cursor-pointer items-center gap-2.5"
    >
      {icon}
      {label}
      {external && (
        <svg
          className="h-3 w-3 shrink-0 text-[#9CA3AF] transition-colors duration-150 group-hover:text-primary"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
          />
        </svg>
      )}
    </a>
  );
}

/** A role or a degree: what it was, when, and what it involved. */
function TimelineEntry({
  heading,
  when,
  detail,
}: {
  heading: string;
  when?: string | null;
  detail?: string | null;
}) {
  return (
    <div className="border-l-2 border-[#E5E7EB] pl-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 break-words text-sm font-semibold text-[#111827]">
          {heading}
        </p>
        {when?.trim() && (
          <span className="shrink-0 whitespace-nowrap text-xs text-[#9CA3AF]">
            {when}
          </span>
        )}
      </div>
      {detail && (
        <p className="mt-1 text-sm leading-relaxed text-[#4B5563]">{detail}</p>
      )}
    </div>
  );
}

function ChipGroup({ label, items }: { label: string; items: string[] }) {
  // Dedupe case-insensitively (the parser sometimes repeats a skill), keeping
  // the first-seen spelling. Empty groups render nothing.
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-xs text-[#6B7280]">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {unique.map((item) => (
          <span
            key={item}
            className="inline-flex rounded-full bg-[#F3F4F6] px-2 py-0.5 text-xs font-medium text-[#374151]"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The campaign scores no CVs at all.
 *
 * Distinct from "this CV has not been scored yet": nothing will ever score it,
 * because the resume rubric is empty. A page that silently omitted the score
 * section here would look like a candidate still in the queue.
 */
export function NoResumeRubricCard({ editHref }: { editHref: string }) {
  return (
    <section className="rounded-xl border border-dashed border-[#FDE68A] bg-[#FFFBEB] p-6">
      <p className="mb-1 text-sm font-semibold text-[#92400E]">
        Nothing scores CVs on this campaign
      </p>
      <p className="mb-3.5 max-w-[64ch] text-[13px] leading-[1.55] text-[#B45309]">
        The resume rubric has no dimensions, so every CV arrives unscored and
        every one waits for a person. That is a setting, not a fault with this
        candidate.
      </p>
      <a
        href={editHref}
        className="inline-flex min-h-9 items-center rounded-lg border border-[#D1D5DB] bg-white px-3 text-[13px] font-semibold text-[#374151] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink"
      >
        Add rubric dimensions
      </a>
    </section>
  );
}

/**
 * A view that exists and holds nothing yet, said as a state.
 *
 * Every stage keeps its place in the evidence nav whether or not it has run,
 * so that a recruiter learns one layout rather than a different one per
 * candidate. The cost of that is empty views, and an empty view has to say
 * which emptiness it is: not reached, waiting on the candidate, lapsed, or
 * never watched. Silence would read as "nothing to see", which is the one
 * thing it never means.
 */
export function EvidenceAbsenceCard({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <section className="rounded-xl border border-dashed border-[#E5E7EB] bg-white p-6">
      <p className="mb-1 text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-[64ch] text-[13px] leading-[1.55] text-[#6B7280]">{body}</p>
    </section>
  );
}

/**
 * The interview slot, when there is nothing in it.
 *
 * Dashed rather than solid, because an absence is not a record. The card exists
 * to stop two different silences reading the same: "no proctoring findings"
 * because the camera watched and saw nothing, versus because the camera was
 * never on. Only the first is reassurance.
 */
export function InterviewNotTakenCard({ status }: { status: ApplicationState }) {
  const absence = interviewAbsence(status);

  return (
    <section className="rounded-xl border border-dashed border-[#E5E7EB] bg-white p-6">
      <div className="flex items-start gap-3.5">
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-lg bg-[#F5F3FF] text-[#7C3AED]">
          <svg
            className="h-[18px] w-[18px]"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-sm font-semibold text-ink">{absence.title}</p>
          <p className="max-w-[64ch] text-[13px] leading-[1.55] text-[#6B7280]">
            {absence.body}
          </p>
        </div>
      </div>
    </section>
  );
}
