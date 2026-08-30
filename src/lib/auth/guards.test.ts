import { beforeEach, describe, it, expect, vi } from "vitest";

// `auth.getUser()` is the network call the guard exists to make; the mock
// counts it so the tests can talk about how many round trips a caller buys.
const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve({ auth: { getUser: mockGetUser } })),
}));

import { getAuthUser, requireUserId } from "./guards";

function session(id: string) {
  return { data: { user: { id, email: `${id}@matious.com` } } };
}

const NO_SESSION = { data: { user: null } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireUserId", () => {
  it("returns the authenticated user's id", async () => {
    mockGetUser.mockResolvedValue(session("user-1"));

    const id = await requireUserId();

    expect(id).toBe("user-1");
  });

  it("throws Unauthorized when there is no session", async () => {
    mockGetUser.mockResolvedValue(NO_SESSION);

    await expect(requireUserId()).rejects.toThrow("Unauthorized");
  });
});

describe("getAuthUser", () => {
  it("returns null rather than throwing when there is no session", async () => {
    mockGetUser.mockResolvedValue(NO_SESSION);

    await expect(getAuthUser()).resolves.toBeNull();
  });

  /**
   * The safety half of the `cache()` optimisation, and the one worth a test.
   *
   * `cache()` memoises per request. If it ever degraded to a module-level memo,
   * the first recruiter to render a page would pin their user id for the life
   * of the server process and every later request would be answered with it —
   * a session leak, not a slow page. Outside a request scope there is no memo
   * at all, so a changed session must be observed immediately.
   */
  it("does not hold a user across independent calls", async () => {
    mockGetUser.mockResolvedValue(session("recruiter-a"));
    expect(await requireUserId()).toBe("recruiter-a");

    mockGetUser.mockResolvedValue(session("recruiter-b"));
    expect(await requireUserId()).toBe("recruiter-b");

    mockGetUser.mockResolvedValue(NO_SESSION);
    await expect(requireUserId()).rejects.toThrow("Unauthorized");
  });
});
