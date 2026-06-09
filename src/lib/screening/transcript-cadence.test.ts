import { describe, it, expect } from "vitest";
import { analyzeTranscriptCadence } from "./transcript-cadence";
import type { VoiceTranscriptTurn } from "@/lib/data/screening-questions";

/** Build an agent→candidate pair where the candidate replies `gapSeconds` later. */
function exchange(
  agentAtMs: number,
  gapSeconds: number,
): VoiceTranscriptTurn[] {
  return [
    { role: "agent", text: "Question?", at: new Date(agentAtMs).toISOString() },
    {
      role: "candidate",
      text: "Answer.",
      at: new Date(agentAtMs + gapSeconds * 1000).toISOString(),
    },
  ];
}

describe("analyzeTranscriptCadence", () => {
  it("flags a high scripted signal when most replies land near-instantly", () => {
    const t0 = Date.UTC(2026, 5, 3, 10, 0, 0);
    const transcript: VoiceTranscriptTurn[] = [
      ...exchange(t0, 0.5),
      ...exchange(t0 + 60_000, 1),
      ...exchange(t0 + 120_000, 1.2),
    ];

    const signal = analyzeTranscriptCadence(transcript);

    expect(signal.scripted_signal).toBe("high");
    expect(signal.measured_responses).toBe(3);
  });

  it("reports a low scripted signal when the candidate pauses to think", () => {
    const t0 = Date.UTC(2026, 5, 3, 10, 0, 0);
    const transcript: VoiceTranscriptTurn[] = [
      ...exchange(t0, 6),
      ...exchange(t0 + 60_000, 9),
      ...exchange(t0 + 120_000, 7),
    ];

    const signal = analyzeTranscriptCadence(transcript);

    expect(signal.scripted_signal).toBe("low");
    expect(signal.median_response_seconds).toBe(7);
  });

  it("returns a medium signal for a mix of fast and considered replies", () => {
    const t0 = Date.UTC(2026, 5, 3, 10, 0, 0);
    const transcript: VoiceTranscriptTurn[] = [
      ...exchange(t0, 0.8),
      ...exchange(t0 + 60_000, 8),
      ...exchange(t0 + 120_000, 1),
      ...exchange(t0 + 180_000, 9),
    ];

    const signal = analyzeTranscriptCadence(transcript);

    expect(signal.scripted_signal).toBe("medium");
  });

  it("never flags as scripted when there is not enough data to measure", () => {
    const t0 = Date.UTC(2026, 5, 3, 10, 0, 0);
    const signal = analyzeTranscriptCadence(exchange(t0, 0.2));

    expect(signal.scripted_signal).toBe("low");
    expect(signal.measured_responses).toBe(1);
    expect(signal.rationale).toMatch(/not enough/i);
  });

  it("returns an empty, low signal for an empty transcript", () => {
    const signal = analyzeTranscriptCadence([]);

    expect(signal.scripted_signal).toBe("low");
    expect(signal.measured_responses).toBe(0);
    expect(signal.median_response_seconds).toBeNull();
  });

  it("ignores a candidate turn that has no preceding question", () => {
    const t0 = Date.UTC(2026, 5, 3, 10, 0, 0);
    const transcript: VoiceTranscriptTurn[] = [
      { role: "candidate", text: "Hello?", at: new Date(t0).toISOString() },
      ...exchange(t0 + 10_000, 5),
      ...exchange(t0 + 60_000, 6),
    ];

    const signal = analyzeTranscriptCadence(transcript);

    expect(signal.measured_responses).toBe(2);
  });

  it("skips pairs with unparseable or out-of-order timestamps", () => {
    const t0 = Date.UTC(2026, 5, 3, 10, 0, 0);
    const transcript: VoiceTranscriptTurn[] = [
      { role: "agent", text: "Q1", at: "not-a-date" },
      { role: "candidate", text: "A1", at: new Date(t0).toISOString() },
      // out-of-order: candidate timestamp precedes the agent's
      { role: "agent", text: "Q2", at: new Date(t0 + 60_000).toISOString() },
      { role: "candidate", text: "A2", at: new Date(t0 + 59_000).toISOString() },
      ...exchange(t0 + 120_000, 5),
      ...exchange(t0 + 180_000, 6),
    ];

    const signal = analyzeTranscriptCadence(transcript);

    expect(signal.measured_responses).toBe(2);
  });
});
