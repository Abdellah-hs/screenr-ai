const SUPPORTED_RESUME_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * Whether a resume upload's MIME type is one we can ingest — PDF or modern
 * (.docx) Word. Legacy `.doc` and everything else is rejected. Used by the
 * public apply action to fail fast before touching the ingest pipeline.
 */
export function isSupportedResumeMimeType(mimeType: string): boolean {
  return SUPPORTED_RESUME_MIME_TYPES.has(mimeType);
}
