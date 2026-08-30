import { beforeEach, describe, expect, it, vi } from "vitest";

// A chainable, awaitable Supabase-query stub. Every filter method returns the
// same chain; awaiting the chain (or calling maybeSingle) resolves to `result`.
type Result = { data?: unknown; error: unknown };
function makeChain(result: Result) {
  const chain = {
    update: vi.fn(() => chain),
    upsert: vi.fn(() => Promise.resolve(result)),
    insert: vi.fn(() => Promise.resolve(result)),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    not: vi.fn(() => chain),
    lt: vi.fn(() => chain),
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
  appendProctoringSnapshot,
  saveProctoringSnapshots,
  saveProctoringReport,
  saveInterviewTranscriptDraft,
  saveVisionObservationsDraft,
  finalizeInterviewTranscript,
  fetchOverdueInterviewSessions,
  markInterviewExpired,
  markInterviewFailed,
  saveInterviewScore,
  type InterviewScore,
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

describe("saveProctoringReport", () => {
  const report = {
    incidents: [
      {
        type: "tab_blur" as const,
        at: "2026-07-29T10:00:00.000Z",
        duration_ms: 4_000,
        severity: "warning" as const,
        source: "client" as const,
      },
    ],
    summary: {
      tab_blur_count: 1,
      tab_blur_total_ms: 4_000,
      camera_off_count: 0,
      camera_off_total_ms: 0,
      person_absent_count: 0,
      person_absent_total_ms: 0,
      multiple_people_count: 0,
      multiple_people_total_ms: 0,
      phone_visible_count: 0,
      phone_visible_total_ms: 0,
      vision_sampled: false,
      overall_severity: "warning" as const,
    },
    report_version: "proctoring-v3",
    generated_at: "2026-07-29T10:20:00.000Z",
  };

  it("writes the report only while the session is still open", async () => {
    await saveProctoringReport("app-1", report, db as never);

    expect(db.from).toHaveBeenCalledWith("interview_sessions");
    expect(chain.update).toHaveBeenCalledWith({ proctoring: report });
    expect(chain.eq).toHaveBeenCalledWith("application_id", "app-1");
    expect(chain.in).toHaveBeenCalledWith("status", ["invited", "in_progress"]);
  });

  it("throws when the proctoring write fails", async () => {
    useResult({ error: new Error("nope") });
    await expect(
      saveProctoringReport("app-1", report, db as never),
    ).rejects.toThrow("nope");
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

describe("saveInterviewScore", () => {
  const score: InterviewScore = {
    overall_score: 85,
    overall_rationale: "Strong systems depth.",
    dimensions: [{ name: "Technical depth", score: 90, rationale: "ledger rewrite" }],
    strengths: ["Ledger systems"],
    concerns: [],
    rubric_version: 3,
    scored_at: "2026-07-27T00:00:00.000Z",
  };

  it("writes the score onto the session and inserts a matching audit row", async () => {
    await saveInterviewScore(
      {
        applicationId: "app-1",
        campaignId: "camp-1",
        candidateId: "cand-1",
        score,
        audit: { model: "gpt-4o-mini", promptVersion: "v1", rawOutput: "{}", inputSnapshot: {} },
      },
      db as never,
    );

    expect(db.from).toHaveBeenCalledWith("interview_sessions");
    expect(chain.update).toHaveBeenCalledWith({ scores: score });
    expect(chain.eq).toHaveBeenCalledWith("application_id", "app-1");

    expect(db.from).toHaveBeenCalledWith("ai_audit_log");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "interview_scoring",
        parsed_score: 85,
        rubric_version: "3",
        candidate_id: "cand-1",
      }),
    );
  });

  it("throws when the session write fails", async () => {
    useResult({ error: new Error("db down") });
    await expect(
      saveInterviewScore(
        {
          applicationId: "app-1",
          campaignId: "camp-1",
          candidateId: "cand-1",
          score,
          audit: { model: "m", promptVersion: "v", rawOutput: "{}", inputSnapshot: {} },
        },
        db as never,
      ),
    ).rejects.toThrow("db down");
  });
});

describe("appendProctoringSnapshot", () => {
  const snapshot = {
    at: "2026-08-04T12:00:00.000Z",
    conditions: ["multiple_people" as const, "phone_visible" as const],
    key: "camp/app/1.jpg",
  };

  // Append, not overwrite: each image is uploaded once and the row only carries
  // its key, so re-sending the whole set would mean re-uploading every image.
  it("appends to the existing draft rather than replacing it", async () => {
    useResult({
      data: {
        status: "in_progress",
        proctoring_snapshots: [
          { at: "2026-08-04T11:59:00.000Z", condition: "phone_visible", key: "camp/app/0.jpg" },
        ],
      },
      error: null,
    });

    const ok = await appendProctoringSnapshot("app-1", snapshot, db as never);

    expect(ok).toBe(true);
    expect(chain.update).toHaveBeenCalledWith({
      proctoring_snapshots: [
        { at: "2026-08-04T11:59:00.000Z", condition: "phone_visible", key: "camp/app/0.jpg" },
        snapshot,
      ],
    });
    expect(chain.in).toHaveBeenCalledWith("status", ["invited", "in_progress"]);
  });

  it("starts a draft when the session has none yet", async () => {
    useResult({ data: { status: "invited", proctoring_snapshots: null }, error: null });

    await appendProctoringSnapshot("app-1", snapshot, db as never);

    expect(chain.update).toHaveBeenCalledWith({ proctoring_snapshots: [snapshot] });
  });

  // The caller deletes the object it just uploaded when this returns false, so
  // a finished interview never accumulates images nothing references.
  it("reports failure without writing when the session is closed", async () => {
    useResult({ data: { status: "completed", proctoring_snapshots: [] }, error: null });

    const ok = await appendProctoringSnapshot("app-1", snapshot, db as never);

    expect(ok).toBe(false);
    expect(chain.update).not.toHaveBeenCalled();
  });

  it("reports failure when there is no session at all", async () => {
    useResult({ data: null, error: null });

    expect(await appendProctoringSnapshot("app-1", snapshot, db as never)).toBe(false);
  });

  it("throws when the read fails", async () => {
    useResult({ data: null, error: new Error("boom") });

    await expect(
      appendProctoringSnapshot("app-1", snapshot, db as never),
    ).rejects.toThrow("boom");
  });
});

describe("saveProctoringSnapshots", () => {
  it("replaces the draft index only while the session is still open", async () => {
    await saveProctoringSnapshots("app-1", [], db as never);

    expect(chain.update).toHaveBeenCalledWith({ proctoring_snapshots: [] });
    expect(chain.in).toHaveBeenCalledWith("status", ["invited", "in_progress"]);
  });

  it("throws when the write fails", async () => {
    useResult({ error: new Error("nope") });

    await expect(
      saveProctoringSnapshots("app-1", [], db as never),
    ).rejects.toThrow("nope");
  });
});

describe("saveVisionObservationsDraft", () => {
  const observations = [
    { at: "2026-08-03T10:00:00.000Z", person_count: 1, confidence: 0.95, phone_count: 0 },
    { at: "2026-08-03T10:00:10.000Z", person_count: 0, confidence: 0.72, phone_count: 0 },
  ];

  it("writes the samples only while the session is still open", async () => {
    await saveVisionObservationsDraft("app-1", observations, db as never);

    expect(db.from).toHaveBeenCalledWith("interview_sessions");
    expect(chain.update).toHaveBeenCalledWith({ proctoring_observations: observations });
    expect(chain.eq).toHaveBeenCalledWith("application_id", "app-1");
    // The guard: a late report can't attach evidence to a finalized interview.
    expect(chain.in).toHaveBeenCalledWith("status", ["invited", "in_progress"]);
  });

  it("throws when the write fails", async () => {
    useResult({ error: new Error("nope") });

    await expect(
      saveVisionObservationsDraft("app-1", observations, db as never),
    ).rejects.toThrow("nope");
  });
});

describe("fetchOverdueInterviewSessions", () => {
  const NOW = new Date("2026-08-18T12:00:00.000Z");

  it("selects only open sessions with a deadline already in the past", async () => {
    useResult({ data: [], error: null });

    await fetchOverdueInterviewSessions(NOW, db as never);

    expect(db.from).toHaveBeenCalledWith("interview_sessions");
    expect(chain.in).toHaveBeenCalledWith("status", ["invited", "in_progress"]);
    // A session with no deadline is excluded rather than swept — guessing one
    // would close an invitation nobody ever dated.
    expect(chain.not).toHaveBeenCalledWith("expires_at", "is", null);
    expect(chain.lt).toHaveBeenCalledWith("expires_at", NOW.toISOString());
  });

  it("returns the status and start time the abandonment rule needs", async () => {
    const row = {
      application_id: "app-1",
      status: "in_progress",
      expires_at: "2026-08-17T12:00:00.000Z",
      started_at: "2026-08-17T11:55:00.000Z",
    };
    useResult({ data: [row], error: null });

    const rows = await fetchOverdueInterviewSessions(NOW, db as never);

    // Without started_at the sweep can't tell an abandoned call from a live one.
    expect(rows).toEqual([row]);
    expect(chain.select).toHaveBeenCalledWith(
      "application_id, status, expires_at, started_at",
    );
  });

  it("throws when the query fails, so the sweep reports rather than sweeping nothing", async () => {
    useResult({ data: null, error: { message: "column does not exist" } });

    await expect(fetchOverdueInterviewSessions(NOW, db as never)).rejects.toThrow(
      /column does not exist/,
    );
  });
});
