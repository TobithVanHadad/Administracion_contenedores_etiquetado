import { NextResponse } from "next/server";
import { ensurePersistentStorage, storageStatus } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET() {
  const status = storageStatus();

  try {
    await ensurePersistentStorage();
    return NextResponse.json({ ok: true, storage: status });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "No se pudo verificar almacenamiento.",
        storage: status
      },
      { status: 503 }
    );
  }
}
