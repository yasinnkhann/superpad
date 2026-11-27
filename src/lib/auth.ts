import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { AuthUser } from "@/types/vault";

export const SESSION_COOKIE_NAME = "zeropad_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const USERNAME_REGEX = /^[a-z0-9_-]{3,32}$/;
const MAX_NOTE_PAYLOAD_BYTES = 12 * 1024 * 1024; // 12 MB encrypted per note

export function validateUsername(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error("Username is required.");
  }
  const normalized = raw.trim().toLowerCase();
  if (!USERNAME_REGEX.test(normalized)) {
    throw new Error(
      "Username must be 3–32 characters using letters, numbers, hyphens, or underscores."
    );
  }
  return normalized;
}

export function validateBase64String(raw: unknown, label: string, minLen = 16, maxBytes = MAX_NOTE_PAYLOAD_BYTES): string {
  if (typeof raw !== "string" || raw.length < minLen) {
    throw new Error(`Invalid ${label}.`);
  }
  if (Buffer.byteLength(raw, "utf-8") > maxBytes) {
    throw new Error(`${label} exceeds size limit.`);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new Error(`${label} must be valid base64.`);
  }
  return raw;
}

export function hashAuthKey(
  authKey: string,
  salt?: string
): { salt: string; verifier: string } {
  const actualSalt = salt ?? crypto.randomBytes(16).toString("base64");
  const derived = crypto.scryptSync(authKey, actualSalt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return {
    salt: actualSalt,
    verifier: derived.toString("base64"),
  };
}

export function verifyAuthKey(
  authKey: string,
  salt: string,
  expectedVerifier: string
): boolean {
  const candidate = crypto.scryptSync(authKey, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  const expected = Buffer.from(expectedVerifier, "base64");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

/**
 * Generates a deterministic 16-byte decoy KDF salt for non-existent usernames so
 * `/api/auth/challenge` never reveals whether a username is registered.
 */
export function generateDecoySalt(username: string): string {
  const pepper = process.env.AUTH_PEPPER || "zeropad-default-decoy-pepper-v2";
  const digest = crypto
    .createHmac("sha256", pepper)
    .update(`decoy:${username}`)
    .digest();
  return digest.subarray(0, 16).toString("base64");
}

function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{
  token: string;
  expiresAt: number;
}> {
  const db = await getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  await db.execute({
    sql: `INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    args: [tokenHash, userId, expiresAt, now],
  });

  // Opportunistic expired session cleanup for this user
  await db.execute({
    sql: `DELETE FROM sessions WHERE user_id = ? AND expires_at < ?`,
    args: [userId, now],
  });

  return { token, expiresAt };
}

export async function revokeSessionByToken(token: string): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `DELETE FROM sessions WHERE token_hash = ?`,
    args: [hashSessionToken(token)],
  });
}

export async function getAuthenticatedUserFromToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const db = await getDb();
  const tokenHash = hashSessionToken(token);
  const now = Date.now();

  const res = await db.execute({
    sql: `SELECT u.id, u.username, u.kdf_salt, u.created_at, s.expires_at
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ?
          LIMIT 1`,
    args: [tokenHash],
  });

  const row = res.rows[0];
  if (!row) return null;

  const expiresAt = Number(row.expires_at);
  if (now > expiresAt) {
    await db.execute({
      sql: `DELETE FROM sessions WHERE token_hash = ?`,
      args: [tokenHash],
    });
    return null;
  }

  return {
    id: String(row.id),
    username: String(row.username),
    kdfSalt: String(row.kdf_salt),
    createdAt: Number(row.created_at),
  };
}

export async function getAuthenticatedUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return getAuthenticatedUserFromToken(token);
}

export function attachSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: number
): void {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
