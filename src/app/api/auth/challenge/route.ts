import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateDecoySalt, validateUsername } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
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
