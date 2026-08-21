import Link from "next/link";
import {
  neighbourNav,
  slaPhrase,
  stagePill,
  timeInStageLabel,
} from "@/lib/candidates/detail-header";
import type { ApplicationState, SlaBreachLevel } from "@/lib/constants";

/**
 * Who this is, where they are, and how to get to the next one — in one band
 * across the top of the page.
 *
 * It is full-bleed and white against the page's grey because it is the only
 * part of this screen that is not evidence: everything below is something a
 * model or a person produced about this candidate, and the header is the
 * candidate themselves.
 */
export function CandidateHeader({
  campaignId,
  campaignTitle,
  candidate,
  headline,
  location,
  hoursInStage,
  sla: slaBreach,
  hasSlaTimer,
  peers,
}: {
  campaignId: string;
  campaignTitle: string;
  /** Deliberately not the full `Candidate`: the detail read returns a
   *  different, narrower record, and this is the whole of what a header needs. */
  candidate: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    status: ApplicationState;
    applied_at: string;
  };
  headline: string | null;
  location: string | null;
  hoursInStage: number | null;
  /** From the list read — the detail read does not compute one. */
  sla: { level: SlaBreachLevel; hours: number } | null;
  hasSlaTimer: boolean;
  /** The campaign's candidates, in list order, for the prev/next stepper. */
  peers: { id: string; status: ApplicationState }[];
}) {
  const pill = stagePill(candidate.status);
  const inStage = timeInStageLabel(hoursInStage);
  const sla = slaPhrase(slaBreach, hasSlaTimer);
  const nav = neighbourNav(peers, candidate.id);

  const initials = candidate.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  const appliedOn = new Date(candidate.applied_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    // Negative margins cancel the dashboard shell's 32px padding so the band
    // reaches both edges, the way the page chrome above it does.
    <header className="-mx-8 -mt-8 mb-7 border-b border-[#E5E7EB] bg-white px-8 pb-[18px] pt-3.5">
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <Link
          href={`/campaigns/${campaignId}`}
          className="text-[13px] text-[#6B7280] transition-colors duration-150 hover:text-ink"
        >
          {campaignTitle}
        </Link>
        <span className="text-[13px] text-[#D1D5DB]">/</span>
        <Link
          href={`/campaigns/${campaignId}/candidates`}
          className="text-[13px] text-[#6B7280] transition-colors duration-150 hover:text-ink"
        >
          Candidates
        </Link>
        <span className="text-[13px] text-[#D1D5DB]">/</span>
        <span className="text-[13px] text-ink">{candidate.name}</span>

        {nav && (
          <div className="ml-auto flex items-center gap-1.5">
            <StepLink
              href={nav.prevId ? `/campaigns/${campaignId}/candidates/${nav.prevId}` : null}
              label="Previous candidate in this stage"
              d="M15.75 19.5 8.25 12l7.5-7.5"
            />
            <span className="text-xs tabular-nums text-[#6B7280]">
              {nav.position} of {nav.total} in {nav.stageName}
            </span>
            <StepLink
              href={nav.nextId ? `/campaigns/${campaignId}/candidates/${nav.nextId}` : null}
              label="Next candidate in this stage"
              d="m8.25 4.5 7.5 7.5-7.5 7.5"
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <span className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full border border-[#E5E7EB] bg-[#F3F4F6] text-[15px] font-bold text-[#4B5563]">
          {initials || "?"}
        </span>

        <div className="min-w-0">
          <div className="mb-[3px] flex flex-wrap items-center gap-[11px]">
            <h1 className="font-heading text-[26px] font-semibold tracking-[-0.02em] text-ink">
              {candidate.name}
            </h1>

            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ backgroundColor: pill.bg, color: pill.ink }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: pill.ink }}
                aria-hidden="true"
              />
              {pill.label}
            </span>

            <span className="text-xs text-[#6B7280]">
              {inStage && <>{inStage} · </>}
              <span className={sla.breached ? "font-semibold text-[#B91C1C]" : undefined}>
                {sla.text}
              </span>
            </span>
          </div>

          {headline && (
            <p className="mb-0.5 text-[13px] text-[#4B5563]">{headline}</p>
          )}

          {/* One line, not a five-row card. An email and a phone number do not
              each need an icon and a row of their own. */}
          <p className="text-[13px] text-[#6B7280]">
            <a
              href={`mailto:${candidate.email}`}
              className="transition-colors duration-150 hover:text-primary"
            >
              {candidate.email}
            </a>
            {candidate.phone && (
              <>
                {" · "}
                <a
                  href={`tel:${candidate.phone}`}
                  className="transition-colors duration-150 hover:text-primary"
                >
                  {candidate.phone}
                </a>
              </>
            )}
            {location && ` · ${location}`}
            {` · applied ${appliedOn}`}
          </p>
        </div>
      </div>
    </header>
  );
}

/** One end of the stepper. Rendered inert rather than hidden at the ends, so
 *  the control does not change width as you walk the list. */
function StepLink({
  href,
  label,
  d,
}: {
  href: string | null;
  label: string;
  d: string;
}) {
  const shape =
    "flex h-9 w-9 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white";
  const icon = (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );

  if (!href) {
    return (
      <span className={`${shape} text-[#D1D5DB]`} aria-hidden="true">
        {icon}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={`${shape} text-[#6B7280] transition-colors duration-150 hover:bg-[#F9FAFB] hover:text-ink`}
    >
      {icon}
    </Link>
  );
}
