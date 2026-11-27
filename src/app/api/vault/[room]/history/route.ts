import { NextResponse } from "next/server";
import { metric } from "@vercel/functions";
import { getActiveBackend, listVaultHistory } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ room: string }> }
) {
  const startedAt = performance.now();
  const backend = getActiveBackend();

  try {
    const { room } = await context.params;
    const revisions = await listVaultHistory(room);
    metric("zeropad.vault.history.list", 1, { outcome: "success", backend });
    return NextResponse.json(
      { revisions },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list history";
    const status = message.includes("Invalid") ? 400 : 500;
    metric("zeropad.vault.history.list", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status });
  } finally {
    metric("zeropad.vault.history.duration_ms", performance.now() - startedAt, { backend });
  }
}
