import { NextResponse } from "next/server";
import { metric } from "@vercel/functions";
import {
  deleteVault,
  getActiveBackend,
  readVault,
  writeVault,
} from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ room: string }> }
) {
  const startedAt = performance.now();
  const backend = getActiveBackend();

  try {
    const { room } = await context.params;
    const result = await readVault(room);
    metric("zeropad.vault.read", 1, {
      outcome: result.exists ? "found" : "empty",
      backend,
    });
    return NextResponse.json(
      {
        exists: result.exists,
        ciphertext: result.ciphertext,
        updatedAt: result.updatedAt,
        size: result.size,
        storage: result.backend,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read vault";
    const status = message.includes("Invalid room") ? 400 : 500;
    metric("zeropad.vault.read", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status });
  } finally {
    metric("zeropad.vault.read.duration_ms", performance.now() - startedAt, { backend });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ room: string }> }
) {
  const startedAt = performance.now();
  const backend = getActiveBackend();

  try {
    const { room } = await context.params;
    const body = (await request.json()) as { ciphertext?: unknown };
    const result = await writeVault(room, body.ciphertext as string);

    metric("zeropad.vault.write", 1, { outcome: "success", backend });
    metric("zeropad.vault.write.bytes", result.size, { backend });

    return NextResponse.json({
      success: true,
      updatedAt: result.updatedAt,
      size: result.size,
      revisionId: result.revisionId,
      storage: result.backend,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save vault";
    const status =
      message.includes("Invalid") || message.includes("exceeds") ? 400 : 500;
    metric("zeropad.vault.write", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status });
  } finally {
    metric("zeropad.vault.write.duration_ms", performance.now() - startedAt, { backend });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ room: string }> }
) {
  const startedAt = performance.now();
  const backend = getActiveBackend();

  try {
    const { room } = await context.params;
    await deleteVault(room);
    metric("zeropad.vault.delete", 1, { outcome: "success", backend });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete vault";
    const status = message.includes("Invalid") ? 400 : 500;
    metric("zeropad.vault.delete", 1, { outcome: "error", backend });
    return NextResponse.json({ error: message }, { status });
  } finally {
    metric("zeropad.vault.delete.duration_ms", performance.now() - startedAt, { backend });
  }
}
