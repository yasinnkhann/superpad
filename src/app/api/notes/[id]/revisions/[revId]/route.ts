import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; revId: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, revId } = await context.params;
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT id, note_id, version, encrypted_meta, encrypted_content, size_bytes, created_at
          FROM note_revisions
          WHERE id = ? AND note_id = ? AND user_id = ?
          LIMIT 1`,
    args: [revId, id, user.id],
  });

  const row = res.rows[0];
  if (!row) {
    return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      revision: {
        id: String(row.id),
        noteId: String(row.note_id),
        version: Number(row.version),
        encryptedMeta: String(row.encrypted_meta),
        encryptedContent: String(row.encrypted_content),
        sizeBytes: Number(row.size_bytes),
        createdAt: Number(row.created_at),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
