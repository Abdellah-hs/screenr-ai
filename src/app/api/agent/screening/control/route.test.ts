import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ __brand: "admin-client" })),
}));
vi.mock("@/lib/screening/topic-control", () => ({
  applyScreeningControlEvent: vi.fn(),
}));

import { POST } from "./route";
import { applyScreeningControlEvent } from "@/lib/screening/topic-control";

const mockApply = vi.mocked(applyScreeningControlEvent);

const APP_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

function request(body: unknown, secret?: string): Request {
  return new Request("http://localhost/api/agent/screening/control", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function directive(over = {}) {
  return {
    task: "ask_primary_question" as const,
    topicNumber: 2,
    topicPrompt: "How do you decide what to test?",
    followUpQuestion: null,
    followUpsLeft: 1,
    remainingUnasked: 2,
    awaitingAnswer: false,
    phase: "interviewing" as const,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENT_API_SECRET = "agent-secret";
  mockApply.mockResolvedValue({
    directive: directive(),
    closeAllowed: false,
    wrapUpInMs: 120_000,
    answerDueInMs: 60_000,
    answerRunning: true,
    deadlineAt: "2026-08-24T10:09:00.000Z",
  });
});

describe("POST /api/agent/screening/control", () => {
  it("applies the event through the admin client and returns the directive", async () => {
    const res = await POST(
      request(
        { application_id: APP_ID, event: { type: "topic_started", event_id: "t1" } },
        "agent-secret",
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.directive.topicPrompt).toBe("How do you decide what to test?");
    expect(body.close_allowed).toBe(false);
    expect(mockApply).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APP_ID,
        // A body with no `stamped` flag is an older worker's, and reads as
        // "the interviewer asked for this through `next_topic`" — the reading
        // that withholds a correction rather than inventing one.
        event: { type: "topic_started", eventId: "t1", stamped: false },
        db: expect.objectContaining({ __brand: "admin-client" }),
      }),
    );
  });

  /**
   * The control block is composed here rather than in the pipeline so the
   * interviewer's wording lives with the rest of its prompt — and so a change
   * to it is a change to `SCREENING_PROMPT_VERSION`.
   */
  it("renders the control block for the interviewer to be steered by", async () => {
    const res = await POST(
      request(
        { application_id: APP_ID, event: { type: "topic_started", event_id: "t1" } },
        "agent-secret",
      ),
    );
    const body = await res.json();

    expect(body.control_block).toContain("INTERVIEW CONTROL");
    expect(body.control_block).toContain("Topics not yet raised: 2");
    expect(body.control_block).toContain("How do you decide what to test?");
  });

  it("rejects a missing or wrong bearer secret without touching the ledger", async () => {
    const missing = await POST(
      request({ application_id: APP_ID, event: { type: "topic_started", event_id: "t1" } }),
    );
    const wrong = await POST(
      request(
        { application_id: APP_ID, event: { type: "topic_started", event_id: "t1" } },
        "nope",
      ),
    );

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("fails closed when AGENT_API_SECRET is not configured", async () => {
    delete process.env.AGENT_API_SECRET;

    const res = await POST(
      request(
        { application_id: APP_ID, event: { type: "topic_started", event_id: "t1" } },
        "anything",
      ),
    );

    expect(res.status).toBe(500);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("rejects a malformed body with 400", async () => {
    const badId = await POST(
      request(
        { application_id: "nope", event: { type: "topic_started", event_id: "t1" } },
        "agent-secret",
      ),
    );
    const badEvent = await POST(
      request({ application_id: APP_ID, event: { type: "nonsense" } }, "agent-secret"),
    );
    const emptyTurn = await POST(
      request(
        {
          application_id: APP_ID,
          event: {
            type: "turn_completed",
            event_id: "t1",
            candidate_text: "",
            interviewer_text: null,
          },
        },
        "agent-secret",
      ),
    );

    expect(badId.status).toBe(400);
    expect(badEvent.status).toBe(400);
    expect(emptyTurn.status).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
  });

  /**
   * Unlike the instructions route, a 404 here is not fatal for the worker: an
   * interviewer with no ledger still has its topic guide, so it carries on
   * unmanaged rather than stranding the candidate in a silent room.
   */
  it("answers 404 when there is nothing to control", async () => {
    mockApply.mockResolvedValue(null);

    const res = await POST(
      request(
        { application_id: APP_ID, event: { type: "topic_started", event_id: "t1" } },
        "agent-secret",
      ),
    );

    expect(res.status).toBe(404);
  });

  it("passes a finalized turn through with both halves of the exchange", async () => {
    await POST(
      request(
        {
          application_id: APP_ID,
          event: {
            type: "turn_completed",
            event_id: "item-9",
            candidate_text: "We moved onto Kafka.",
            interviewer_text: "Describe a scaling problem you solved.",
          },
        },
        "agent-secret",
      ),
    );

    expect(mockApply).toHaveBeenCalledWith(
      expect.objectContaining({
        event: {
          type: "turn_completed",
          eventId: "item-9",
          candidateText: "We moved onto Kafka.",
          interviewerText: "Describe a scaling problem you solved.",
        },
      }),
    );
  });
});
