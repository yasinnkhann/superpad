import { getDb } from "@/lib/db";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Extracts best-effort client IP from Vercel / proxy request headers.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);
  return "unknown";
}

/**
 * Persistent SQLite / Turso-backed fixed-window rate limiter.
 * Works consistently across stateless Vercel serverless functions and local SQLite.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const db = await getDb();
  const now = Date.now();
  const resetAt = now + windowMs;

  const res = await db.execute({
    sql: `SELECT count, reset_at FROM rate_limits WHERE key = ? LIMIT 1`,
    args: [key],
  });

  const row = res.rows[0];
  if (!row || Number(row.reset_at) <= now) {
    await db.execute({
      sql: `INSERT INTO rate_limits (key, count, reset_at)
            VALUES (?, 1, ?)
            ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at`,
      args: [key, resetAt],
    });
    // Opportunistic expired row cleanup (roughly 5% of resets)
    if (Math.random() < 0.05) {
      void db
        .execute({
          sql: `DELETE FROM rate_limits WHERE reset_at < ?`,
          args: [now],
        })
        .catch(() => {});
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  const currentCount = Number(row.count);
  const currentResetAt = Number(row.reset_at);
  const retryAfterSeconds = Math.max(1, Math.ceil((currentResetAt - now) / 1000));

  if (currentCount >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  await db.execute({
    sql: `UPDATE rate_limits SET count = count + 1 WHERE key = ?`,
    args: [key],
  });

  return {
    allowed: true,
    remaining: Math.max(0, limit - (currentCount + 1)),
    retryAfterSeconds,
  };
}

/**
 * Clears a rate limit key (e.g. reset failed username login count after successful sign-in).
 */
export async function clearRateLimit(key: string): Promise<void> {
  try {
    const db = await getDb();
    await db.execute({
      sql: `DELETE FROM rate_limits WHERE key = ?`,
      args: [key],
    });
  } catch {
    // Non-critical
  }
}
