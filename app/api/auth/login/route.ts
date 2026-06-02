import { NextRequest, NextResponse } from "next/server";
import { verifyLogin } from "@/lib/server-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const user = await verifyLogin({
      user: String(body.user || ""),
      pin: String(body.pin || "")
    });

    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo iniciar sesion." }, { status: 401 });
  }
}
