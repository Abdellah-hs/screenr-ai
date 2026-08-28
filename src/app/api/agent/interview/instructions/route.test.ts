import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ __brand: "admin-client" })),
}));
vi.mock("@/lib/interview/instructions", () => ({
  composeInterviewInstructions: vi.fn(),
}));

import { GET } from "./route";
import { composeInterviewInstructions } from "@/lib/interview/instructions";

const mockCompose = vi.mocked(composeInterviewInstructions);

const APP_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

function request(applicationId: string | null, secret?: string): Request {
  const url = new URL("http://localhost/api/agent/interview/instructions");
  if (applicationId !== null) url.searchParams.set("application_id", applicationId);
  return new Request(url, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENT_API_SECRET = "agent-secret";
  mockCompose.mockResolvedValue("Your interviewing stance — PRESSURE");
});

describe("GET /api/agent/interview/instructions", () => {
  it("returns the composed instructions to a correctly authenticated worker", async () => {
    const res = await GET(request(APP_ID, "agent-secret"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      instructions: "Your interviewing stance — PRESSURE",
    });
    expect(mockCompose).toHaveBeenCalledWith(
      APP_ID,
      expect.objectContaining({ __brand: "admin-client" }),
    );
  });

  // These instructions embed the candidate's own résumé and the campaign's
  // interviewing stance; the shared secret is what keeps both off the wire to
  // the candidate's browser.
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

  it("404s when there is no interview to run", async () => {
    mockCompose.mockResolvedValue(null);

    const res = await GET(request(APP_ID, "agent-secret"));

    expect(res.status).toBe(404);
  });
});
