import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockSingle = vi.fn();

const mockClient = {
  rpc: mockRpc,
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ single: mockSingle })),
    })),
  })),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockClient)),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mockClient),
}));

import { transitionApplication, transitionApplicationAsSystem } from "./transitions";

/** Put the application in a state that can legally reach `rejected`. */
function currentlyIn(status: string) {
  mockSingle.mockResolvedValue({ data: { status }, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  currentlyIn("manager_review");
  mockRpc.mockResolvedValue({ error: null });
});

describe("transitionApplication", () => {
  it("refuses to reject an application without a disposition", async () => {
    await expect(
      transitionApplication({
        applicationId: "app-1",
        toState: "rejected",
        actor: "system",
        rationale: "score below threshold",
      }),
    ).rejects.toThrow(/disposition/i);

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("refuses a disposition whose description is blank", async () => {
    await expect(
      transitionApplication({
        applicationId: "app-1",
        toState: "rejected",
        actor: "system",
        disposition: { code: "LOW_SCORE", description: "   " },
      }),
    ).rejects.toThrow(/disposition/i);

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("passes the disposition through to the RPC on a rejection", async () => {
    await transitionApplication({
      applicationId: "app-1",
      toState: "rejected",
      actor: "system",
      rationale: "resume 41/100",
      disposition: { code: "LOW_SCORE", description: "Scored 41, threshold 60" },
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "transition_application",
      expect.objectContaining({
        p_disposition_code: "LOW_SCORE",
        p_disposition_description: "Scored 41, threshold 60",
      }),
    );
  });

  it("sends nulls for a mid-pipeline transition that carries no disposition", async () => {
    currentlyIn("screening_approved");

    await transitionApplication({
      applicationId: "app-1",
      toState: "screening_sent",
      actor: "system",
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "transition_application",
      expect.objectContaining({
        p_disposition_code: null,
        p_disposition_description: null,
      }),
    );
  });

  it("does not require a disposition to hire", async () => {
    await transitionApplication({
      applicationId: "app-1",
      toState: "hired",
      actor: "recruiter",
      rationale: "strong across every stage",
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("still requires a written rationale from a recruiter", async () => {
    await expect(
      transitionApplication({
        applicationId: "app-1",
        toState: "rejected",
        actor: "recruiter",
        disposition: { code: "OVERRIDE_REJECTED", description: "not a fit" },
      }),
    ).rejects.toThrow(/rationale/i);
  });

  it("rejects an illegal transition before reaching the RPC", async () => {
    currentlyIn("new");

    await expect(
      transitionApplication({
        applicationId: "app-1",
        toState: "hired",
        actor: "recruiter",
        rationale: "skipping ahead",
      }),
    ).rejects.toThrow(/Illegal transition/);

    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("transitionApplicationAsSystem", () => {
  it("refuses to archive without a disposition", async () => {
    currentlyIn("screening_expired");

    await expect(
      transitionApplicationAsSystem("app-1", "archived", "cleaning up"),
    ).rejects.toThrow(/disposition/i);

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("passes the disposition through to the system RPC", async () => {
    currentlyIn("screening_expired");

    await transitionApplicationAsSystem("app-1", "archived", "swept", {
      code: "EXPIRED",
      description: "Screening deadline passed",
    });

    expect(mockRpc).toHaveBeenCalledWith(
      "transition_application_system",
      expect.objectContaining({
        p_disposition_code: "EXPIRED",
        p_disposition_description: "Screening deadline passed",
      }),
    );
  });

  it("lets a self-describing failure state through without one", async () => {
    currentlyIn("screening_sent");

    await transitionApplicationAsSystem("app-1", "screening_expired", "deadline passed");

    expect(mockRpc).toHaveBeenCalledWith(
      "transition_application_system",
      expect.objectContaining({ p_disposition_code: null }),
    );
  });
});
