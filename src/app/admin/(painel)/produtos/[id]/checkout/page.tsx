import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckoutEditor } from "@/components/admin/CheckoutEditor";
import { CheckoutLink } from "@/components/admin/CheckoutLink";
import { ProductTabs } from "@/components/admin/ProductTabs";
import { requireAdmin } from "@/lib/auth";
import { toCheckoutConfig } from "@/lib/checkout/defaults";
import type { CheckoutPageRow } from "@/lib/checkout/types";
import type { ProductRow } from "@/lib/products/types";
import { publicMediaUrl } from "@/lib/storage";

export const metadata = { title: "Personalizar checkout" };

export default async function CheckoutConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAdmin();

  const [{ data: product }, { data: page }, { data: settings }] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).maybeSingle(),
    supabase.from("checkout_pages").select("*").eq("product_id", id).maybeSingle(),
    supabase.from("settings").select("payment_entity, payment_reference").maybeSingle(),
  ]);
  if (!product) notFound();
  const p = product as ProductRow;

  return (
    <>
      <Link href="/admin/produtos" className="text-sm text-gray-500 hover:text-gray-900">← Produtos</Link>
      <h1 className="mt-2 truncate text-2xl font-semibold">{p.name}</h1>
      <div className="mb-4 mt-2">
        <CheckoutLink slug={p.slug} showUrl />
      </div>
      <ProductTabs id={p.id} active="checkout" />
      <CheckoutEditor
        productId={p.id}
        product={{
          name: p.name,
          description: p.description,
          price: Number(p.price),
          imageUrl: publicMediaUrl(p.image_path),
        }}
        initial={toCheckoutConfig(page as CheckoutPageRow | null)}
        entity={settings?.payment_entity ?? ""}
        reference={settings?.payment_reference ?? ""}
      />
    </>
  );
}
