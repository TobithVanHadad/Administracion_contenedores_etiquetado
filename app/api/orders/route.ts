import { NextRequest, NextResponse } from "next/server";
import { createOrder, patchOrder, readOrders, readUsersPublic, replaceAllOrders, resetOrders } from "@/lib/server-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const orders = await readOrders();
    const users = await readUsersPublic();
    return NextResponse.json({ orders, users });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error inesperado" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === "reset") {
      const orders = await resetOrders(body);
      return NextResponse.json({ orders });
    }

    if (body.action === "replaceAll") {
      const orders = await replaceAllOrders(Array.isArray(body.orders) ? body.orders : [], body);
      return NextResponse.json({ orders });
    }

    const orders = await createOrder(body.order, body);
    return NextResponse.json({ orders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error inesperado" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, ...action } = body;
    const orders = await patchOrder(orderId, action);
    return NextResponse.json({ orders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error inesperado" }, { status: 400 });
  }
}
