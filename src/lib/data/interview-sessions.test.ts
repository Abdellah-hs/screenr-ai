import { beforeEach, describe, expect, it, vi } from "vitest";

// A chainable, awaitable Supabase-query stub. Every filter method returns the
// same chain; awaiting the chain (or calling maybeSingle) resolves to `result`.
type Result = { data?: unknown; error: unknown };
function makeChain(result: Result) {
  const chain = {
    update: vi.fn(() => chain),
    upsert: vi.fn(() => Promise.resolve(result)),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (r: Result) => void) => resolve(result),
  };
  return chain;
}

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

import {
  fetchInterviewSessionByApplicationId,
  ensureInterviewSession,
  markInterviewStarted,
  saveInterviewTranscriptDraft,
  finalizeInterviewTranscript,
  markInterviewExpired,
  markInterviewFailed,
} from "./interview-sessions";

let chain: ReturnType<typeof makeChain>;
let db: { from: ReturnType<typeof vi.fn> };

function useResult(result: Result) {
  chain = makeChain(result);
  db = { from: vi.fn(() => chain) };
}

beforeEach(() => {
  vi.clearAllMocks();
  useResult({ data: null, error: null });
  mockCreateClient.mockImplementation(async () => db);
});

describe("fetchInterviewSessionByApplicationId", () => {
  it("returns the row for the application", async () => {
    useResult({ data: { id: "s-1", application_id: "app-1", status: "invited" }, error: null });
    mockCreateClient.mockResolvedValue(db);

    const row = await fetchInterviewSessionByApplicationId("app-1");

    expect(db.from).toHaveBeenCalledWith("interview_sessions");
    expect(chain.eq).toHaveBeenCalledWith("application_id", "app-1");
    expect(row).toMatchObject({ id: "s-1", status: "invited" });
  });

  it("returns null when the query errors", async () => {
    useResult({ data: null, error: new Error("boom") });
    mockCreateClient.mockResolvedValue(db);

    expect(await fetchInterviewSessionByApplicationId("app-1")).toBeNull();
  });
});

describe("ensureInterviewSession", () => {
  it("upserts an invited row keyed on application_id without overwriting an existing one", async () => {
    await ensureInterviewSession("app-1", new Date("2026-08-01T00:00:00Z"), db as never);

    expect(db.from).toHaveBeenCalledWith("interview_sessions");
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        application_id: "app-1",
        status: "invited",
        expires_at: "2026-08-01T00:00:00.000Z",
      }),
      { onConflict: "application_id", ignoreDuplicates: true },
    );
  });

  it("throws when the upsert fails", async () => {
    useResult({ error: new Error("db down") });
    await expect(
      ensureInterviewSession("app-1", null, db as never),
    ).rejects.toThrow("db down");
  });
});

describe("markInterviewStarted", () => {
  it("flips an invited/in-progress session to in_progress and stamps started_at", async () => {
    await markInterviewStarted("app-1", db as never);

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in_progress", started_at: expect.any(String) }),
    );
    expect(chain.eq).toHaveBeenCalledWith("application_id", "app-1");
    expect(chain.in).toHaveBeenCalledWith("status", ["invited", "in_progress"]);
  });
});

describe("saveInterviewTranscriptDraft", () => {
  it("writes the transcript only while the session is still open", async () => {
    const turns = [{ role: "agent" as const, text: "Hi", at: "2026-07-22T00:00:00Z" }];

    await saveInterviewTranscriptDraft("app-1", turns, db as never);

    expect(chain.update).toHaveBeenCalledWith({ transcript: turns });
    expect(chain.eq).toHaveBeenCalledWith("application_id", "app-1");
    expect(chain.in).toHaveBeenCalledWith("status", ["invited", "in_progress"]);
  });

  it("throws when the draft write fails", async () => {
    useResult({ error: new Error("nope") });
    await expect(
      saveInterviewTranscriptDraft("app-1", [], db as never),
    ).rejects.toThrow("nope");
  });
});

describe("finalizeInterviewTranscript", () => {
  it("persists the final transcript and marks the session completed", async () => {
    const turns = [
      { role: "agent" as const, text: "Q", at: "2026-07-22T00:00:00Z" },
      { role: "candidate" as const, text: "A", at: "2026-07-22T00:00:01Z" },
    ];

    await finalizeInterviewTranscript("app-1", turns, db as never);

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        transcript: turns,
        completed_at: expect.any(String),
      }),
    );
    expect(chain.eq).toHaveBeenCalledWith("application_id", "app-1");
  });

  it("throws when the finalize write fails", async () => {
    useResult({ error: new Error("write failed") });
    await expect(
      finalizeInterviewTranscript("app-1", [], db as never),
    ).rejects.toThrow("write failed");
  });
});

describe("markInterviewExpired / markInterviewFailed", () => {
  it("marks the session expired", async () => {
    await markInterviewExpired("app-1", db as never);
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: "expired" }));
  });

  it("marks the session failed", async () => {
    await markInterviewFailed("app-1", db as never);
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });
});
