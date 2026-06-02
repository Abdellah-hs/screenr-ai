import VoiceSession from "@/components/realtime/voice-session";

/**
 * SPIKE (#81) harness — an internal page to prove the OpenAI Realtime stack
 * end to end (ephemeral token mint + browser WebRTC + agent audio). This is a
 * throwaway test surface; the real flow lives on /respond/[token] (#82–#83).
 */
export default async function VoiceSpikePage({
  searchParams,
}: {
  searchParams: Promise<{ campaignId?: string }>;
}) {
  const { campaignId } = await searchParams;

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold text-[#111827] mb-2">Voice connection spike</h1>
      <p className="text-sm text-[#6B7280] mb-6">
        {campaignId
          ? "Preview of this campaign's voice screening call (issue #82) — the agent asks the campaign's questions and probes with unscripted follow-ups."
          : "Connectivity test for the OpenAI Realtime voice screening (issue #81). Click start, allow the microphone, and the assistant should greet you. Append ?campaignId=<id> to preview a real screening script."}
      </p>
      <VoiceSession campaignId={campaignId} />
    </div>
  );
}
