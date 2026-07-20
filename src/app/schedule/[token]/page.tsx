import { loadSchedulingContext } from "@/lib/actions/schedule";
import InterviewScheduler from "@/components/scheduling/interview-scheduler";

export const dynamic = "force-dynamic";

/** Shared page shell so every scheduling state sits on the same premium canvas. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F9FAFB] px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-md">{children}</div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Shell>
      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 3h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="mb-2 text-lg font-semibold text-[#111827]">We couldn&apos;t open this link</h1>
        <p className="text-sm leading-relaxed text-[#6B7280]">{message}</p>
      </div>
    </Shell>
  );
}

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let ctx;
  try {
    ctx = await loadSchedulingContext(token);
  } catch (err) {
    return <ErrorCard message={err instanceof Error ? err.message : "Unable to load this link."} />;
  }

  // Already booked — show the confirmation state.
  if (ctx.booking) {
    const when = new Intl.DateTimeFormat("en-US", {
      timeZone: ctx.booking.timezone,
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ctx.booking.scheduled_at));

    return (
      <Shell>
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/40">
            <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-semibold text-[#111827]">Your interview is scheduled</h1>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-[#6B7280]">
            <strong className="font-medium text-[#111827]">{when}</strong> for{" "}
            <strong className="font-medium text-[#374151]">{ctx.campaign_title}</strong>.
          </p>
          <p className="mt-3 text-xs text-[#9CA3AF]">
            Times shown in {ctx.booking.timezone}. If the time needs to change, the hiring team
            will email you to pick again.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-5">
        <div className="text-center sm:text-left">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[#111827] text-white sm:mx-0">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#111827]">
            {ctx.needs_reschedule ? "Choose a new interview time" : "Schedule your interview"}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-[#6B7280]">
            {ctx.needs_reschedule ? (
              <>
                The time for your{" "}
                <strong className="font-medium text-[#374151]">{ctx.campaign_title}</strong>{" "}
                interview has changed — please pick a new one that works for you.
              </>
            ) : (
              <>
                Choose a time that works for your{" "}
                <strong className="font-medium text-[#374151]">{ctx.campaign_title}</strong>{" "}
                interview.
              </>
            )}
          </p>
        </div>
        {ctx.calendar_unavailable ? (
          // Strict calendar mode: the interviewer's calendar couldn't be
          // consulted, so no times are offered. Candidate-safe wording only.
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#F3F4F6]">
              <svg className="h-6 w-6 text-[#9CA3AF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="mx-auto max-w-xs text-sm leading-relaxed text-[#6B7280]">
              Scheduling is temporarily unavailable. Please try again a bit later — or contact the
              hiring team if this keeps happening.
            </p>
          </div>
        ) : ctx.no_hours ? (
          // No bookable weekday business hours fall in the horizon yet.
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#F3F4F6]">
              <svg className="h-6 w-6 text-[#9CA3AF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="mx-auto max-w-xs text-sm leading-relaxed text-[#6B7280]">
              Interview times haven&apos;t been opened up yet. Please check back soon — your link
              stays valid.
            </p>
          </div>
        ) : (
          <InterviewScheduler
            token={token}
            campaignTitle={ctx.campaign_title}
            timezone={ctx.timezone ?? "UTC"}
            slots={ctx.slots}
            recommendedIso={ctx.recommended_iso}
            mode={ctx.needs_reschedule ? "reschedule" : "book"}
          />
        )}
      </div>
    </Shell>
  );
}
