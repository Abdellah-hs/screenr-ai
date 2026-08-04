import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ __brand: "admin-client" })),
}));
vi.mock("@/lib/data/interview-sessions", () => ({
  saveVisionObservationsDraft: vi.fn(),
}));

import { POST } from "./route";
import { saveVisionObservationsDraft } from "@/lib/data/interview-sessions";

const mockSaveDraft = vi.mocked(saveVisionObservationsDraft);

const APP_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

function request(body: unknown, secret?: string): Request {
  return new Request("http://localhost/api/agent/interview/proctoring", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function observations() {
  return [
    { at: "2026-08-03T10:00:00.000Z", person_count: 1, confidence: 0.95, phone_count: 0 },
    { at: "2026-08-03T10:00:10.000Z", person_count: 2, confidence: 0.81, phone_count: 1 },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENT_API_SECRET = "agent-secret";
});

describe("POST /api/agent/interview/proctoring", () => {
  it("persists the reported observations as a draft via the admin client", async () => {
    const res = await POST(
      request({ application_id: APP_ID, observations: observations() }, "agent-secret"),
    );

    expect(res.status).toBe(200);
    expect(mockSaveDraft).toHaveBeenCalledWith(
      APP_ID,
      observations(),
      expect.objectContaining({ __brand: "admin-client" }),
    );
  });

  it("rejects a missing or wrong bearer secret without touching the database", async () => {
    const missing = await POST(request({ application_id: APP_ID, observations: observations() }));
    const wrong = await POST(
      request({ application_id: APP_ID, observations: observations() }, "nope"),
    );

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("fails closed when AGENT_API_SECRET is not configured", async () => {
    delete process.env.AGENT_API_SECRET;

    const res = await POST(
      request({ application_id: APP_ID, observations: observations() }, "anything"),
    );

    expect(res.status).toBe(500);
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  // The worker reports readings; severity is the rule layer's job. Accepting a
  // pre-judged incident here would let anything holding the agent secret
  // manufacture an accusation against a candidate.
  it("ignores any severity or incident type the caller tries to smuggle in", async () => {
    const res = await POST(
      request(
        {
          application_id: APP_ID,
          observations: [
            {
              at: "2026-08-03T10:00:00.000Z",
              person_count: 2,
              confidence: 0.9,
              phone_count: 0,
              severity: "critical",
              type: "multiple_people",
            },
          ],
        },
        "agent-secret",
      ),
    );

    expect(res.status).toBe(200);
    const [, saved] = mockSaveDraft.mock.calls[0];
    expect(saved[0]).toEqual({
      at: "2026-08-03T10:00:00.000Z",
      person_count: 2,
      confidence: 0.9,
      phone_count: 0,
    });
  });

  it("rejects malformed observations with 400", async () => {
    const badId = await POST(
      request({ application_id: "nope", observations: observations() }, "agent-secret"),
    );
    const badConfidence = await POST(
      request(
        {
          application_id: APP_ID,
          observations: [
            { at: "2026-08-03T10:00:00.000Z", person_count: 1, confidence: 7, phone_count: 0 },
          ],
        },
        "agent-secret",
      ),
    );
    const badTimestamp = await POST(
      request(
        {
          application_id: APP_ID,
          observations: [{ at: "not-a-date", person_count: 1, confidence: 0.9, phone_count: 0 }],
        },
        "agent-secret",
      ),
    );
    const missingPhoneCount = await POST(
      request(
        {
          application_id: APP_ID,
          observations: [{ at: "2026-08-03T10:00:00.000Z", person_count: 1, confidence: 0.9 }],
        },
        "agent-secret",
      ),
    );

    expect([
      badId.status,
      badConfidence.status,
      badTimestamp.status,
      missingPhoneCount.status,
    ]).toEqual([400, 400, 400, 400]);
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("accepts an empty report — a watched interview with nothing usable yet", async () => {
    const res = await POST(request({ application_id: APP_ID, observations: [] }, "agent-secret"));

    expect(res.status).toBe(200);
    expect(mockSaveDraft).toHaveBeenCalledWith(APP_ID, [], expect.anything());
  });
});
