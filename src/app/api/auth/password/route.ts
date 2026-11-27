import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { metric } from "@vercel/functions";
import { getDb, getDbBackend } from "@/lib/db";
import {
  attachSessionCookie,
  createSession,
  getAuthenticatedUser,
  hashAuthKey,
  validateBase64String,
  verifyAuthKey,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

interface ReencryptedNoteItem {
  id: string;
  encryptedMeta: string;
  encryptedContent: string;
  sizeBytes: number;
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  const backend = getDbBackend();

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateCheck = await checkRateLimit(`pwd:user:${user.id}`, 6, 15 * 60 * 1000);
    if (!rateCheck.allowed) {
      metric("superpad.auth.password_change", 1, { outcome: "rate_limited", backend });
      return NextResponse.json(
        { error: `Too many password change attempts. Try again in ${rateCheck.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfterSeconds) } }
      );
    }

    const body = (await request.json()) as {
      currentAuthKey?: unknown;
      newKdfSalt?: unknown;
      newAuthKey?: unknown;
      notes?: ReencryptedNoteItem[];
    };

    const currentAuthKey = validateBase64String(body.currentAuthKey, "currentAuthKey", 32, 128);
    const newKdfSalt = validateBase64String(body.newKdfSalt, "newKdfSalt", 16, 128);
    const newAuthKey = validateBase64String(body.newAuthKey, "newAuthKey", 32, 128);
    const reencryptedNotes = Array.isArray(body.notes) ? body.notes : [];

    const db = await getDb();
    const userRes = await db.execute({
      sql: `SELECT auth_salt, auth_verifier FROM users WHERE id = ? LIMIT 1`,
      args: [user.id],
    });
    const row = userRes.rows[0];
    if (
      !row ||
      !verifyAuthKey(currentAuthKey, String(row.auth_salt), String(row.auth_verifier))
    ) {
      metric("superpad.auth.password_change", 1, { outcome: "invalid", backend });
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }

    const { salt: newAuthSalt, verifier: newVerifier } = hashAuthKey(newAuthKey);
    const now = Date.now();

    // Atomic transaction: rotate credentials, revoke all existing sessions, and update all notes
    const tx = await db.transaction("write");
    try {
      await tx.execute({
        sql: `UPDATE users SET kdf_salt = ?, auth_salt = ?, auth_verifier = ?, updated_at = ?
              WHERE id = ?`,
        args: [newKdfSalt, newAuthSalt, newVerifier, now, user.id],
      });

      // Revoke every existing session across all devices on master password rotation
      await tx.execute({
        sql: `DELETE FROM sessions WHERE user_id = ?`,
        args: [user.id],
      });

      // Clear old-key revisions that can no longer be decrypted under the new key
      await tx.execute({
        sql: `DELETE FROM note_revisions WHERE user_id = ?`,
        args: [user.id],
      });

      for (const item of reencryptedNotes) {
        const encMeta = validateBase64String(item.encryptedMeta, "encryptedMeta", 16, 65536);
        const encContent = validateBase64String(item.encryptedContent, "encryptedContent");
        const sizeBytes =
          typeof item.sizeBytes === "number" && item.sizeBytes >= 0
            ? Math.round(item.sizeBytes)
            : 0;

        await tx.execute({
          sql: `UPDATE notes
                SET encrypted_meta = ?, encrypted_content = ?, size_bytes = ?, version = version + 1, updated_at = ?
                WHERE id = ? AND user_id = ?`,
          args: [encMeta, encContent, sizeBytes, now, item.id, user.id],
        });

        await tx.execute({
          sql: `INSERT INTO note_revisions (id, note_id, user_id, version, encrypted_meta, encrypted_content, size_bytes, created_at)
                SELECT ?, id, user_id, version, encrypted_meta, encrypted_content, size_bytes, ?
                FROM notes WHERE id = ? AND user_id = ?`,
          args: [crypto.randomUUID(), now, item.id, user.id],
        });
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    // Issue a brand-new session strictly for this device
    const freshSession = await createSession(user.id);
    const response = NextResponse.json({
      success: true,
      kdfSalt: newKdfSalt,
      sessionsRevoked: true,
    });
    attachSessionCookie(response, freshSession.token, freshSession.expiresAt);

    metric("superpad.auth.password_change", 1, { outcome: "success", backend });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password update failed";
    metric("superpad.auth.password_change", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    metric("superpad.auth.password_change.duration_ms", performance.now() - startedAt, { backend });
  }
}
