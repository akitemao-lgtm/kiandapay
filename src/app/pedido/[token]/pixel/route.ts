import { NextResponse } from "next/server";
import { loadPixelConfig } from "@/lib/meta/config";
import { TOKEN_REGEX } from "@/lib/orders/public";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** O browser avisa que o Pixel disparou InitiateCheckout/Purchase (histórico do pedido). */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_REGEX.test(token)) return new NextResponse(null, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { event?: string };
  if (body.event !== "InitiateCheckout" && body.event !== "Purchase") return new NextResponse(null, { status: 400 });

  const db = createServiceClient();
  const { data: order } = await db
    .from("orders")
    .select("id, product_id, status, initiate_checkout_event_id, purchase_event_id, purchase_pixel_fired_at")
    .eq("public_token", token)
    .maybeSingle();
  if (!order) return new NextResponse(null, { status: 404 });
  if (body.event === "Purchase" && (order.status !== "paid" || order.purchase_pixel_fired_at)) {
    return new NextResponse(null, { status: 204 });
  }

  const eventId = body.event === "Purchase" ? order.purchase_event_id : order.initiate_checkout_event_id;
  const { count } = await db
    .from("meta_events")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id)
    .eq("event_id", eventId)
    .eq("source", "browser");
  if (!count) {
    const pixel = await loadPixelConfig(db, order.product_id);
    await db.from("meta_events").insert({
      product_id: order.product_id, order_id: order.id, event_name: body.event, event_id: eventId,
      source: "browser", trigger: body.event === "Purchase" ? "status_page" : "auto", pixel_id: pixel?.pixelId ?? null,
      status: "success", sent_at: new Date().toISOString(),
    });
  }
  if (body.event === "Purchase") {
    await db.from("orders").update({ purchase_pixel_fired_at: new Date().toISOString() }).eq("id", order.id);
  }
  return new NextResponse(null, { status: 204 });
}
