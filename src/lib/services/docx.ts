import mammoth from "mammoth";

/**
 * Parses a DOCX buffer and extracts plain text content.
 */
export async function parseDocx(fileBuffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: fileBuffer });
  return result.value;
}
