import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ __brand: "admin-client" })),
}));
vi.mock("@/lib/data/interview-sessions", () => ({
  fetchInterviewSessionByApplicationId: vi.fn(),
  appendProctoringSnapshot: vi.fn(),
}));
vi.mock("@/lib/data/candidates", () => ({
  fetchInterviewContextByApplicationId: vi.fn(),
  uploadProctoringSnapshot: vi.fn(),
  deleteProctoringSnapshots: vi.fn(),
}));

import { POST } from "./route";
import {
  fetchInterviewSessionByApplicationId,
  appendProctoringSnapshot,
} from "@/lib/data/interview-sessions";
import {
  fetchInterviewContextByApplicationId,
  uploadProctoringSnapshot,
  deleteProctoringSnapshots,
} from "@/lib/data/candidates";

const mockFetchSession = vi.mocked(fetchInterviewSessionByApplicationId);
const mockAppend = vi.mocked(appendProctoringSnapshot);
const mockFetchContext = vi.mocked(fetchInterviewContextByApplicationId);
const mockUpload = vi.mocked(uploadProctoringSnapshot);
const mockDelete = vi.mocked(deleteProctoringSnapshots);

const APP_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const CAMPAIGN_ID = "11111111-2222-3333-4444-555555555555";
const KEY = `${CAMPAIGN_ID}/${APP_ID}/1754308800000.jpg`;

/** A tiny but valid base64 payload — the route never decodes it as an image. */
const IMAGE = Buffer.from("fake-jpeg-bytes").toString("base64");

function body(overrides: Record<string, unknown> = {}) {
  return {
    application_id: APP_ID,
    at: "2026-08-04T12:00:00.000Z",
    condition: "multiple_people",
    image_base64: IMAGE,
    ...overrides,
  };
}

function request(payload: unknown, secret?: string): Request {
  return new Request("http://localhost/api/agent/interview/snapshot", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENT_API_SECRET = "agent-secret";
  mockFetchSession.mockResolvedValue({ status: "in_progress" } as never);
  mockFetchContext.mockResolvedValue({ campaign_id: CAMPAIGN_ID } as never);
  mockUpload.mockResolvedValue(KEY);
  mockAppend.mockResolvedValue(true);
});

describe("POST /api/agent/interview/snapshot", () => {
  it("uploads the still and records its key on the session", async () => {
    const res = await POST(request(body(), "agent-secret"));

    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: CAMPAIGN_ID, applicationId: APP_ID }),
      expect.objectContaining({ __brand: "admin-client" }),
    );
    expect(mockAppend).toHaveBeenCalledWith(
      APP_ID,
      { at: "2026-08-04T12:00:00.000Z", condition: "multiple_people", key: KEY },
      expect.anything(),
    );
  });

  // The campaign id is the first path segment the bucket's RLS scopes on, so it
  // must come from the application server-side — never from the caller.
  it("ignores a campaign id supplied by the caller", async () => {
    await POST(request(body({ campaign_id: "99999999-9999-9999-9999-999999999999" }), "agent-secret"));

    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: CAMPAIGN_ID }),
      expect.anything(),
    );
  });

  it("rejects a missing or wrong bearer secret without uploading", async () => {
    const missing = await POST(request(body()));
    const wrong = await POST(request(body(), "nope"));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("fails closed when AGENT_API_SECRET is not configured", async () => {
    delete process.env.AGENT_API_SECRET;

    const res = await POST(request(body(), "anything"));

    expect(res.status).toBe(500);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  // A replayed or late report must not be able to push images into the bucket
  // for an interview that is already finished.
  it("refuses to spend an upload on a session that is not open", async () => {
    mockFetchSession.mockResolvedValue({ status: "completed" } as never);

    const res = await POST(request(body(), "agent-secret"));

    expect(res.status).toBe(409);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  // An image nothing references is exactly what this feature is careful not to
  // accumulate, so a lost race deletes what it just uploaded.
  it("deletes the object when the session closed mid-request", async () => {
    mockAppend.mockResolvedValue(false);

    const res = await POST(request(body(), "agent-secret"));

    expect(res.status).toBe(409);
    expect(mockDelete).toHaveBeenCalledWith([KEY], expect.anything());
  });

  it("rejects malformed payloads with 400", async () => {
    const badId = await POST(request(body({ application_id: "nope" }), "agent-secret"));
    const badCondition = await POST(
      request(body({ condition: "looked_shifty" }), "agent-secret"),
    );
    const badTimestamp = await POST(request(body({ at: "not-a-date" }), "agent-secret"));
    const noImage = await POST(request(body({ image_base64: "" }), "agent-secret"));

    expect([
      badId.status,
      badCondition.status,
      badTimestamp.status,
      noImage.status,
    ]).toEqual([400, 400, 400, 400]);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  // The one agent report that carries bytes: an oversized payload must bounce
  // before anything reaches storage.
  it("rejects an oversized image", async () => {
    const huge = "A".repeat(512 * 1024 + 1);

    const res = await POST(request(body({ image_base64: huge }), "agent-secret"));

    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
