import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedResumeData } from "@/lib/services/openai";

vi.mock("@/lib/data/candidates", () => ({
  fetchApplicationsMissingContactLinks: vi.fn(),
  downloadResumeFromStorage: vi.fn(),
  saveBackfilledContactLinks: vi.fn(),
}));
vi.mock("@/lib/services/marker", () => ({ extractMarkdownWithMarker: vi.fn() }));

import { backfillContactLinks, BACKFILL_CONCURRENCY } from "./contact-link-backfill";
import {
  fetchApplicationsMissingContactLinks,
  downloadResumeFromStorage,
  saveBackfilledContactLinks,
  type IncompleteContactLinkRow,
} from "@/lib/data/candidates";
import { extractMarkdownWithMarker } from "@/lib/services/marker";

const mockFetch = vi.mocked(fetchApplicationsMissingContactLinks);
const mockDownload = vi.mocked(downloadResumeFromStorage);
const mockSave = vi.mocked(saveBackfilledContactLinks);
const mockMarker = vi.mocked(extractMarkdownWithMarker);

const DB = {} as never;

function parsed(over: Partial<ParsedResumeData> = {}): ParsedResumeData {
  return {
    document_type: "cv",
    first_name: "Alice",
    last_name: "Smith",
    headline: null,
    summary: null,
    email: "alice@example.com",
    phone: null,
    location: null,
    linkedin_url: null,
    github_url: null,
    portfolio_url: null,
    skills: [],
    languages: [],
    interests: [],
    certifications: [],
    experience: [],
    education: [],
    ...over,
  };
}

function row(over: Partial<IncompleteContactLinkRow> = {}): IncompleteContactLinkRow {
  return {
    applicationId: "app-1",
    candidateId: "cand-1",
    resumeUrl: "camp-1/alice.pdf",
    parsedData: parsed(),
    candidate: { linkedin_url: null, github_url: null, portfolio_url: null },
    ...over,
  };
}

function markdown(text: string) {
  return { markdown: text, pageCount: 1, parseQualityScore: 0.9, costBreakdown: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue([row()]);
  mockDownload.mockResolvedValue(Buffer.from("pdf"));
  mockMarker.mockResolvedValue(markdown("[LinkedIn](https://www.linkedin.com/in/alice)"));
  mockSave.mockResolvedValue(undefined);
});

describe("backfillContactLinks", () => {
  it("writes a recovered link to both the parse and the candidate row", async () => {
    const result = await backfillContactLinks({ db: DB });

    expect(result).toMatchObject({ scanned: 1, repaired: 1, unchanged: 0, failed: 0 });
    expect(mockSave).toHaveBeenCalledWith(
      {
        applicationId: "app-1",
        candidateId: "cand-1",
        parsedData: expect.objectContaining({
          linkedin_url: "https://www.linkedin.com/in/alice",
        }),
        candidate: expect.objectContaining({
          linkedin_url: "https://www.linkedin.com/in/alice",
        }),
      },
      DB,
    );
  });

  it("fills the gap without disturbing a link the parse already carries", async () => {
    mockFetch.mockResolvedValue([
      row({ parsedData: parsed({ linkedin_url: "https://www.linkedin.com/in/kept" }) }),
    ]);
    // The document disagrees about LinkedIn and knows a GitHub. Only the gap
    // may move: the disagreement is not the backfill's to settle.
    mockMarker.mockResolvedValue(
      markdown(
        "https://www.linkedin.com/in/from-the-cv and https://github.com/alice",
      ),
    );

    await backfillContactLinks({ db: DB });

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        parsedData: expect.objectContaining({
          linkedin_url: "https://www.linkedin.com/in/kept",
          github_url: "https://github.com/alice",
        }),
      }),
      DB,
    );
  });

  it("does not re-read a document whose links are all already known", async () => {
    mockFetch.mockResolvedValue([
      row({
        parsedData: parsed({
          linkedin_url: "https://www.linkedin.com/in/alice",
          github_url: "https://github.com/alice",
          portfolio_url: "https://alice.dev",
        }),
      }),
    ]);

    const result = await backfillContactLinks({ db: DB });

    expect(result.scanned).toBe(0);
    expect(mockMarker).not.toHaveBeenCalled();
  });

  it("treats a link on the candidate row as already known", async () => {
    mockFetch.mockResolvedValue([
      row({
        parsedData: parsed({ github_url: "https://github.com/alice", portfolio_url: "https://alice.dev" }),
        candidate: {
          linkedin_url: "https://www.linkedin.com/in/alice",
          github_url: null,
          portfolio_url: null,
        },
      }),
    ]);

    const result = await backfillContactLinks({ db: DB });

    expect(result.scanned).toBe(0);
    expect(mockMarker).not.toHaveBeenCalled();
  });

  it("counts a document with no usable link as unchanged, and writes nothing", async () => {
    mockMarker.mockResolvedValue(markdown("Alice Smith\nSenior Engineer\nParis"));

    const result = await backfillContactLinks({ db: DB });

    expect(result).toMatchObject({ scanned: 1, repaired: 0, unchanged: 1 });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("makes no Marker call and no write on a dry run", async () => {
    const result = await backfillContactLinks({ db: DB, dryRun: true });

    expect(result).toMatchObject({ scanned: 1, repaired: 0, dryRun: true });
    expect(result.findings).toEqual([
      {
        applicationId: "app-1",
        fills: { linkedin_url: null, github_url: null, portfolio_url: null },
      },
    ]);
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockMarker).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("steps over a resume that has vanished from storage", async () => {
    mockDownload.mockResolvedValue(null);

    const result = await backfillContactLinks({ db: DB });

    expect(result).toMatchObject({ scanned: 1, repaired: 0, failed: 1 });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("keeps going when one document fails to extract", async () => {
    mockFetch.mockResolvedValue([row(), row({ applicationId: "app-2" })]);
    mockMarker
      .mockRejectedValueOnce(new Error("marker down"))
      .mockResolvedValueOnce(markdown("[LinkedIn](https://www.linkedin.com/in/bob)"));

    const result = await backfillContactLinks({ db: DB });

    expect(result).toMatchObject({ scanned: 2, repaired: 1, failed: 1 });
  });

  it("sends the caller's limit down to the query", async () => {
    await backfillContactLinks({ db: DB, limit: 5 });

    expect(mockFetch).toHaveBeenCalledWith(5, DB);
  });
});

/**
 * The cap on `limit` bounds the COST of a run; this bounds its WALL CLOCK,
 * which was the thing stopping a run from finishing at all. Marker is
 * submit-then-poll with a budget near three minutes per document, so awaiting
 * them one at a time meant the default limit of 25 could not fit inside the
 * route's 300-second `maxDuration` — whatever the operator asked for, the
 * function died partway through and the rest of the batch was never touched.
 */
describe("backfillContactLinks concurrency", () => {
  it("re-reads documents in parallel, never more than the pool allows", async () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ applicationId: `app-${i}`, candidateId: `cand-${i}` }),
    );
    mockFetch.mockResolvedValue(rows);
    mockDownload.mockResolvedValue(Buffer.from("pdf"));

    let inFlight = 0;
    let peak = 0;
    mockMarker.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { markdown: "no links here", pageCount: 1 } as never;
    });

    const result = await backfillContactLinks({ db: DB });

    // Every row is still visited exactly once — the pool changes the timing,
    // never the number of Marker calls, which is what the cost is made of.
    expect(mockMarker).toHaveBeenCalledTimes(12);
    expect(result.unchanged).toBe(12);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(BACKFILL_CONCURRENCY);
  });

  it("keeps a dry run free — it makes no Marker call at all", async () => {
    mockFetch.mockResolvedValue([row(), row({ applicationId: "app-2" })]);

    const result = await backfillContactLinks({ db: DB, dryRun: true });

    expect(mockMarker).not.toHaveBeenCalled();
    expect(mockDownload).not.toHaveBeenCalled();
    expect(result.findings).toHaveLength(2);
  });
});
