import { NextResponse } from "next/server";
import { requestMeta } from "@/lib/request";
import { loadOrderByToken } from "@/lib/orders/public";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * O link de acesso nunca aparece no HTML: o botão aponta para aqui, que
 * confirma o pagamento, regista o clique e redirecciona.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = new URL(`/pedido/${token}`, req.url);
  const db = createServiceClient();
  const order = await loadOrderByToken(db, token);
  if (!order || order.status !== "paid") return NextResponse.redirect(back, 303);

  const { data: product } = await db
    .from("products")
    .select("delivery_type, delivery_url")
    .eq("id", order.product_id)
    .single();
  if (product?.delivery_type !== "link" || !product.delivery_url) return NextResponse.redirect(back, 303);

  const { ip, userAgent } = await requestMeta();
  await db.from("order_access_logs").insert({ order_id: order.id, kind: "link_click", ip, user_agent: userAgent });

  return NextResponse.redirect(product.delivery_url, { status: 303, headers: { "Cache-Control": "no-store" } });
}
