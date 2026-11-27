import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { metric } from "@vercel/functions";
import { getDb, getDbBackend } from "@/lib/db";
import { getAuthenticatedUser, validateBase64String } from "@/lib/auth";
import type { EncryptedNoteDTO } from "@/types/vault";

export const dynamic = "force-dynamic";

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function mapNoteRow(row: Record<string, unknown>): EncryptedNoteDTO {
  return {
    id: String(row.id),
    encryptedMeta: String(row.encrypted_meta),
    encryptedContent: String(row.encrypted_content),
    version: Number(row.version),
    sizeBytes: Number(row.size_bytes),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at != null ? Number(row.deleted_at) : null,
  };
}

export async function GET() {
  const startedAt = performance.now();
  const backend = getDbBackend();

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getDb();
    const cutoff = Date.now() - TRASH_RETENTION_MS;

    // Auto-purge trashed notes older than 30 days
    await db.execute({
      sql: `DELETE FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?`,
      args: [user.id, cutoff],
    });

    const res = await db.execute({
      sql: `SELECT id, encrypted_meta, encrypted_content, version, size_bytes, created_at, updated_at, deleted_at
            FROM notes
            WHERE user_id = ?
            ORDER BY updated_at DESC`,
      args: [user.id],
    });

    const all = res.rows.map((r) => mapNoteRow(r as unknown as Record<string, unknown>));
    const notes = all.filter((n) => !n.deletedAt);
    const trashedNotes = all
      .filter((n) => Boolean(n.deletedAt))
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
    const totalBytes = notes.reduce((acc, n) => acc + n.sizeBytes, 0);

    metric("superpad.notes.list", 1, { outcome: "success", backend });
    return NextResponse.json(
      { notes, trashedNotes, totalBytes, backend },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list notes";
    metric("superpad.notes.list", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    metric("superpad.notes.list.duration_ms", performance.now() - startedAt, { backend });
  }
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  const backend = getDbBackend();

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      id?: unknown;
      encryptedMeta?: unknown;
      encryptedContent?: unknown;
      sizeBytes?: unknown;
    };

    const noteId =
      typeof body.id === "string" && /^[a-zA-Z0-9_-]{4,64}$/.test(body.id)
        ? body.id
        : crypto.randomUUID();
    const encryptedMeta = validateBase64String(body.encryptedMeta, "encryptedMeta", 16, 65536);
    const encryptedContent = validateBase64String(body.encryptedContent, "encryptedContent");
    const sizeBytes =
      typeof body.sizeBytes === "number" && body.sizeBytes >= 0
        ? Math.round(body.sizeBytes)
        : 0;

    const now = Date.now();
    const db = await getDb();

    const tx = await db.transaction("write");
    try {
      await tx.execute({
        sql: `INSERT INTO notes (id, user_id, encrypted_meta, encrypted_content, version, size_bytes, created_at, updated_at, deleted_at)
              VALUES (?, ?, ?, ?, 1, ?, ?, ?, NULL)`,
        args: [noteId, user.id, encryptedMeta, encryptedContent, sizeBytes, now, now],
      });
      await tx.execute({
        sql: `INSERT INTO note_revisions (id, note_id, user_id, version, encrypted_meta, encrypted_content, size_bytes, created_at)
              VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), noteId, user.id, encryptedMeta, encryptedContent, sizeBytes, now],
      });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    const note: EncryptedNoteDTO = {
      id: noteId,
      encryptedMeta,
      encryptedContent,
      version: 1,
      sizeBytes,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    metric("superpad.notes.create", 1, { outcome: "success", backend });
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create note";
    const status = message.includes("Invalid") || message.includes("exceeds") ? 400 : 500;
    metric("superpad.notes.create", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status });
  } finally {
    metric("superpad.notes.create.duration_ms", performance.now() - startedAt, { backend });
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

    const url = new URL(request.url);
    if (url.searchParams.get("trash") !== "all") {
      return NextResponse.json({ error: "Specify ?trash=all to empty trash." }, { status: 400 });
    }

    const db = await getDb();
    const res = await db.execute({
      sql: `DELETE FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL`,
      args: [user.id],
    });

    metric("superpad.notes.empty_trash", 1, { outcome: "success", backend });
    return NextResponse.json({ success: true, deletedCount: res.rowsAffected });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to empty trash";
    metric("superpad.notes.empty_trash", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    metric("superpad.notes.empty_trash.duration_ms", performance.now() - startedAt, { backend });
  }
}
