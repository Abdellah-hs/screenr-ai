import { headers } from "next/headers";

/**
 * The public origin (scheme + host) of the current request, derived from the
 * forwarding headers. Used to build absolute candidate-facing links
 * (`/respond/<token>`, `/schedule/<token>`) inside outbound emails.
 *
 * Must be called within a request scope (Server Action or route handler).
 * Throws if no host header is present.
 */
export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const forwardedProto = h.get("x-forwarded-proto");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = forwardedProto ?? (host?.startsWith("localhost") ? "http" : "https");
  if (!host) throw new Error("Could not determine request origin");
  return `${proto}://${host}`;
}
