import { NextResponse } from "next/server";
import { metric } from "@vercel/functions";
import { getDb, getDbBackend } from "@/lib/db";
import {
  clearSessionCookie,
  getAuthenticatedUser,
  validateBase64String,
  verifyAuthKey,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const backend = getDbBackend();
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json(
        { authenticated: false, user: null, backend },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(
      { authenticated: true, user, backend },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { authenticated: false, user: null, backend },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const startedAt = performance.now();
  const backend = getDbBackend();

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { authKey?: unknown };
    const authKey = validateBase64String(body.authKey, "authKey", 32, 128);

    const db = await getDb();
    const res = await db.execute({
      sql: `SELECT auth_salt, auth_verifier FROM users WHERE id = ? LIMIT 1`,
      args: [user.id],
    });
    const row = res.rows[0];
    if (!row || !verifyAuthKey(authKey, String(row.auth_salt), String(row.auth_verifier))) {
      metric("superpad.auth.delete", 1, { outcome: "invalid", backend });
      return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
    }

    await db.execute({
      sql: `DELETE FROM users WHERE id = ?`,
      args: [user.id],
    });

    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);
    metric("superpad.auth.delete", 1, { outcome: "success", backend });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete account";
    metric("superpad.auth.delete", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    metric("superpad.auth.delete.duration_ms", performance.now() - startedAt, { backend });
  }
}
