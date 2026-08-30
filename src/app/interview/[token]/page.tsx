import { loadInterviewContext } from "@/lib/actions/interview";
import VideoInterview from "@/components/realtime/video-interview";
import { CandidateShell, ShellIcon } from "@/components/candidate/candidate-shell";

export const dynamic = "force-dynamic";

/**
 * The candidate's AI video interview.
 *
 * Everything here — including the two dead ends below — is served in the same
 * employer-branded card as the live interview, because a candidate who follows
 * a link and lands on a bare error page cannot tell a broken link from a closed
 * door. Both of these say what happened and what it means for them.
 */
export default async function InterviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let ctx;
  try {
    ctx = await loadInterviewContext(token);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to load this link.";
    return (
      <CandidateShell title="Video interview">
        <ShellIcon tone="bad">
          <svg
            className="h-8 w-8"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
            />
          </svg>
        </ShellIcon>
        <p className="mb-2 text-center text-[19px] font-semibold text-ink">
          We couldn&apos;t open this link
        </p>
        <p className="mx-auto max-w-[52ch] text-center text-[15px] leading-[1.6] text-[#4B5563]">
          {message}
        </p>
      </CandidateShell>
    );
  }

  if (ctx.status === "completed") {
    return (
      <CandidateShell title="Video interview" role={ctx.campaign_title}>
        <div className="text-center">
          <ShellIcon tone="good">
            <svg
              className="h-8 w-8"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </ShellIcon>
          <h2 className="mb-2.5 font-heading text-[26px] font-semibold tracking-[-0.015em] text-ink">
            Interview complete
          </h2>
          <p className="mx-auto max-w-[52ch] text-[15px] leading-[1.65] text-[#4B5563]">
            Thanks for completing your interview for{" "}
            <strong className="font-semibold text-ink">{ctx.campaign_title}</strong>.
            The hiring team will review it and be in touch by email.
          </p>
        </div>
      </CandidateShell>
    );
  }

  return (
    <VideoInterview
      token={token}
      campaignTitle={ctx.campaign_title}
      expiresAt={ctx.expires_at}
    />
  );
}
