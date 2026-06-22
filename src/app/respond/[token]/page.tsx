import { loadResponseContext } from "@/lib/actions/respond";
import RespondForm from "./respond-form";
import VoiceScreening from "@/components/realtime/voice-screening";

export const dynamic = "force-dynamic";

// Voice is the canonical screening modality (#80). The legacy text form stays
// available as a fallback behind NEXT_PUBLIC_SCREENING_MODE=text until the
// voice path clears QA — see docs/voice-screening.md.
const TEXT_FALLBACK = process.env.NEXT_PUBLIC_SCREENING_MODE === "text";

export default async function RespondPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let ctx;
  try {
    ctx = await loadResponseContext(token);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to load this link.";
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-[#E5E7EB] p-6 sm:p-8 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
            <svg
              className="w-6 h-6 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3m0 3h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-[#111827] mb-2">
            We couldn&apos;t open this link
          </h1>
          <p className="text-sm text-[#6B7280]">{message}</p>
        </div>
      </div>
    );
  }

  if (ctx.status === "responded" || ctx.status === "scored") {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-[#E5E7EB] p-6 sm:p-8 shadow-sm text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-4 mx-auto">
            <svg
              className="w-6 h-6 text-emerald-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-[#111827] mb-2">
            Answers submitted
          </h1>
          <p className="text-sm text-[#6B7280]">
            Thank you for taking the time to answer our questions. The hiring
            team for <strong>{ctx.campaign_title}</strong> will be in touch.
          </p>
        </div>
      </div>
    );
  }

  if (TEXT_FALLBACK) {
    return (
      <RespondForm
        token={token}
        campaignTitle={ctx.campaign_title}
        questions={ctx.questions.map((q) => ({
          id: q.id,
          prompt: q.prompt,
          is_required: q.is_required,
        }))}
        initialAnswers={ctx.existing_answers}
        expiresAt={ctx.expires_at.toISOString()}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-4 sm:p-6">
      <div className="max-w-md w-full space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-[#111827]">Voice screening</h1>
          <p className="text-sm text-[#6B7280]">
            A short spoken interview for <strong>{ctx.campaign_title}</strong>.
          </p>
        </div>
        <VoiceScreening
          token={token}
          campaignTitle={ctx.campaign_title}
          expiresAt={ctx.expires_at.toISOString()}
        />
      </div>
    </div>
  );
}
