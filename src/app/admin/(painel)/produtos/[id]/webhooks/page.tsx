import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CheckoutLink } from "@/components/admin/CheckoutLink";
import { ProductTabs } from "@/components/admin/ProductTabs";
import { WebhooksManager, type Delivery, type Endpoint } from "@/components/admin/WebhooksManager";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "Webhooks do produto" };
export const dynamic = "force-dynamic";

export default async function ProductWebhooksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { supabase } = await requireAdmin();
  const [{ data: product }, { data: endpoints }, { count: general }] = await Promise.all([
    supabase.from("products").select("id, name, slug").eq("id", id).maybeSingle(),
    supabase.from("webhook_endpoints").select("id, url, description, events, is_active, product_id").eq("product_id", id).order("created_at"),
    supabase.from("webhook_endpoints").select("id", { count: "exact", head: true }).is("product_id", null).eq("is_active", true),
  ]);
  if (!product) notFound();

  const ids = (endpoints ?? []).map((e) => e.id);
  const { data: deliveries } = ids.length
    ? await supabase
        .from("webhook_deliveries")
        .select("id, endpoint_id, event, status, attempts, last_status, last_error, next_attempt_at, created_at")
        .in("endpoint_id", ids)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [] };

  return (
    <>
      <Link href="/admin/produtos" className="text-sm text-gray-500 hover:text-gray-900">← Produtos</Link>
      <h1 className="mt-2 truncate text-2xl font-semibold">{product.name}</h1>
      <div className="mb-4 mt-2">
        <CheckoutLink slug={product.slug} showUrl />
      </div>
      <ProductTabs id={product.id} active="webhooks" />
      <p className="mb-4 text-sm text-gray-600">
        Os webhooks criados aqui só recebem os pedidos deste produto.
        {!!general && (
          <>
            {" "}Este produto também envia para {general === 1 ? "1 webhook" : `${general} webhooks`} de{" "}
            <Link href="/admin/webhooks" className="underline">todos os produtos</Link>.
          </>
        )}
      </p>
      <WebhooksManager
        endpoints={(endpoints ?? []) as Endpoint[]}
        deliveries={(deliveries ?? []) as Delivery[]}
        products={[product]}
        fixedProductId={product.id}
      />
    </>
  );
}
