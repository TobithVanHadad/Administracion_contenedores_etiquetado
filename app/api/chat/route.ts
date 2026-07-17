import { NextRequest, NextResponse } from "next/server";
import { addChatMessage, readChatMessages } from "@/lib/chat-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = request.nextUrl.searchParams.get("user") || undefined;
    const messages = await readChatMessages(user);
    return NextResponse.json({ messages });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo leer el chat." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const messages = await addChatMessage({ user: body.user, pin: body.pin }, String(body.body || ""), body.directTo ? String(body.directTo) : undefined);
    return NextResponse.json({ messages });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo enviar el mensaje." }, { status: 400 });
  }
}
