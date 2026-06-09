import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractMarkdownWithMarker, MarkerError } from "./marker";

const PDF_MIME = "application/pdf";
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 25;
const CHECK_URL = "https://www.datalab.to/api/v1/convert/check/abc123";

const fetchMock = vi.fn();
const ORIGINAL_KEY = process.env.DATALAB_API_KEY;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.DATALAB_API_KEY = "test-key";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) {
    delete process.env.DATALAB_API_KEY;
  } else {
    process.env.DATALAB_API_KEY = ORIGINAL_KEY;
  }
});

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function submitOk(): Response {
  return jsonResponse({ request_check_url: CHECK_URL });
}

/**
 * Pumps the fake-timer poll loop to completion and returns the same promise so
 * the caller observes its resolution/rejection. The pre-attached `.catch`
 * keeps a rejecting promise from tripping an unhandled-rejection warning while
 * the timers advance.
 */
async function drive<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * (POLL_MAX_ATTEMPTS + 1));
  return promise;
}

describe("extractMarkdownWithMarker", () => {
  it("returns markdown + metadata after polling to completion (happy path)", async () => {
    fetchMock
      .mockResolvedValueOnce(submitOk())
      .mockResolvedValueOnce(jsonResponse({ status: "processing" }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "complete",
          markdown: "# AIT KECHKECH AHMED\n\nFutur ingénieur Java",
          page_count: 1,
          parse_quality_score: 0.97,
          cost_breakdown: { ocr: 0.01 },
        }),
      );

    const result = await drive(
      extractMarkdownWithMarker(Buffer.from("pdf-bytes"), PDF_MIME),
    );

    expect(result.markdown).toContain("Futur ingénieur Java");
    expect(result.pageCount).toBe(1);
    expect(result.parseQualityScore).toBe(0.97);
    expect(result.costBreakdown).toEqual({ ocr: 0.01 });
  });

  it("submits to the convert endpoint with the API key and polls the returned check url", async () => {
    fetchMock
      .mockResolvedValueOnce(submitOk())
      .mockResolvedValueOnce(jsonResponse({ status: "complete", markdown: "ok" }));

    await drive(extractMarkdownWithMarker(Buffer.from("x"), PDF_MIME));

    const [submitUrl, submitInit] = fetchMock.mock.calls[0];
    expect(submitUrl).toBe("https://www.datalab.to/api/v1/convert");
    expect(submitInit.method).toBe("POST");
    expect(submitInit.headers["X-API-Key"]).toBe("test-key");
    expect(submitInit.body).toBeInstanceOf(FormData);

    const [pollUrl, pollInit] = fetchMock.mock.calls[1];
    expect(pollUrl).toBe(CHECK_URL);
    expect(pollInit.headers["X-API-Key"]).toBe("test-key");
  });

  it("defaults missing metadata fields to null rather than undefined", async () => {
    fetchMock
      .mockResolvedValueOnce(submitOk())
      .mockResolvedValueOnce(jsonResponse({ status: "complete", markdown: "body" }));

    const result = await drive(
      extractMarkdownWithMarker(Buffer.from("x"), PDF_MIME),
    );

    expect(result.pageCount).toBeNull();
    expect(result.parseQualityScore).toBeNull();
    expect(result.costBreakdown).toBeNull();
  });

  it("throws missing_api_key before any network call when the key is unset", async () => {
    delete process.env.DATALAB_API_KEY;

    await expect(
      extractMarkdownWithMarker(Buffer.from("x"), PDF_MIME),
    ).rejects.toMatchObject({ kind: "missing_api_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws submit_failed when the submit request is not ok", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse("rate limited", { ok: false, status: 429, statusText: "Too Many Requests" }),
    );

    await expect(
      drive(extractMarkdownWithMarker(Buffer.from("x"), PDF_MIME)),
    ).rejects.toMatchObject({ kind: "submit_failed" });
  });

  it("throws poll_failed when a poll request is not ok", async () => {
    fetchMock
      .mockResolvedValueOnce(submitOk())
      .mockResolvedValueOnce(
        jsonResponse("boom", { ok: false, status: 500, statusText: "Server Error" }),
      );

    await expect(
      drive(extractMarkdownWithMarker(Buffer.from("x"), PDF_MIME)),
    ).rejects.toMatchObject({ kind: "poll_failed" });
  });

  it("throws conversion_failed when the job reports status=failed", async () => {
    fetchMock
      .mockResolvedValueOnce(submitOk())
      .mockResolvedValueOnce(
        jsonResponse({ status: "failed", error: "corrupt file" }),
      );

    await expect(
      drive(extractMarkdownWithMarker(Buffer.from("x"), PDF_MIME)),
    ).rejects.toMatchObject({ kind: "conversion_failed" });
  });

  it("throws timeout when the job never completes within the attempt budget", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "processing" }));
    // First call is the submit; every subsequent poll stays "processing".
    fetchMock.mockResolvedValueOnce(submitOk());

    await expect(
      drive(extractMarkdownWithMarker(Buffer.from("x"), PDF_MIME)),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("throws malformed_response when submit omits request_check_url", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

    await expect(
      drive(extractMarkdownWithMarker(Buffer.from("x"), PDF_MIME)),
    ).rejects.toMatchObject({ kind: "malformed_response" });
  });

  it("throws malformed_response when a completed poll has a non-string markdown", async () => {
    fetchMock
      .mockResolvedValueOnce(submitOk())
      .mockResolvedValueOnce(jsonResponse({ status: "complete", markdown: 123 }));

    await expect(
      drive(extractMarkdownWithMarker(Buffer.from("x"), PDF_MIME)),
    ).rejects.toMatchObject({ kind: "malformed_response" });
  });

  it("throws malformed_response when a response body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
      text: async () => "<html>oops</html>",
    } as unknown as Response);

    await expect(
      drive(extractMarkdownWithMarker(Buffer.from("x"), PDF_MIME)),
    ).rejects.toMatchObject({ kind: "malformed_response" });
  });

  it("surfaces failures as MarkerError instances", async () => {
    delete process.env.DATALAB_API_KEY;

    const error = await extractMarkdownWithMarker(Buffer.from("x"), PDF_MIME).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(MarkerError);
  });
});
