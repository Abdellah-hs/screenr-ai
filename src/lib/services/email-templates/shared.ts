// Shared helpers for transactional email templates. Templates stay plain
// and table-based so they render in every client and don't trip spam
// filters — no external images, no heavy branding.

/** HTML-escape a string for safe interpolation into an email body. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** First name from a full name, falling back to the whole string. */
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

/** Human-readable date + time, e.g. "Monday, June 2, 2026 at 2:30 PM EDT". */
export function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Wraps email body HTML in the shared Screenr AI card layout. */
export function renderEmailLayout(innerHtml: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f9fafb; margin:0; padding:24px 0; color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff; border-radius:12px; border:1px solid #e5e7eb; max-width:560px;">
            <tr>
              <td style="padding:32px 36px;">
${innerHtml}
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0; font-size:11px; color:#9ca3af;">
            This email was sent via Screenr AI. If you did not apply for this role, please ignore it.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** A centered call-to-action button row for use inside renderEmailLayout. */
export function renderButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
  <tr>
    <td align="center" bgcolor="#0369A1" style="border-radius:8px;">
      <a href="${escapeHtml(url)}" style="display:inline-block; padding:14px 28px; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:8px;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

/** The standard shape every template builder returns. */
export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}
