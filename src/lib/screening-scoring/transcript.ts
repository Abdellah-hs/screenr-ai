/**
 * Transcript rendering for voice screening.
 *
 * The implementation moved to `@/lib/scoring/transcript` on 2026-08-28, when
 * the AI interview came onto the same evidence pipeline. A quote must be
 * verified against the same rendering the model was shown, at every stage that
 * grades speech — two copies of that logic is exactly how one stage quietly
 * starts verifying against text the model never saw.
 */
export {
  buildTranscriptDocument,
  buildCandidateSpeech,
  hasCandidateSpeech,
  type TranscriptTurn,
} from "@/lib/scoring/transcript";
