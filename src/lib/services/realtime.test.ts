import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRealtimeSession, buildScreeningInstructions, REALTIME_MODEL } from "./realtime";

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("createRealtimeSession", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the ephemeral client secret and expiry from the API response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okResponse({ value: "ek_abc123", expires_at: 1893456000 }),
    );

    const session = await createRealtimeSession();

    expect(session).toEqual({
      clientSecret: "ek_abc123",
      expiresAt: 1893456000,
      model: REALTIME_MODEL,
    });
  });

  it("posts the session model and a bearer token to the client_secrets endpoint", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(okResponse({ value: "ek_x", expires_at: 1 }));

    await createRealtimeSession();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init?.body as string).session.model).toBe(REALTIME_MODEL);
  });

  it("throws when the API key is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(createRealtimeSession()).rejects.toThrow("OPENAI_API_KEY is not configured");
  });

  it("throws with the status when the API responds non-OK", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid key",
    } as Response);

    await expect(createRealtimeSession()).rejects.toThrow(/401/);
  });

  it("throws when the response is missing the client secret value", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(okResponse({ expires_at: 1 }));

    await expect(createRealtimeSession()).rejects.toThrow("missing client secret value");
  });
});

describe("buildScreeningInstructions", () => {
  const questions = [
    { prompt: "Tell me about a hard scaling problem you solved.", is_required: true },
    { prompt: "What is your favorite tool and why?", is_required: false },
  ];

  it("includes every question prompt as an internal topic", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toContain("Tell me about a hard scaling problem you solved.");
    expect(out).toContain("What is your favorite tool and why?");
  });

  it("marks required vs optional topics", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out).toMatch(/hard scaling problem.*\[required\]/);
    expect(out).toMatch(/favorite tool.*\[optional\]/);
  });

  it("instructs the agent to ask unscripted follow-ups and not read topics verbatim", () => {
    const out = buildScreeningInstructions({ questions });

    expect(out.toLowerCase()).toContain("follow-up");
    expect(out.toLowerCase()).toContain("never read the topics aloud verbatim");
  });

  it("anchors a question to the resume when a summary is provided", () => {
    const out = buildScreeningInstructions({
      questions,
      resumeSummary: "8 years backend, ex-Stripe, Go and Postgres",
    });

    expect(out).toContain("8 years backend, ex-Stripe, Go and Postgres");
  });

  it("names the role when a job title is provided", () => {
    const out = buildScreeningInstructions({ questions, jobTitle: "Senior Backend Engineer" });

    expect(out).toContain("Senior Backend Engineer");
  });

  it("stays coherent with no preset questions", () => {
    const out = buildScreeningInstructions({ questions: [] });

    expect(out).toContain("No preset topics");
    expect(out.toLowerCase()).toContain("follow-up");
  });
});
