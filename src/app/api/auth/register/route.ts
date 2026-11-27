import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { metric } from "@vercel/functions";
import { getDb, getDbBackend } from "@/lib/db";
import {
  attachSessionCookie,
  createSession,
  hashAuthKey,
  validateBase64String,
  validateUsername,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const startedAt = performance.now();
  const backend = getDbBackend();

  try {
    const body = (await request.json()) as {
      username?: unknown;
      kdfSalt?: unknown;
      authKey?: unknown;
      initialNote?: {
        id?: string;
        encryptedMeta?: unknown;
        encryptedContent?: unknown;
        sizeBytes?: unknown;
      };
    };

    const username = validateUsername(body.username);
    const kdfSalt = validateBase64String(body.kdfSalt, "kdfSalt", 16, 128);
    const authKey = validateBase64String(body.authKey, "authKey", 32, 128);

    const db = await getDb();
    const userId = crypto.randomUUID();
    const { salt: authSalt, verifier } = hashAuthKey(authKey);
    const now = Date.now();

    const tx = await db.transaction("write");
    try {
      await tx.execute({
        sql: `INSERT INTO users (id, username, kdf_salt, auth_salt, auth_verifier, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [userId, username, kdfSalt, authSalt, verifier, now, now],
      });

      if (body.initialNote) {
        const noteId =
          typeof body.initialNote.id === "string" && /^[a-zA-Z0-9_-]{4,64}$/.test(body.initialNote.id)
            ? body.initialNote.id
            : crypto.randomUUID();
        const encMeta = validateBase64String(body.initialNote.encryptedMeta, "encryptedMeta", 16, 65536);
        const encContent = validateBase64String(body.initialNote.encryptedContent, "encryptedContent");
        const sizeBytes =
          typeof body.initialNote.sizeBytes === "number" && body.initialNote.sizeBytes >= 0
            ? Math.round(body.initialNote.sizeBytes)
            : 0;

        await tx.execute({
          sql: `INSERT INTO notes (id, user_id, encrypted_meta, encrypted_content, version, size_bytes, created_at, updated_at)
                VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
          args: [noteId, userId, encMeta, encContent, sizeBytes, now, now],
        });
        await tx.execute({
          sql: `INSERT INTO note_revisions (id, note_id, user_id, version, encrypted_meta, encrypted_content, size_bytes, created_at)
                VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
          args: [crypto.randomUUID(), noteId, userId, encMeta, encContent, sizeBytes, now],
        });
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("UNIQUE") || msg.includes("unique")) {
        metric("superpad.auth.register", 1, { outcome: "conflict", backend });
        return NextResponse.json(
          { error: "That username is already taken. Please choose another username." },
          { status: 409 }
        );
      }
      throw err;
    }

    const session = await createSession(userId);
    const response = NextResponse.json({
      user: {
        id: userId,
        username,
        kdfSalt,
        createdAt: now,
      },
      backend,
    });
    attachSessionCookie(response, session.token, session.expiresAt);

    metric("superpad.auth.register", 1, { outcome: "success", backend });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registration failed";
    const status = message.includes("Invalid") || message.includes("Username") ? 400 : 500;
    metric("superpad.auth.register", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status });
  } finally {
    metric("superpad.auth.register.duration_ms", performance.now() - startedAt, { backend });
  }
}
