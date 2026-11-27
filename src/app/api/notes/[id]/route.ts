import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { metric } from "@vercel/functions";
import { getDb, getDbBackend } from "@/lib/db";
import { getAuthenticatedUser, validateBase64String } from "@/lib/auth";
import type { EncryptedNoteDTO } from "@/types/vault";

export const dynamic = "force-dynamic";

const MAX_REVISIONS_PER_NOTE = 10;

function mapNoteRow(row: Record<string, unknown>): EncryptedNoteDTO {
  return {
    id: String(row.id),
    encryptedMeta: String(row.encrypted_meta),
    encryptedContent: String(row.encrypted_content),
    version: Number(row.version),
    sizeBytes: Number(row.size_bytes),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT id, encrypted_meta, encrypted_content, version, size_bytes, created_at, updated_at
          FROM notes WHERE id = ? AND user_id = ? LIMIT 1`,
    args: [id, user.id],
  });

  const row = res.rows[0];
  if (!row) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  return NextResponse.json(
    { note: mapNoteRow(row as unknown as Record<string, unknown>) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const startedAt = performance.now();
  const backend = getDbBackend();

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = (await request.json()) as {
      encryptedMeta?: unknown;
      encryptedContent?: unknown;
      sizeBytes?: unknown;
      expectedVersion?: unknown;
      force?: boolean;
    };

    const encryptedMeta = validateBase64String(body.encryptedMeta, "encryptedMeta", 16, 65536);
    const encryptedContent = validateBase64String(body.encryptedContent, "encryptedContent");
    const sizeBytes =
      typeof body.sizeBytes === "number" && body.sizeBytes >= 0
        ? Math.round(body.sizeBytes)
        : 0;
    const expectedVersion =
      typeof body.expectedVersion === "number" && body.expectedVersion >= 1
        ? Math.round(body.expectedVersion)
        : null;
    const force = Boolean(body.force);

    const db = await getDb();
    const now = Date.now();

    const tx = await db.transaction("write");
    try {
      const existingRes = await tx.execute({
        sql: `SELECT id, encrypted_meta, encrypted_content, version, size_bytes, created_at, updated_at
              FROM notes WHERE id = ? AND user_id = ? LIMIT 1`,
        args: [id, user.id],
      });
      const existing = existingRes.rows[0];
      if (!existing) {
        await tx.rollback();
        return NextResponse.json({ error: "Note not found" }, { status: 404 });
      }

      const currentVersion = Number(existing.version);
      if (!force && expectedVersion !== null && currentVersion !== expectedVersion) {
        await tx.rollback();
        metric("zeropad.notes.update", 1, { outcome: "conflict", backend });
        return NextResponse.json(
          {
            error: "This note was modified on another device.",
            conflict: true,
            remoteNote: mapNoteRow(existing as unknown as Record<string, unknown>),
          },
          { status: 409 }
        );
      }

      const nextVersion = currentVersion + 1;

      await tx.execute({
        sql: `UPDATE notes
              SET encrypted_meta = ?, encrypted_content = ?, version = ?, size_bytes = ?, updated_at = ?
              WHERE id = ? AND user_id = ?`,
        args: [encryptedMeta, encryptedContent, nextVersion, sizeBytes, now, id, user.id],
      });

      await tx.execute({
        sql: `INSERT INTO note_revisions (id, note_id, user_id, version, encrypted_meta, encrypted_content, size_bytes, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          crypto.randomUUID(),
          id,
          user.id,
          nextVersion,
          encryptedMeta,
          encryptedContent,
          sizeBytes,
          now,
        ],
      });

      // Prune revisions beyond the latest 10 for this note
      await tx.execute({
        sql: `DELETE FROM note_revisions
              WHERE note_id = ? AND user_id = ? AND id NOT IN (
                SELECT id FROM note_revisions
                WHERE note_id = ? AND user_id = ?
                ORDER BY version DESC, created_at DESC
                LIMIT ?
              )`,
        args: [id, user.id, id, user.id, MAX_REVISIONS_PER_NOTE],
      });

      await tx.commit();

      const updated: EncryptedNoteDTO = {
        id,
        encryptedMeta,
        encryptedContent,
        version: nextVersion,
        sizeBytes,
        createdAt: Number(existing.created_at),
        updatedAt: now,
      };

      metric("zeropad.notes.update", 1, { outcome: "success", backend });
      metric("zeropad.notes.update.bytes", sizeBytes, { backend });
      return NextResponse.json({ note: updated });
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save note";
    const status = message.includes("Invalid") || message.includes("exceeds") ? 400 : 500;
    metric("zeropad.notes.update", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status });
  } finally {
    metric("zeropad.notes.update.duration_ms", performance.now() - startedAt, { backend });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const startedAt = performance.now();
  const backend = getDbBackend();

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const db = await getDb();
    const res = await db.execute({
      sql: `DELETE FROM notes WHERE id = ? AND user_id = ?`,
      args: [id, user.id],
    });

    if (res.rowsAffected === 0) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    metric("zeropad.notes.delete", 1, { outcome: "success", backend });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete note";
    metric("zeropad.notes.delete", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    metric("zeropad.notes.delete.duration_ms", performance.now() - startedAt, { backend });
  }
}
