import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ __brand: "admin-client" })),
}));
vi.mock("@/lib/screening/instructions", () => ({
  composeScreeningInstructions: vi.fn(),
}));

import { GET } from "./route";
import { composeScreeningInstructions } from "@/lib/screening/instructions";

const mockCompose = vi.mocked(composeScreeningInstructions);

const APP_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

function request(
  applicationId: string | null,
  secret?: string,
  topics?: string,
): Request {
  const url = new URL("http://localhost/api/agent/screening/instructions");
  if (applicationId !== null) url.searchParams.set("application_id", applicationId);
  if (topics) url.searchParams.set("topics", topics);
  return new Request(url, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENT_API_SECRET = "agent-secret";
  mockCompose.mockResolvedValue({
    instructions: "Your internal topic guide — CONFIDENTIAL",
    topicFallback: null,
  });
});

describe("GET /api/agent/screening/instructions", () => {
  it("returns the composed instructions to a correctly authenticated worker", async () => {
    const res = await GET(request(APP_ID, "agent-secret"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      instructions: "Your internal topic guide — CONFIDENTIAL",
      topic_fallback: null,
    });
    expect(mockCompose).toHaveBeenCalledWith(
      APP_ID,
      expect.objectContaining({ __brand: "admin-client" }),
      false,
    );
  });

  /**
   * The rollout guard. A worker deployed before runtime topic control does not
   * send `topics=tool`, and must keep receiving a self-sufficient prompt with
   * the list inline — otherwise shipping the app first would hand it an
   * interviewer that has nothing to ask and no way to find out.
   */
  it("withholds the topic list only when the worker asks for the tool protocol", async () => {
    await GET(request(APP_ID, "agent-secret", "tool"));
    expect(mockCompose).toHaveBeenLastCalledWith(APP_ID, expect.anything(), true);

    await GET(request(APP_ID, "agent-secret"));
    expect(mockCompose).toHaveBeenLastCalledWith(APP_ID, expect.anything(), false);
  });

  it("passes the topic fallback through for the worker to hold in reserve", async () => {
    mockCompose.mockResolvedValue({
      instructions: "no list here",
      topicFallback: "TOPIC GUIDE — INTERNAL",
    });

    const res = await GET(request(APP_ID, "agent-secret", "tool"));

    await expect(res.json()).resolves.toEqual({
      instructions: "no list here",
      topic_fallback: "TOPIC GUIDE — INTERNAL",
    });
  });

  /**
   * The whole point of moving off room metadata: this content must be reachable
   * only by something holding the shared secret. A candidate's browser holds a
   * LiveKit join token and nothing else.
   */
  it("refuses a missing or wrong bearer secret without composing anything", async () => {
    const missing = await GET(request(APP_ID));
    const wrong = await GET(request(APP_ID, "nope"));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(mockCompose).not.toHaveBeenCalled();
  });

  it("fails closed when the secret is not configured at all", async () => {
    delete process.env.AGENT_API_SECRET;

    const res = await GET(request(APP_ID, "agent-secret"));

    expect(res.status).toBe(500);
    expect(mockCompose).not.toHaveBeenCalled();
  });

  it("rejects an application id that is not a uuid", async () => {
    const res = await GET(request("not-a-uuid", "agent-secret"));

    expect(res.status).toBe(400);
    expect(mockCompose).not.toHaveBeenCalled();
  });

  it("rejects a missing application id", async () => {
    const res = await GET(request(null, "agent-secret"));

    expect(res.status).toBe(400);
    expect(mockCompose).not.toHaveBeenCalled();
  });

  /**
   * 404 rather than an empty string: a worker that fails loudly leaves a log
   * line to act on, where one handed an empty topic guide holds a full-length
   * conversation that scores zero on every rubric dimension.
   */
  it("404s when there is no screening to run", async () => {
    mockCompose.mockResolvedValue(null);

    const res = await GET(request(APP_ID, "agent-secret"));

    expect(res.status).toBe(404);
  });
});
