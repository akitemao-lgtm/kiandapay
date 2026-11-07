import { NextResponse } from "next/server";
import { loadOrderByToken, orderView } from "@/lib/orders/public";
import { getSettings } from "@/lib/settings";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** Consultado pela página do pedido para se actualizar sozinha. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = createServiceClient();
  const order = await loadOrderByToken(db, token);
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const settings = await getSettings(db, order.owner_id);
  return NextResponse.json(
    { view: orderView(order, settings), uploads: order.upload_count },
    { headers: { "Cache-Control": "no-store" } },
  );
}
