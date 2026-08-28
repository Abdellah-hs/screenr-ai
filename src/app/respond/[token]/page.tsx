import { loadResponseContext } from "@/lib/actions/respond";
import VoiceScreening from "@/components/realtime/voice-screening";
import {
  Body,
  CandidateShell,
  Heading,
  Icon,
  ShellIcon,
} from "@/components/candidate/candidate-shell";

export const dynamic = "force-dynamic";

// Voice is the ONLY screening modality (#80, #161). The legacy text form was
// retired: it was a second, unexercised path into the same scoring pipeline,
// and a typed answer is the copy-paste-gameable input voice exists to remove.
//
// Everything here — including the two dead ends below — is served in the same
// employer-branded card as the live call, the same one the video interview
// uses. A candidate who follows a link and lands on a bare error page cannot
// tell a broken link from a closed door; both of these say what happened and
// what it means for them.
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
      <CandidateShell title="Voice screening">
        <ShellIcon tone="bad">
          <Icon d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
        </ShellIcon>
        <Heading>We couldn&apos;t open this link</Heading>
        <Body>{message}</Body>
      </CandidateShell>
    );
  }

  if (ctx.status === "responded" || ctx.status === "scored") {
    return (
      <CandidateShell title="Voice screening" role={ctx.campaign_title}>
        <div className="text-center">
          <ShellIcon tone="good">
            <Icon d="m4.5 12.75 6 6 9-13.5" strokeWidth={2.2} />
          </ShellIcon>
          <h2 className="mb-2.5 font-heading text-[26px] font-semibold tracking-[-0.015em] text-ink">
            Answers submitted
          </h2>
          <p className="mx-auto max-w-[52ch] text-[15px] leading-[1.65] text-[#4B5563]">
            Thank you for taking the time to answer our questions. The hiring team
            for{" "}
            <strong className="font-semibold text-ink">{ctx.campaign_title}</strong>{" "}
            will be in touch.
          </p>
        </div>
      </CandidateShell>
    );
  }

  return (
    <VoiceScreening
      token={token}
      campaignTitle={ctx.campaign_title}
      questionCount={ctx.questions.length}
      expiresAt={ctx.expires_at.toISOString()}
    />
  );
}
