/**
 * Simple in-memory rate limiter for Server Actions.
 * Tracks calls per user within a sliding window.
 *
 * NOTE: This is per-process only. In a multi-instance deployment,
 * replace with Redis-based rate limiting.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

interface RateLimitOptions {
  /** Unique name for this limiter (e.g. "ai-generate", "apply-submit") */
  name: string;
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

/**
 * Check if a user has exceeded the rate limit.
 * Throws an error if the limit is exceeded.
 */
export function checkRateLimit(userId: string, options: RateLimitOptions): void {
  const { name, maxRequests, windowMs } = options;

  if (!stores.has(name)) {
    stores.set(name, new Map());
  }
  const store = stores.get(name)!;

  const now = Date.now();
  const entry = store.get(userId) || { timestamps: [] };

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  if (entry.timestamps.length >= maxRequests) {
    throw new Error(
      `Rate limit exceeded. Maximum ${maxRequests} requests per ${Math.round(windowMs / 60000)} minute(s). Please try again later.`
    );
  }

  entry.timestamps.push(now);
  store.set(userId, entry);

  // Prevent memory leak: prune entries with no active timestamps.
  //
  // The caller's own entry is skipped because it was just written, and it is
  // the reason the bucket can never be emptied here: a `stores.delete(name)`
  // guarded on `store.size === 0` used to follow this loop, and it was
  // unreachable for exactly that reason. Buckets are keyed by limiter name, of
  // which there is a small fixed set in the source, so the outer map is bounded
  // anyway — it is the per-user entries inside that grow, and those are what
  // this prunes.
  for (const [key, e] of store) {
    if (key !== userId && e.timestamps.every((t) => now - t >= windowMs)) {
      store.delete(key);
    }
  }
}
