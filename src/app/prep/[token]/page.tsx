import { loadInterviewPrep } from "@/lib/actions/interview-prep";
import type { PrepSection } from "@/lib/interview/prep-guide";

export const dynamic = "force-dynamic";

/**
 * Candidate-facing interview prep guide (I23) — a web page, not a PDF, per the
 * PRD.
 *
 * Mobile-first on purpose, even though the interview itself is desktop-only:
 * this is opened from an email, which people read on their phone. The guide is
 * where they find out they will need a laptop — so the guide has to work on the
 * device that told them.
 *
 * No login, no session. A signed token in the URL is the whole gate.
 */
export const metadata = {
  title: "Prepare for your interview",
  // Nothing here is secret, but it is addressed to one person and there is no
  // reason for it to appear in a search result.
  robots: { index: false, follow: false },
};

function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function InterviewPrepPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await loadInterviewPrep(token);

  if (result.state !== "ready") {
    return (
      <Shell>
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FEF3C7]">
            <svg
              className="h-6 w-6 text-[#B45309]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="mb-2 text-lg font-semibold text-[#111827]">
            {result.state === "expired"
              ? "This link has expired"
              : "We couldn’t open this link"}
          </h1>
          <p className="text-sm leading-relaxed text-[#6B7280]">
            {result.state === "expired"
              ? "Your interview link is no longer active. If you still want to take the interview, reply to the invitation email and the hiring team can send you a new one."
              : result.message}
          </p>
        </div>
      </Shell>
    );
  }

  const { campaignTitle, guide, expiresAt } = result.context;

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#2563EB]">
          Interview preparation
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-[#111827] sm:text-3xl">
          {campaignTitle}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#6B7280]">
          Everything worth knowing before you start, in about two minutes of
          reading. There is nothing to prepare in advance beyond this.
        </p>
      </header>

      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[#1E40AF]">
            About {guide.durationMinutes} minutes · start whenever you are ready
          </p>
          <p className="mt-0.5 text-xs text-[#2563EB]">
            Complete it by {formatDeadline(expiresAt)}.
          </p>
        </div>
        <p className="text-xs text-[#2563EB] sm:text-right">
          Use the link in your
          <br className="hidden sm:block" /> invitation email to begin.
        </p>
      </div>

      {/* Hoisted above every section, because it is the one fact this page
          exists to deliver and it is buried at the top of a checklist the
          reader has to scroll to — on the phone that brought them here. */}
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4">
        <svg
          className="mt-0.5 h-5 w-5 shrink-0 text-[#B45309]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.75 17h4.5m-9-3h13.5a1.5 1.5 0 001.5-1.5v-6a1.5 1.5 0 00-1.5-1.5H5.25a1.5 1.5 0 00-1.5 1.5v6A1.5 1.5 0 005.25 14z"
          />
        </svg>
        <div>
          <p className="text-sm font-semibold text-[#92400E]">
            You will need a laptop or desktop
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[#92400E]">
            Reading this on your phone is fine — but the interview itself will not
            run on a phone or tablet. It needs a camera, a keyboard and a quiet
            room. Worth knowing now rather than at the deadline.
          </p>
        </div>
      </div>

      <div className="space-y-5">
        {guide.sections.map((section) => (
          <Section key={section.title} section={section} />
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-[#9CA3AF]">
        Sent via Screenr AI. If you did not apply for this role, you can ignore
        this page.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F9FAFB] px-4 py-8 sm:px-6 sm:py-12">
      <main className="mx-auto w-full max-w-2xl">{children}</main>
    </div>
  );
}

function Section({ section }: { section: PrepSection }) {
  return (
    <section className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-sm sm:p-6">
      <h2 className="mb-3 text-base font-semibold text-[#111827]">
        {section.title}
      </h2>
      <ul className="space-y-2.5">
        {section.items.map((item) => (
          <li key={item} className="flex gap-2.5">
            <span
              className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#9CA3AF]"
              aria-hidden="true"
            />
            <span className="text-sm leading-relaxed text-[#374151]">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
