import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateDecoySalt, validateUsername } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const CHALLENGE_WINDOW_MS = 15 * 60 * 1000;
const CHALLENGE_IP_LIMIT = 40;

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const ipCheck = await checkRateLimit(`challenge:ip:${ip}`, CHALLENGE_IP_LIMIT, CHALLENGE_WINDOW_MS);
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Try again in ${ipCheck.retryAfterSeconds}s.` },
        {
          status: 429,
          headers: { "Retry-After": String(ipCheck.retryAfterSeconds) },
        }
      );
    }

    const body = (await request.json()) as { username?: unknown };
    const username = validateUsername(body.username);
    const db = await getDb();

    const res = await db.execute({
      sql: `SELECT kdf_salt FROM users WHERE username = ? LIMIT 1`,
      args: [username],
    });

    const row = res.rows[0];
    // Return deterministic decoy salt for unknown users to prevent username enumeration
    const kdfSalt = row ? String(row.kdf_salt) : generateDecoySalt(username);

    return NextResponse.json(
      { kdfSalt },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
