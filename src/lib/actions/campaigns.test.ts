import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireUserId,
  mockInsertCampaignTx,
  mockFetchCampaignScoringConfig,
  mockFetchCampaignStatus,
  mockUpdateCampaignStatusTx,
  mockSoftDeleteCampaignTx,
  mockRestoreCampaignTx,
  mockRevalidatePath,
  mockUpdateCampaignTx,
  mockFetchScreeningQuestions,
  mockReplaceScreeningQuestions,
  mockUpdateCampaignRubricsTx,
  mockRedirect,
} = vi.hoisted(() => ({
  mockRequireUserId: vi.fn(),
  mockInsertCampaignTx: vi.fn(),
  mockFetchCampaignScoringConfig: vi.fn(),
  mockFetchCampaignStatus: vi.fn(),
  mockUpdateCampaignStatusTx: vi.fn(),
  mockSoftDeleteCampaignTx: vi.fn(),
  mockRestoreCampaignTx: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockUpdateCampaignTx: vi.fn(),
  mockFetchScreeningQuestions: vi.fn(),
  mockReplaceScreeningQuestions: vi.fn(),
  mockUpdateCampaignRubricsTx: vi.fn(),
  mockRedirect: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireUserId: mockRequireUserId,
}));

vi.mock("@/lib/data/campaigns", () => ({
  fetchAllCampaigns: vi.fn(),
  fetchCampaignById: vi.fn(),
  insertCampaignTx: mockInsertCampaignTx,
  updateCampaignTx: mockUpdateCampaignTx,
  updateCampaignRubricsTx: mockUpdateCampaignRubricsTx,
  cloneCampaignTx: vi.fn(),
  fetchCampaignScoringConfig: mockFetchCampaignScoringConfig,
  fetchCampaignStatus: mockFetchCampaignStatus,
  updateCampaignStatusTx: mockUpdateCampaignStatusTx,
  softDeleteCampaignTx: mockSoftDeleteCampaignTx,
  restoreCampaignTx: mockRestoreCampaignTx,
}));

vi.mock("@/lib/data/screening-questions", () => ({
  fetchScreeningQuestionsByCampaignId: mockFetchScreeningQuestions,
  replaceScreeningQuestions: mockReplaceScreeningQuestions,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

// updateCampaign delegates post-save scoring to this action. Mock it so importing
// campaigns.ts doesn't pull in the real candidates module (which instantiates an
// OpenAI client at load via the screening-questions service).
vi.mock("./candidates", () => ({
  scoreUnscoredCampaignCandidates: vi.fn(),
}));

import {
  createCampaign,
  saveCampaignRubrics,
  getCampaignById,
  getResumeCriteriaCount,
  updateCampaign,
  updateCampaignStatus,
  deleteCampaign,
  deleteCampaigns,
  updateCampaignsStatus,
  restoreCampaign,
} from "./campaigns";
import { fetchCampaignById } from "@/lib/data/campaigns";

const VALID_CAMPAIGN_ID = "660e8400-e29b-41d4-a716-446655440001";
const VALID_CAMPAIGN_ID_2 = "770e8400-e29b-41d4-a716-446655440002";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUserId.mockResolvedValue("user-1");
  mockFetchScreeningQuestions.mockResolvedValue([]);
});

describe("getCampaignById", () => {
  it("returns null for a malformed id without querying the database", async () => {
    // e.g. a literal /campaigns/undefined URL — must not reach Supabase.
    await expect(getCampaignById("undefined")).resolves.toBeNull();
    expect(vi.mocked(fetchCampaignById)).not.toHaveBeenCalled();
  });

  it("delegates to fetchCampaignById for a valid uuid", async () => {
    vi.mocked(fetchCampaignById).mockResolvedValue({ id: VALID_CAMPAIGN_ID } as never);

    await expect(getCampaignById(VALID_CAMPAIGN_ID)).resolves.toEqual({
      id: VALID_CAMPAIGN_ID,
    });
    expect(vi.mocked(fetchCampaignById)).toHaveBeenCalledWith(VALID_CAMPAIGN_ID, "user-1");
  });
});

describe("restoreCampaign", () => {
  it("rejects unauthenticated callers before restoring", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(restoreCampaign(VALID_CAMPAIGN_ID)).rejects.toThrow("Unauthorized");
    expect(mockRestoreCampaignTx).not.toHaveBeenCalled();
  });

  it("rejects a malformed campaign id before touching the data layer", async () => {
    await expect(restoreCampaign("not-a-uuid")).rejects.toThrow();
    expect(mockRestoreCampaignTx).not.toHaveBeenCalled();
  });

  it("restores the owned campaign and revalidates the pool + list", async () => {
    mockRestoreCampaignTx.mockResolvedValue(undefined);

    await restoreCampaign(VALID_CAMPAIGN_ID);

    expect(mockRestoreCampaignTx).toHaveBeenCalledWith(VALID_CAMPAIGN_ID, "user-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/candidates");
  });
});

describe("getResumeCriteriaCount", () => {
  it("rejects unauthenticated callers before querying", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(getResumeCriteriaCount(VALID_CAMPAIGN_ID)).rejects.toThrow("Unauthorized");
    expect(mockFetchCampaignScoringConfig).not.toHaveBeenCalled();
  });

  it("rejects an invalid campaign id (uuid format)", async () => {
    await expect(getResumeCriteriaCount("not-a-uuid")).rejects.toThrow();
    expect(mockFetchCampaignScoringConfig).not.toHaveBeenCalled();
  });

  it("returns 0 when the campaign has no scoring config", async () => {
    mockFetchCampaignScoringConfig.mockResolvedValue(null);

    await expect(getResumeCriteriaCount(VALID_CAMPAIGN_ID)).resolves.toBe(0);
  });

  it("returns 0 when the config exists but has no criteria", async () => {
    mockFetchCampaignScoringConfig.mockResolvedValue({ screening_criteria: [] });

    await expect(getResumeCriteriaCount(VALID_CAMPAIGN_ID)).resolves.toBe(0);
  });

  it("returns the number of screening criteria when configured", async () => {
    mockFetchCampaignScoringConfig.mockResolvedValue({
      screening_criteria: [{ label: "a" }, { label: "b" }, { label: "c" }],
    });

    await expect(getResumeCriteriaCount(VALID_CAMPAIGN_ID)).resolves.toBe(3);
  });
});

describe("updateCampaignStatus", () => {
  it("rejects unauthenticated callers before reading anything", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(updateCampaignStatus(VALID_CAMPAIGN_ID, "active")).rejects.toThrow(
      "Unauthorized",
    );
    expect(mockFetchCampaignStatus).not.toHaveBeenCalled();
    expect(mockUpdateCampaignStatusTx).not.toHaveBeenCalled();
  });

  it("rejects an invalid campaign id", async () => {
    await expect(updateCampaignStatus("not-a-uuid", "active")).rejects.toThrow();
    expect(mockUpdateCampaignStatusTx).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value", async () => {
    await expect(
      updateCampaignStatus(VALID_CAMPAIGN_ID, "bogus" as never),
    ).rejects.toThrow();
    expect(mockUpdateCampaignStatusTx).not.toHaveBeenCalled();
  });

  it("throws when the campaign is missing or not owned", async () => {
    mockFetchCampaignStatus.mockResolvedValue(null);

    await expect(updateCampaignStatus(VALID_CAMPAIGN_ID, "active")).rejects.toThrow(
      "Campaign not found",
    );
    expect(mockUpdateCampaignStatusTx).not.toHaveBeenCalled();
  });

  it("sets any status freely, including formerly-restricted moves (draft → paused)", async () => {
    mockFetchCampaignStatus.mockResolvedValue("draft");

    await updateCampaignStatus(VALID_CAMPAIGN_ID, "paused");

    expect(mockUpdateCampaignStatusTx).toHaveBeenCalledWith(
      VALID_CAMPAIGN_ID,
      "draft",
      "paused",
      "user-1",
      true,
    );
  });

  it("decodes 'active_no_intake' to active + intake closed", async () => {
    mockFetchCampaignStatus.mockResolvedValue("draft");

    await updateCampaignStatus(VALID_CAMPAIGN_ID, "active_no_intake");

    expect(mockUpdateCampaignStatusTx).toHaveBeenCalledWith(
      VALID_CAMPAIGN_ID,
      "draft",
      "active",
      "user-1",
      false,
    );
  });

  it("persists the change and revalidates the campaign subtree and list", async () => {
    mockFetchCampaignStatus.mockResolvedValue("draft");

    await updateCampaignStatus(VALID_CAMPAIGN_ID, "active");

    expect(mockUpdateCampaignStatusTx).toHaveBeenCalledWith(
      VALID_CAMPAIGN_ID,
      "draft",
      "active",
      "user-1",
      true,
    );
    // "layout" so the candidate detail pages under the campaign (whose
    // controls are freeze-gated on this status) refresh too.
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/campaigns/${VALID_CAMPAIGN_ID}`,
      "layout",
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/campaigns");
  });
});

describe("deleteCampaign", () => {
  it("rejects unauthenticated callers before deleting", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(deleteCampaign(VALID_CAMPAIGN_ID)).rejects.toThrow("Unauthorized");
    expect(mockSoftDeleteCampaignTx).not.toHaveBeenCalled();
  });

  it("rejects an invalid campaign id", async () => {
    await expect(deleteCampaign("not-a-uuid")).rejects.toThrow();
    expect(mockSoftDeleteCampaignTx).not.toHaveBeenCalled();
  });

  it("soft-deletes the campaign and revalidates the list", async () => {
    await deleteCampaign(VALID_CAMPAIGN_ID);

    expect(mockSoftDeleteCampaignTx).toHaveBeenCalledWith(VALID_CAMPAIGN_ID, "user-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/campaigns");
  });
});

describe("deleteCampaigns (bulk)", () => {
  it("rejects unauthenticated callers", async () => {
    mockRequireUserId.mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(deleteCampaigns([VALID_CAMPAIGN_ID])).rejects.toThrow("Unauthorized");
    expect(mockSoftDeleteCampaignTx).not.toHaveBeenCalled();
  });

  it("rejects an empty selection", async () => {
    await expect(deleteCampaigns([])).rejects.toThrow();
    expect(mockSoftDeleteCampaignTx).not.toHaveBeenCalled();
  });

  it("rejects when any id is not a uuid", async () => {
    await expect(deleteCampaigns([VALID_CAMPAIGN_ID, "nope"])).rejects.toThrow();
    expect(mockSoftDeleteCampaignTx).not.toHaveBeenCalled();
  });

  it("soft-deletes each selected campaign and revalidates once", async () => {
    await deleteCampaigns([VALID_CAMPAIGN_ID, VALID_CAMPAIGN_ID_2]);

    expect(mockSoftDeleteCampaignTx).toHaveBeenCalledWith(VALID_CAMPAIGN_ID, "user-1");
    expect(mockSoftDeleteCampaignTx).toHaveBeenCalledWith(VALID_CAMPAIGN_ID_2, "user-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/campaigns");
  });
});

describe("updateCampaignsStatus (bulk)", () => {
  it("rejects an invalid target status", async () => {
    await expect(
      updateCampaignsStatus([VALID_CAMPAIGN_ID], "bogus" as never),
    ).rejects.toThrow();
    expect(mockUpdateCampaignStatusTx).not.toHaveBeenCalled();
  });

  it("rejects the whole batch (no writes) when a campaign is missing or not owned", async () => {
    mockFetchCampaignStatus
      .mockResolvedValueOnce("active")
      .mockResolvedValueOnce(null);

    await expect(
      updateCampaignsStatus([VALID_CAMPAIGN_ID, VALID_CAMPAIGN_ID_2], "paused"),
    ).rejects.toThrow("Campaign not found");
    expect(mockUpdateCampaignStatusTx).not.toHaveBeenCalled();
  });

  it("sets a status across a mixed selection (draft + active → closed)", async () => {
    mockFetchCampaignStatus
      .mockResolvedValueOnce("draft")
      .mockResolvedValueOnce("active");

    await updateCampaignsStatus([VALID_CAMPAIGN_ID, VALID_CAMPAIGN_ID_2], "closed");

    expect(mockUpdateCampaignStatusTx).toHaveBeenCalledWith(
      VALID_CAMPAIGN_ID,
      "draft",
      "closed",
      "user-1",
    );
    expect(mockUpdateCampaignStatusTx).toHaveBeenCalledWith(
      VALID_CAMPAIGN_ID_2,
      "active",
      "closed",
      "user-1",
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/campaigns");
  });

  it("revalidates each selected campaign's subtree", async () => {
    mockFetchCampaignStatus
      .mockResolvedValueOnce("draft")
      .mockResolvedValueOnce("active");

    await updateCampaignsStatus([VALID_CAMPAIGN_ID, VALID_CAMPAIGN_ID_2], "paused");

    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/campaigns/${VALID_CAMPAIGN_ID}`,
      "layout",
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/campaigns/${VALID_CAMPAIGN_ID_2}`,
      "layout",
    );
  });
});

describe("createCampaign — team reviewers flag", () => {
  const FLAG = "NEXT_PUBLIC_ENABLE_TEAM_REVIEWERS";

  /** The minimum a campaign form must carry, plus a reviewer payload. */
  function formWithReviewers(): FormData {
    const form = new FormData();
    form.set("title", "Senior Engineer");
    form.set("status", "draft");
    form.set(
      "reviewers_json",
      JSON.stringify([{ user_id: "user-temp-1730000000000", role: "reviewer" }]),
    );
    return form;
  }

  beforeEach(() => {
    delete process.env[FLAG];
    mockInsertCampaignTx.mockResolvedValue(VALID_CAMPAIGN_ID);
  });

  /**
   * Hiding the editor only removes the hidden input. This is the half that
   * makes the flag mean something: a hand-built post must not seed the table
   * with placeholder identities that grant nothing and read as real.
   */
  it("drops reviewers from a submitted form while the flag is off", async () => {
    await createCampaign(formWithReviewers());

    expect(mockInsertCampaignTx).toHaveBeenCalledTimes(1);
    expect(mockInsertCampaignTx.mock.calls[0][3]).toEqual([]);
  });

  it("writes reviewers once the flag is on", async () => {
    process.env[FLAG] = "true";

    await createCampaign(formWithReviewers());

    expect(mockInsertCampaignTx.mock.calls[0][3]).toEqual([
      { user_id: "user-temp-1730000000000", role: "reviewer" },
    ]);
  });

  it("still creates the campaign — the flag gates reviewers, not the form", async () => {
    await createCampaign(formWithReviewers());

    expect(mockInsertCampaignTx.mock.calls[0][0]).toMatchObject({
      title: "Senior Engineer",
    });
  });
});

/**
 * Screening questions used to be set only after creation, so every campaign was
 * born in the state the detail page has to warn about: no questions means no
 * candidate can be approved into screening. They now ride the create form and
 * are written in the same transaction as the campaign.
 */
describe("createCampaign — screening questions", () => {
  /** Argument position of the staged questions in the insertCampaignTx call. */
  const QUESTIONS_ARG = 5;

  function formWithQuestions(questionsJson?: string): FormData {
    const form = new FormData();
    form.set("title", "Senior Engineer");
    form.set("status", "draft");
    if (questionsJson !== undefined) {
      form.set("screening_questions_json", questionsJson);
    }
    return form;
  }

  beforeEach(() => {
    mockInsertCampaignTx.mockResolvedValue(VALID_CAMPAIGN_ID);
  });

  it("passes questions staged on the form into the create transaction", async () => {
    await createCampaign(
      formWithQuestions(
        JSON.stringify([
          { prompt: "Describe a system you scaled past its first design." },
          { prompt: "What made you look outside your current role?" },
        ]),
      ),
    );

    expect(mockInsertCampaignTx.mock.calls[0][QUESTIONS_ARG]).toEqual([
      { prompt: "Describe a system you scaled past its first design." },
      { prompt: "What made you look outside your current role?" },
    ]);
  });

  it("strips the client-side id so it can never be written as a row id", async () => {
    await createCampaign(
      formWithQuestions(
        JSON.stringify([
          { id: "sq-abc123", prompt: "Why this role, and why now?" },
        ]),
      ),
    );

    expect(mockInsertCampaignTx.mock.calls[0][QUESTIONS_ARG]).toEqual([
      { prompt: "Why this role, and why now?" },
    ]);
  });

  it("creates the campaign with no questions when the recruiter skips them", async () => {
    await createCampaign(formWithQuestions());

    expect(mockInsertCampaignTx).toHaveBeenCalledTimes(1);
    expect(mockInsertCampaignTx.mock.calls[0][QUESTIONS_ARG]).toEqual([]);
    expect(mockInsertCampaignTx.mock.calls[0][0]).toMatchObject({
      title: "Senior Engineer",
    });
  });
});

/**
 * Screening questions ride along with the edit form now that editing walks the
 * same wizard as creating. The rule that matters is the *only if changed* one:
 * `replaceScreeningQuestions` wipes and re-inserts, so a save that touches an
 * unrelated field must not mint new question ids under candidates whose
 * in-flight responses already snapshotted the old ones.
 */
describe("updateCampaign — screening questions", () => {
  function editForm(questions: { prompt: string }[]): FormData {
    const fd = new FormData();
    fd.set("title", "Senior Backend Engineer");
    fd.set("description", "Own our payments platform end to end.");
    fd.set("positions", "1");
    fd.set("status", "active");
    fd.set("screening_questions_json", JSON.stringify(questions));
    return fd;
  }

  const ASKED = [
    { prompt: "Describe a system you scaled past its first design." },
    { prompt: "What made you look outside your current role?" },
  ];

  function storedRows(prompts: string[]) {
    return prompts.map((prompt, i) => ({
      id: `q-${i}`,
      campaign_id: VALID_CAMPAIGN_ID,
      prompt,
      sort_order: i,
      created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    }));
  }

  it("leaves the stored questions alone when the form posts the same set", async () => {
    mockFetchScreeningQuestions.mockResolvedValue(storedRows(ASKED.map((q) => q.prompt)));

    await updateCampaign(VALID_CAMPAIGN_ID, editForm(ASKED));

    expect(mockReplaceScreeningQuestions).not.toHaveBeenCalled();
  });

  it("writes the new set when a question was edited", async () => {
    mockFetchScreeningQuestions.mockResolvedValue(storedRows(ASKED.map((q) => q.prompt)));

    const edited = [ASKED[0], { prompt: "Why are you leaving your current role?" }];
    await updateCampaign(VALID_CAMPAIGN_ID, editForm(edited));

    expect(mockReplaceScreeningQuestions).toHaveBeenCalledWith(VALID_CAMPAIGN_ID, edited);
  });

  /** Reordering is a real edit: the order is the order they are asked in. */
  it("writes the new set when only the order changed", async () => {
    mockFetchScreeningQuestions.mockResolvedValue(storedRows(ASKED.map((q) => q.prompt)));

    await updateCampaign(VALID_CAMPAIGN_ID, editForm([ASKED[1], ASKED[0]]));

    expect(mockReplaceScreeningQuestions).toHaveBeenCalledWith(VALID_CAMPAIGN_ID, [
      ASKED[1],
      ASKED[0],
    ]);
  });

  it("clears them when the recruiter removed the last one", async () => {
    mockFetchScreeningQuestions.mockResolvedValue(storedRows([ASKED[0].prompt]));

    await updateCampaign(VALID_CAMPAIGN_ID, editForm([]));

    expect(mockReplaceScreeningQuestions).toHaveBeenCalledWith(VALID_CAMPAIGN_ID, []);
  });

  it("adds a first set to a campaign that never had any", async () => {
    mockFetchScreeningQuestions.mockResolvedValue([]);

    await updateCampaign(VALID_CAMPAIGN_ID, editForm(ASKED));

    expect(mockReplaceScreeningQuestions).toHaveBeenCalledWith(VALID_CAMPAIGN_ID, ASKED);
  });
});

/**
 * The other half of the "absent vs empty" rule, at the action. A form that
 * never carried the field must not be able to delete a campaign's questions.
 */
describe("updateCampaign — a form with no question field", () => {
  it("leaves the stored questions alone", async () => {
    mockFetchScreeningQuestions.mockResolvedValue([
      {
        id: "q-0",
        campaign_id: VALID_CAMPAIGN_ID,
        prompt: "Describe a system you scaled past its first design.",
        sort_order: 0,
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      },
    ]);

    const fd = new FormData();
    fd.set("title", "Senior Backend Engineer");
    fd.set("description", "Own our payments platform end to end.");
    fd.set("positions", "1");
    fd.set("status", "active");

    await updateCampaign(VALID_CAMPAIGN_ID, fd);

    expect(mockReplaceScreeningQuestions).not.toHaveBeenCalled();
  });
});

/**
 * Where finishing the wizard lands, and why it is a parameter rather than a
 * constant. The apply link does not exist until the row does, so the share
 * stage can only follow a successful create — but "Save draft" is a recruiter
 * saying they will come back, and must not be answered by a page urging them
 * to publish.
 */
describe("createCampaign — where it lands", () => {
  beforeEach(() => {
    mockInsertCampaignTx.mockResolvedValue(VALID_CAMPAIGN_ID);
  });

  function minimalForm(): FormData {
    const form = new FormData();
    form.set("title", "Senior Engineer");
    form.set("status", "draft");
    return form;
  }

  it("goes to the share stage when the wizard was finished", async () => {
    await createCampaign(minimalForm(), "share");

    expect(mockRedirect).toHaveBeenCalledWith(`/campaigns/${VALID_CAMPAIGN_ID}/share`);
  });

  it("goes to the campaign itself by default, which is what Save draft wants", async () => {
    await createCampaign(minimalForm());

    expect(mockRedirect).toHaveBeenCalledWith(`/campaigns/${VALID_CAMPAIGN_ID}`);
  });
});

describe("saveCampaignRubrics", () => {
  function dimension(overrides: Record<string, unknown> = {}) {
    return {
      name: "Kubernetes",
      importance: "high",
      is_mandatory: true,
      sort_order: 0,
      ...overrides,
    };
  }

  it("rejects an unauthenticated caller before touching the data layer", async () => {
    mockRequireUserId.mockRejectedValue(new Error("Unauthorized"));

    await expect(
      saveCampaignRubrics(VALID_CAMPAIGN_ID, [
        { stage: "resume", dimensions: [dimension()] },
      ]),
    ).rejects.toThrow("Unauthorized");

    expect(mockUpdateCampaignRubricsTx).not.toHaveBeenCalled();
  });

  it("rejects a malformed campaign id", async () => {
    await expect(saveCampaignRubrics("not-a-uuid", [])).rejects.toThrow();

    expect(mockUpdateCampaignRubricsTx).not.toHaveBeenCalled();
  });

  it("refuses a dimension with no name rather than silently dropping it", async () => {
    await expect(
      saveCampaignRubrics(VALID_CAMPAIGN_ID, [
        { stage: "resume", dimensions: [dimension({ name: "" })] },
      ]),
    ).rejects.toThrow("Every rubric dimension needs a name");

    expect(mockUpdateCampaignRubricsTx).not.toHaveBeenCalled();
  });

  it("re-derives sort_order from position, because the editor stamps every row 0", async () => {
    await saveCampaignRubrics(VALID_CAMPAIGN_ID, [
      {
        stage: "resume",
        dimensions: [
          dimension({ name: "Kubernetes" }),
          dimension({ name: "Terraform" }),
          dimension({ name: "Go" }),
        ],
      },
    ]);

    expect(mockUpdateCampaignRubricsTx.mock.calls[0][1]).toEqual([
      {
        stage: "resume",
        dimensions: [
          expect.objectContaining({ name: "Kubernetes", sort_order: 0 }),
          expect.objectContaining({ name: "Terraform", sort_order: 1 }),
          expect.objectContaining({ name: "Go", sort_order: 2 }),
        ],
      },
    ]);
  });

  it("revalidates the whole campaign subtree, not just the page", async () => {
    await saveCampaignRubrics(VALID_CAMPAIGN_ID, [
      { stage: "resume", dimensions: [dimension()] },
    ]);

    // The stale-rubric badge on every candidate file below this campaign is
    // derived from the active rubric version, so the page alone is not enough.
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/campaigns/${VALID_CAMPAIGN_ID}`,
      "layout",
    );
  });
});
