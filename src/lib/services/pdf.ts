// @ts-expect-error - bypassing the buggy index.js of pdf-parse that reads test files
import pdf from "pdf-parse/lib/pdf-parse.js";

/**
 * Parses a PDF buffer and extracts text content.
 */
export async function parsePdf(fileBuffer: Buffer): Promise<string> {
  const parsedPdf = await pdf(fileBuffer);
  return parsedPdf.text;
}
