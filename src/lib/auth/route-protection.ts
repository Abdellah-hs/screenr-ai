/**
 * Path prefixes that require an authenticated session. The middleware redirects
 * unauthenticated requests for these to /login.
 *
 * IMPORTANT: every new page under the (dashboard) route group MUST be added
 * here. A protected page that is missing from this list skips the redirect,
 * reaches its server component, and 500s when `requireUserId()` throws — which
 * is exactly how /settings regressed.
 */
const PROTECTED_PREFIXES = ["/overview", "/campaigns", "/candidates", "/admin", "/settings"] as const;

/**
 * True when `pathname` belongs to an authenticated area. Matches the exact
 * prefix or a sub-path (`/settings` and `/settings/x`), but not look-alikes
 * (`/settings-export`).
 */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
