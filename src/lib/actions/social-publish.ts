"use server";

import { requireUserId } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { socialPublishSchema, type SocialPublishInput } from "@/lib/validations";
import { fetchSocialConnection } from "@/lib/data/integrations";
import { LINKEDIN_PROVIDER, publishLinkedInText } from "@/lib/services/linkedin";

const PUBLISH_LIMIT = { name: "social-publish", maxRequests: 20, windowMs: 5 * 60 * 1000 };

/**
 * Publish a (possibly edited) social post to the recruiter's connected LinkedIn
 * feed. Auth-guarded, rate-limited, and input-validated. The recruiter must
 * have connected LinkedIn in Settings and the stored token must still be valid;
 * either failing surfaces a clear, actionable error rather than a silent no-op.
 */
export async function publishLinkedInPost(
  input: SocialPublishInput,
): Promise<{ postUrn: string | null }> {
  const userId = await requireUserId();
  checkRateLimit(userId, PUBLISH_LIMIT);
  const { text } = socialPublishSchema.parse(input);

  const connection = await fetchSocialConnection(userId, LINKEDIN_PROVIDER);
  if (!connection) {
    throw new Error("Connect LinkedIn in Settings before publishing.");
  }

  const expired =
    connection.token_expires_at != null &&
    new Date(connection.token_expires_at).getTime() <= Date.now();
  if (expired) {
    throw new Error("Your LinkedIn connection expired. Reconnect it in Settings.");
  }
  if (!connection.account_id) {
    throw new Error("Your LinkedIn connection is missing its member id. Reconnect in Settings.");
  }

  return publishLinkedInText({
    accessToken: connection.access_token,
    memberId: connection.account_id,
    text,
  });
}
