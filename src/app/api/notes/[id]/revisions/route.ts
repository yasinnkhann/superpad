import { NextResponse } from "next/server";
import { metric } from "@vercel/functions";
import { getDb, getDbBackend } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
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
      sql: `SELECT id, note_id, version, size_bytes, created_at
            FROM note_revisions
            WHERE note_id = ? AND user_id = ?
            ORDER BY version DESC, created_at DESC
            LIMIT 10`,
      args: [id, user.id],
    });

    const revisions = res.rows.map((r) => ({
      id: String(r.id),
      noteId: String(r.note_id),
      version: Number(r.version),
      sizeBytes: Number(r.size_bytes),
      createdAt: Number(r.created_at),
    }));

    metric("superpad.notes.revisions", 1, { outcome: "success", backend });
    return NextResponse.json(
      { revisions },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load revisions";
    metric("superpad.notes.revisions", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    metric("superpad.notes.revisions.duration_ms", performance.now() - startedAt, { backend });
  }
}
