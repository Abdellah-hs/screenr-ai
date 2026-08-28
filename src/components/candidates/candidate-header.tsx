import type { ReactNode } from "react";
import { Breadcrumb } from "@/components/ui";
import { stagePill } from "@/lib/candidates/detail-header";
import type { ApplicationState } from "@/lib/constants";

/**
 * Who this is, and the buttons that act on them, in one band across the top of
 * the page.
 *
 * It is the only part of this screen that is not evidence: everything below is
 * something a model or a person produced about this candidate, and the header
 * is the candidate themselves. It is deliberately short — a name, the stage,
 * how to reach them. Time-in-stage, the SLA and the state-machine's own
 * commentary all lived here once and are gone: a header that reports on the
 * pipeline competes with the panel that exists to report on the pipeline.
 *
 * It scrolls with the page rather than pinning to the top of it. A band that
 * stays put buys reachable actions at the cost of a permanent 166px of chrome
 * and a hairline that never lines up with anything — and with the evidence now
 * filtered rather than stacked, the panel beside it is rarely long enough to
 * scroll the actions out of reach in the first place.
 */
export function CandidateHeader({
  campaignId,
  campaignTitle,
  candidate,
  location,
  actions,
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
  location: string | null;
  /** The decision itself, kept with the identity it acts on. */
  actions?: ReactNode;
}) {
  const pill = stagePill(candidate.status);
  const appliedOn = new Date(candidate.applied_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    // In the page's own column, not bled to the window edges: it sits on the
    // same left margin as the evidence under it, so the name, the tabs and the
    // panel all start on one line.
    //
    // No rule of its own. The tab bar directly below draws one, and two
    // hairlines a few pixels apart read as a mistake rather than as structure.
    <header className="mb-6">
      <Breadcrumb
        items={[
          { label: "Campaigns", href: "/campaigns" },
          { label: campaignTitle, href: `/campaigns/${campaignId}` },
          { label: "Candidates", href: `/campaigns/${campaignId}/candidates` },
          { label: candidate.name },
        ]}
      />

      {/* No avatar. Initials in a circle are decoration, and the 68px they
          cost pushed the name off the left edge the breadcrumb, the tabs and
          every panel below share — so the biggest thing on the page was the
          one thing out of line. */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
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
          </div>

          {/* One line, not a five-row card. An email and a phone number do not
              each need an icon and a row of their own. */}
          <p className="truncate text-[13px] text-[#6B7280]">
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

        {actions && (
          <div className="flex flex-none items-center gap-2.5">{actions}</div>
        )}
      </div>
    </header>
  );
}
