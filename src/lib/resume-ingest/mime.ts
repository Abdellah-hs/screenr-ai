const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const SUPPORTED_RESUME_MIME_TYPES = new Set([PDF_MIME, DOCX_MIME]);

/**
 * Whether a resume upload's MIME type is one we can ingest — PDF or modern
 * (.docx) Word. Legacy `.doc` and everything else is rejected. Used by the
 * public apply action to fail fast before touching the ingest pipeline.
 */
export function isSupportedResumeMimeType(mimeType: string): boolean {
  return SUPPORTED_RESUME_MIME_TYPES.has(mimeType);
}

/**
 * The MIME type to hand Marker for a CV already in storage.
 *
 * Marker keys off the extension and the stored path keeps the original one, so
 * the two paths that RE-READ a stored CV — the reprocess retry and the contact
 * link backfill — both have to derive it. They derived it separately, one of
 * them with the 89-character literal spelled out inline where no grep for the
 * constant would find it.
 */
export function resumeMimeTypeForPath(path: string): string {
  return path.toLowerCase().endsWith(".docx") ? DOCX_MIME : PDF_MIME;
}
