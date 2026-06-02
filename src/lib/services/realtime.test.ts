import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRealtimeSession, REALTIME_MODEL } from "./realtime";

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
