import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductForm } from "@/components/admin/ProductForm";
import { CheckoutLink } from "@/components/admin/CheckoutLink";
import { ProductTabs } from "@/components/admin/ProductTabs";
import { requireAdmin } from "@/lib/auth";
import type { ProductRow } from "@/lib/products/types";

export const metadata = { title: "Editar produto" };

export default async function EditarProdutoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const product = data as ProductRow;

  const notice = sp.criado
    ? "Produto criado. Personalize agora o checkout no separador ao lado."
    : sp.duplicado
      ? "Cópia criada (inativa). Reveja o nome e o endereço antes de ativar."
      : null;

  return (
    <>
      <Link href="/admin/produtos" className="text-sm text-gray-500 hover:text-gray-900">← Produtos</Link>
      <h1 className="mt-2 truncate text-2xl font-semibold">{product.name}</h1>
      <div className="mb-4 mt-2">
        <CheckoutLink slug={product.slug} showUrl />
      </div>
      <ProductTabs id={product.id} active="produto" />
      {notice && <p className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</p>}
      <ProductForm product={product} />
    </>
  );
}
