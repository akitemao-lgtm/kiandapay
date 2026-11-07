import { NextResponse } from "next/server";
import { requestMeta } from "@/lib/request";
import { loadOrderByToken } from "@/lib/orders/public";
import { BUCKETS } from "@/lib/storage";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Gera, no momento do clique, um link assinado de 60 s para o PDF actual do
 * produto e regista o download. O ficheiro nunca é público.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = new URL(`/pedido/${token}`, req.url);
  const db = createServiceClient();
  const order = await loadOrderByToken(db, token);
  if (!order || order.status !== "paid") return NextResponse.redirect(back, 303);

  const { data: product } = await db
    .from("products")
    .select("delivery_type, delivery_file_path, delivery_file_name, delivery_file_version")
    .eq("id", order.product_id)
    .single();
  if (product?.delivery_type !== "pdf" || !product.delivery_file_path) return NextResponse.redirect(back, 303);

  const { data: signed } = await db.storage
    .from(BUCKETS.productFiles)
    .createSignedUrl(product.delivery_file_path, 60, { download: product.delivery_file_name ?? true });
  if (!signed) return NextResponse.redirect(back, 303);

  const { ip, userAgent } = await requestMeta();
  await db.from("order_access_logs").insert({
    order_id: order.id, kind: "pdf_download", file_version: product.delivery_file_version, ip, user_agent: userAgent,
  });

  return NextResponse.redirect(signed.signedUrl, { status: 303, headers: { "Cache-Control": "no-store" } });
}
