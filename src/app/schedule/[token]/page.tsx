import { loadSchedulingContext } from "@/lib/actions/schedule";
import InterviewScheduler from "@/components/scheduling/interview-scheduler";

export const dynamic = "force-dynamic";

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-4 sm:p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-[#E5E7EB] p-6 sm:p-8 shadow-sm">
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 3h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-[#111827] mb-2">We couldn&apos;t open this link</h1>
        <p className="text-sm text-[#6B7280]">{message}</p>
      </div>
    </div>
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
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-[#E5E7EB] p-6 sm:p-8 shadow-sm text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-4 mx-auto">
            <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-[#111827] mb-2">Your interview is scheduled</h1>
          <p className="text-sm text-[#6B7280]">
            {when} ({ctx.booking.timezone}) for <strong>{ctx.campaign_title}</strong>. If you need to
            reschedule, reply to the confirmation email.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-4 sm:p-6">
      <div className="max-w-md w-full space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-[#111827]">Schedule your interview</h1>
          <p className="text-sm text-[#6B7280]">
            Choose a time for your <strong>{ctx.campaign_title}</strong> interview.
          </p>
        </div>
        {ctx.timezone ? (
          <InterviewScheduler
            token={token}
            campaignTitle={ctx.campaign_title}
            timezone={ctx.timezone}
            slots={ctx.slots}
          />
        ) : (
          <div className="rounded-xl border border-[#E2E8F0] bg-white p-6 text-center">
            <p className="text-sm text-[#6B7280]">
              Interview scheduling isn&apos;t available yet. The hiring team will be in touch.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
