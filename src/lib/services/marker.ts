import { z } from "zod/v4";

/**
 * Datalab Marker — hosted, layout-aware document extraction.
 *
 * Replaces the legacy `pdf-parse` + `mammoth` extractors with a single
 * provider that handles PDF, DOCX, ODT, HTML, EPUB, and images natively and
 * preserves reading order, tables, and multi-column layout. Unlike an
 * OCR→LLM-cleanup pipeline, Surya reads the document faithfully, so no model
 * is in the loop guessing at names/dates/contact info (see the OCR evaluation
 * in docs). We only consume the `markdown`; `images`, `chunks`, and `html`
 * from the response are ignored.
 *
 * The API is async (submit → poll), so this is a thin submit-then-poll
 * wrapper. Every network response is validated with Zod — we never trust the
 * shape of the JSON. All failures are surfaced as a typed {@link MarkerError}
 * so callers can decide how to handle them (the Gmail intake path warns and
 * skips the attachment rather than failing the whole sync).
 */

const MARKER_API_URL = "https://www.datalab.to/api/v1/convert";
const POLL_INTERVAL_MS = 2000;
// ~50s of polling, comfortably inside the 60s Vercel Pro Server Action limit.
const POLL_MAX_ATTEMPTS = 25;

export type MarkerErrorKind =
  | "missing_api_key"
  | "submit_failed"
  | "poll_failed"
  | "conversion_failed"
  | "timeout"
  | "malformed_response";

export class MarkerError extends Error {
  readonly kind: MarkerErrorKind;

  constructor(kind: MarkerErrorKind, message: string) {
    super(message);
    this.name = "MarkerError";
    this.kind = kind;
  }
}

export interface MarkerResult {
  markdown: string;
  pageCount: number | null;
  parseQualityScore: number | null;
  costBreakdown: unknown;
}

// We validate only the fields we read. Marker returns more (images, html,
// chunks, metadata) — extra keys are tolerated, missing required keys are not.
const SubmitResponseSchema = z.object({
  request_check_url: z.string(),
});

const PollResponseSchema = z.object({
  status: z.string(),
  error: z.string().nullish(),
  markdown: z.string().nullish(),
  page_count: z.number().nullish(),
  parse_quality_score: z.number().nullish(),
  cost_breakdown: z.unknown().optional(),
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Marker keys uploads off the file extension as a fallback to content-type. */
function filenameForMimeType(mimeType: string): string {
  if (mimeType === "application/pdf") return "document.pdf";
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "document.docx";
  }
  return "document";
}

async function readBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function readJson(res: Response, phase: "submit" | "poll"): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new MarkerError(
      "malformed_response",
      `Marker ${phase} returned a non-JSON response.`,
    );
  }
}

/**
 * Submits a document to Datalab Marker and polls until the markdown is ready.
 *
 * @param buffer   the raw file bytes (PDF or DOCX from the Gmail attachment).
 * @param mimeType the original attachment MIME type, forwarded verbatim so
 *                 Marker selects the right parser.
 * @throws {MarkerError} on any failure — missing key, HTTP error on submit or
 *         poll, `status: "failed"`, timeout, or a response that fails Zod
 *         validation. Never resolves with empty/partial data.
 */
export async function extractMarkdownWithMarker(
  buffer: Buffer,
  mimeType: string,
): Promise<MarkerResult> {
  const apiKey = process.env.DATALAB_API_KEY;
  if (!apiKey) {
    throw new MarkerError("missing_api_key", "DATALAB_API_KEY is not configured.");
  }

  const form = new FormData();
  form.append(
    "file",
    // Copy into a fresh Uint8Array so the Blob part is backed by a plain
    // ArrayBuffer (a Node Buffer's backing store widens to ArrayBufferLike).
    new Blob([new Uint8Array(buffer)], { type: mimeType }),
    filenameForMimeType(mimeType),
  );
  form.append("output_format", "markdown");

  const submitRes = await fetch(MARKER_API_URL, {
    method: "POST",
    headers: { "X-API-Key": apiKey },
    body: form,
  });

  if (!submitRes.ok) {
    throw new MarkerError(
      "submit_failed",
      `Marker submit failed: ${submitRes.status} ${submitRes.statusText} ${await readBody(submitRes)}`.trim(),
    );
  }

  const submit = SubmitResponseSchema.safeParse(await readJson(submitRes, "submit"));
  if (!submit.success) {
    throw new MarkerError(
      "malformed_response",
      `Marker submit response is missing request_check_url: ${submit.error.message}`,
    );
  }

  const checkUrl = submit.data.request_check_url;

  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    await delay(POLL_INTERVAL_MS);

    const pollRes = await fetch(checkUrl, { headers: { "X-API-Key": apiKey } });
    if (!pollRes.ok) {
      throw new MarkerError(
        "poll_failed",
        `Marker poll failed: ${pollRes.status} ${pollRes.statusText} ${await readBody(pollRes)}`.trim(),
      );
    }

    const poll = PollResponseSchema.safeParse(await readJson(pollRes, "poll"));
    if (!poll.success) {
      throw new MarkerError(
        "malformed_response",
        `Marker poll response failed validation: ${poll.error.message}`,
      );
    }

    const { status } = poll.data;

    if (status === "failed") {
      throw new MarkerError(
        "conversion_failed",
        `Marker conversion failed: ${poll.data.error ?? "unknown error"}`,
      );
    }

    if (status === "complete") {
      if (poll.data.markdown == null) {
        throw new MarkerError(
          "malformed_response",
          "Marker reported status=complete but returned no markdown.",
        );
      }

      return {
        markdown: poll.data.markdown,
        pageCount: poll.data.page_count ?? null,
        parseQualityScore: poll.data.parse_quality_score ?? null,
        costBreakdown: poll.data.cost_breakdown ?? null,
      };
    }

    // Any other status ("processing", "running", …) → keep polling.
  }

  throw new MarkerError(
    "timeout",
    `Marker timed out after ${POLL_MAX_ATTEMPTS} poll attempts (~${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s).`,
  );
}
