import { describe, expect, it } from "vitest";
import { diagnoseAgentSilence } from "./interview-diagnostics";

describe("diagnoseAgentSilence", () => {
  it("blames the missing worker when no agent participant ever joined", () => {
    const d = diagnoseAgentSilence({ agentPresent: false, agentAudio: false });

    expect(d.reason).toBe("no_agent");
    expect(d.message).toMatch(/didn't join/i);
    expect(d.devHint).toMatch(/worker/i);
  });

  it("blames the realtime session when the agent joined but never produced audio", () => {
    const d = diagnoseAgentSilence({ agentPresent: true, agentAudio: false });

    expect(d.reason).toBe("agent_no_audio");
    expect(d.message).toMatch(/joined but/i);
    expect(d.devHint).toMatch(/Realtime|gpt-realtime/i);
  });

  it("still reports no_agent when the agent is absent regardless of the audio flag", () => {
    // agentAudio can't be true without a present agent; absence dominates.
    const d = diagnoseAgentSilence({ agentPresent: false, agentAudio: true });

    expect(d.reason).toBe("no_agent");
  });
});
