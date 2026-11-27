import { NextResponse } from "next/server";
import { metric } from "@vercel/functions";
import { getActiveBackend, readVaultRevision } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ room: string; id: string }> }
) {
  const startedAt = performance.now();
  const backend = getActiveBackend();

  try {
    const { room, id } = await context.params;
    const result = await readVaultRevision(room, id);
    if (!result.exists) {
      metric("zeropad.vault.history.read", 1, { outcome: "not_found", backend });
      return NextResponse.json({ error: "Revision not found" }, { status: 404 });
    }
    metric("zeropad.vault.history.read", 1, { outcome: "success", backend });
    return NextResponse.json(
      {
        id,
        timestamp: result.timestamp,
        ciphertext: result.ciphertext,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load revision";
    const status = message.includes("Invalid") ? 400 : 500;
    metric("zeropad.vault.history.read", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status });
  } finally {
    metric("zeropad.vault.history.duration_ms", performance.now() - startedAt, { backend });
  }
}
