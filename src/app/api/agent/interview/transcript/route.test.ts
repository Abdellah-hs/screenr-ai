import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ __brand: "admin-client" })),
}));
vi.mock("@/lib/data/interview-sessions", () => ({
  saveInterviewTranscriptDraft: vi.fn(),
}));

import { POST } from "./route";
import { saveInterviewTranscriptDraft } from "@/lib/data/interview-sessions";

const mockSaveDraft = vi.mocked(saveInterviewTranscriptDraft);

const APP_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

function request(body: unknown, secret?: string): Request {
  return new Request("http://localhost/api/agent/interview/transcript", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function turns() {
  return [
    { role: "agent", text: "Tell me about your Stripe work.", at: "2026-07-22T10:00:00Z" },
    { role: "candidate", text: "I led the ledger rewrite.", at: "2026-07-22T10:00:10Z" },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENT_API_SECRET = "agent-secret";
});

describe("POST /api/agent/interview/transcript", () => {
  it("persists the reported turns as a draft via the admin client", async () => {
    const res = await POST(request({ application_id: APP_ID, transcript: turns() }, "agent-secret"));

    expect(res.status).toBe(200);
    expect(mockSaveDraft).toHaveBeenCalledWith(
      APP_ID,
      turns(),
      expect.objectContaining({ __brand: "admin-client" }),
    );
  });

  it("rejects a missing or wrong bearer secret without touching the database", async () => {
    const missing = await POST(request({ application_id: APP_ID, transcript: turns() }));
    const wrong = await POST(request({ application_id: APP_ID, transcript: turns() }, "nope"));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("fails closed when AGENT_API_SECRET is not configured", async () => {
    delete process.env.AGENT_API_SECRET;

    const res = await POST(request({ application_id: APP_ID, transcript: turns() }, "anything"));

    expect(res.status).toBe(500);
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("rejects a malformed body (bad uuid, empty transcript) with 400", async () => {
    const badId = await POST(request({ application_id: "nope", transcript: turns() }, "agent-secret"));
    const empty = await POST(request({ application_id: APP_ID, transcript: [] }, "agent-secret"));

    expect(badId.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("accepts an agent-only transcript (candidate never spoke yet) — the submit gate is elsewhere", async () => {
    const res = await POST(
      request(
        {
          application_id: APP_ID,
          transcript: [{ role: "agent", text: "Hello?", at: "2026-07-22T10:00:00Z" }],
        },
        "agent-secret",
      ),
    );

    expect(res.status).toBe(200);
    expect(mockSaveDraft).toHaveBeenCalled();
  });
});
