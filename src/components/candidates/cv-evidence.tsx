import { interviewAbsence } from "@/lib/candidates/detail-header";
import type { ApplicationState } from "@/lib/constants";
import type { ParsedResumeData } from "@/lib/services/openai";

const PANEL =
  "rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]";

const EYEBROW =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]";

/**
 * The CV as the machine read it.
 *
 * A dated column on the left and the role beside it, because the question a
 * recruiter is actually asking of a CV is "what was this person doing, and
 * when" — and the answer is unreadable when the dates are buried at the end of
 * each line. This is parsed output, so it carries no indigo rail: extraction is
 * transcription, not an opinion, and railing it would spend the AI signal on
 * something nobody needs warning about.
 */
export function ParsedCvCard({
  parsed,
  fallbackSkills,
  resumeUrl,
  profiles = [],
}: {
  parsed: ParsedResumeData | null;
  /** Skills off the application row, for CVs parsed before structured output. */
  fallbackSkills: string[];
  resumeUrl: string | null;
  /** LinkedIn / GitHub / portfolio — the things a recruiter opens next. */
  profiles?: { label: string; href: string }[];
}) {
  const experience = parsed?.experience ?? [];
  const education = parsed?.education ?? [];
  const skills = parsed?.skills?.length ? parsed.skills : fallbackSkills;
  const chips = [
    { label: "Skills", items: skills },
    { label: "Languages", items: parsed?.languages ?? [] },
    { label: "Certifications", items: parsed?.certifications ?? [] },
  ].filter((group) => group.items.length > 0);

  const empty =
    experience.length === 0 && education.length === 0 && chips.length === 0 && !parsed?.summary;

  return (
    <section className={PANEL}>
      <div className="flex flex-wrap items-center justify-between gap-3.5 border-b border-[#F3F4F6] px-6 py-4">
        <h2 className={EYEBROW}>Parsed CV</h2>
        <div className="flex flex-wrap items-center gap-3.5 text-[13px] font-semibold">
          {profiles.map((profile) => (
            <ExternalLink key={profile.href} href={profile.href}>
              {profile.label}
            </ExternalLink>
          ))}
          {resumeUrl ? (
            <ExternalLink href={resumeUrl}>Original document</ExternalLink>
          ) : (
            <span className="text-xs font-normal text-[#9CA3AF]">
              No file on record
            </span>
          )}
        </div>
      </div>

      {empty ? (
        <p className="px-6 py-8 text-center text-[13px] text-[#6B7280]">
          Nothing was extracted from this CV. The original document above is the
          only copy.
        </p>
      ) : (
        <div className="flex flex-col gap-3 px-6 py-[18px]">
          {parsed?.summary && (
            <p className="text-[13px] leading-[1.6] text-[#4B5563]">{parsed.summary}</p>
          )}

          {experience.map((exp, i) => (
            <DatedRow
              key={`exp-${i}`}
              when={exp.duration}
              heading={[exp.title, exp.company].filter(Boolean).join(" · ") || "Role"}
              detail={exp.description}
            />
          ))}

          {education.length > 0 && (
            <>
              <Divider />
              {education.map((edu, i) => (
                <DatedRow
                  key={`edu-${i}`}
                  when={[edu.year_start, edu.year_end].filter(Boolean).join(" — ")}
                  heading={edu.institution || "Institution"}
                  detail={edu.degree}
                />
              ))}
            </>
          )}

          {chips.length > 0 && <Divider />}
          {chips.map((group) => (
            <ChipRow key={group.label} label={group.label} items={group.items} />
          ))}
        </div>
      )}
    </section>
  );
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {children}
      <svg
        className="h-3 w-3"
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
    </a>
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

function Divider() {
  return <span className="my-1 h-px bg-[#F3F4F6]" aria-hidden="true" />;
}

function DatedRow({
  when,
  heading,
  detail,
}: {
  when?: string | null;
  heading: string;
  detail?: string | null;
}) {
  return (
    <div className="flex gap-3.5">
      <span className="w-[104px] flex-none text-xs tabular-nums text-[#6B7280]">
        {when?.trim() || "—"}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-ink">{heading}</p>
        {detail && (
          <p className="mt-0.5 text-[13px] leading-[1.55] text-[#4B5563]">{detail}</p>
        )}
      </div>
    </div>
  );
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  // The parser repeats itself often enough that a raw render shows "Go" twice.
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) return null;

  return (
    <div className="flex gap-3.5">
      <span className="w-[104px] flex-none text-xs text-[#6B7280]">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {unique.map((item) => (
          <span
            key={item}
            className="rounded-md bg-[#F3F4F6] px-2.5 py-[3px] text-xs text-[#374151]"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
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
