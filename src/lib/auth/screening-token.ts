import { createHmac, timingSafeEqual } from "crypto";

/**
 * HMAC-signed tokens for candidate screening response links.
 *
 * The token is a base64url-encoded payload + signature. Candidates receive
 * it in an email as `/respond/<token>` and the public submit action
 * verifies the signature before showing the form or accepting answers.
 *
 * Not a JWT — we don't need rotating keys or multiple audiences, just a
 * single secret that proves the link came from us and hasn't been tampered
 * with. Single-use enforcement is done at the DB level (status transitions).
 */

interface TokenPayload {
  /** application_id */
  aid: string;
  /** expiry (unix ms) */
  exp: number;
  /** nonce — makes identical payloads produce different tokens */
  n: string;
}

function getSecret(): string {
  const secret = process.env.SCREENING_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SCREENING_TOKEN_SECRET is not configured (must be at least 32 chars)"
    );
  }
  return secret;
}

function base64urlEncode(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str: string): Buffer {
  // pad back to multiple of 4
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function sign(data: string): string {
  return base64urlEncode(
    createHmac("sha256", getSecret()).update(data).digest()
  );
}

/**
 * Sign a token for a screening response link.
 * @param applicationId the application the candidate is responding to
 * @param ttlMs how long the link should be valid (default 7 days)
 */
export function signResponseToken(
  applicationId: string,
  ttlMs: number = 7 * 24 * 60 * 60 * 1000
): string {
  const payload: TokenPayload = {
    aid: applicationId,
    exp: Date.now() + ttlMs,
    n: base64urlEncode(
      Buffer.from(Math.random().toString(36).slice(2, 12) + Date.now().toString(36))
    ),
  };
  const payloadStr = base64urlEncode(JSON.stringify(payload));
  const sig = sign(payloadStr);
  return `${payloadStr}.${sig}`;
}

export interface VerifiedToken {
  application_id: string;
  expires_at: Date;
}

/**
 * Verify a screening response token. Returns the application_id if valid,
 * or throws with a user-facing message if the token is malformed, tampered
 * with, or expired.
 */
export function verifyResponseToken(token: string): VerifiedToken {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("This link is not valid. Please check your email and try again.");
  }
  const [payloadStr, sig] = parts;

  const expectedSig = sign(payloadStr);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    throw new Error("This link is not valid. Please check your email and try again.");
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadStr).toString("utf-8")) as TokenPayload;
  } catch {
    throw new Error("This link is not valid. Please check your email and try again.");
  }

  if (!payload.aid || typeof payload.exp !== "number") {
    throw new Error("This link is not valid. Please check your email and try again.");
  }

  if (Date.now() > payload.exp) {
    throw new Error("This link has expired. Please contact the hiring team for a new one.");
  }

  return {
    application_id: payload.aid,
    expires_at: new Date(payload.exp),
  };
}
