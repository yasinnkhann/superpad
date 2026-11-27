import { NextResponse } from "next/server";
import { metric } from "@vercel/functions";
import { getDb, getDbBackend } from "@/lib/db";
import {
  attachSessionCookie,
  createSession,
  validateBase64String,
  validateUsername,
  verifyAuthKey,
} from "@/lib/auth";
import { checkRateLimit, clearRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_IP_LIMIT = 20;
const LOGIN_USER_LIMIT = 8;

export async function POST(request: Request) {
  const startedAt = performance.now();
  const backend = getDbBackend();

  try {
    const ip = getClientIp(request);
    const ipCheck = await checkRateLimit(`login:ip:${ip}`, LOGIN_IP_LIMIT, LOGIN_WINDOW_MS);
    if (!ipCheck.allowed) {
      metric("superpad.auth.login", 1, { outcome: "rate_limited", backend });
      return NextResponse.json(
        { error: `Too many login attempts. Try again in ${ipCheck.retryAfterSeconds}s.` },
        {
          status: 429,
          headers: { "Retry-After": String(ipCheck.retryAfterSeconds) },
        }
      );
    }

    const body = (await request.json()) as {
      username?: unknown;
      authKey?: unknown;
    };

    const username = validateUsername(body.username);
    const authKey = validateBase64String(body.authKey, "authKey", 32, 128);

    const userKey = `login:user:${username}`;
    const userCheck = await checkRateLimit(userKey, LOGIN_USER_LIMIT, LOGIN_WINDOW_MS);
    if (!userCheck.allowed) {
      metric("superpad.auth.login", 1, { outcome: "rate_limited", backend });
      return NextResponse.json(
        { error: `Too many failed attempts for this account. Try again in ${userCheck.retryAfterSeconds}s.` },
        {
          status: 429,
          headers: { "Retry-After": String(userCheck.retryAfterSeconds) },
        }
      );
    }

    const db = await getDb();
    const res = await db.execute({
      sql: `SELECT id, username, kdf_salt, auth_salt, auth_verifier, created_at
            FROM users WHERE username = ? LIMIT 1`,
      args: [username],
    });

    const row = res.rows[0];
    if (!row) {
      metric("superpad.auth.login", 1, { outcome: "invalid", backend });
      return NextResponse.json(
        { error: "Invalid username or password." },
        { status: 401 }
      );
    }

    const ok = verifyAuthKey(
      authKey,
      String(row.auth_salt),
      String(row.auth_verifier)
    );
    if (!ok) {
      metric("superpad.auth.login", 1, { outcome: "invalid", backend });
      return NextResponse.json(
        { error: "Invalid username or password." },
        { status: 401 }
      );
    }

    // Clear per-username rate limit after valid login
    await clearRateLimit(userKey);

    const userId = String(row.id);
    const session = await createSession(userId);
    const response = NextResponse.json({
      user: {
        id: userId,
        username: String(row.username),
        kdfSalt: String(row.kdf_salt),
        createdAt: Number(row.created_at),
      },
      backend,
    });
    attachSessionCookie(response, session.token, session.expiresAt);

    metric("superpad.auth.login", 1, { outcome: "success", backend });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed";
    const status = message.includes("Invalid") || message.includes("Username") ? 400 : 500;
    metric("superpad.auth.login", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status });
  } finally {
    metric("superpad.auth.login.duration_ms", performance.now() - startedAt, { backend });
  }
}
