import Link from "next/link";
import { CheckoutLink } from "@/components/admin/CheckoutLink";
import { buttonPrimary } from "@/components/ui/styles";
import { requireAdmin } from "@/lib/auth";
import { formatKz } from "@/lib/format";
import type { ProductRow } from "@/lib/products/types";
import { publicMediaUrl } from "@/lib/storage";
import { duplicateProduct, setProductActive } from "./actions";

export const metadata = { title: "Produtos" };

export default async function ProdutosPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("products").select("*").order("created_at", { ascending: false });
  const products = (data ?? []) as ProductRow[];

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Produtos</h1>
        <Link href="/admin/produtos/novo" className={buttonPrimary}>Novo produto</Link>
      </div>

      {products.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 p-10 text-center text-gray-500">
          <p>Ainda não há produtos.</p>
          <Link href="/admin/produtos/novo" className="mt-2 inline-block font-medium text-gray-900 underline">
            Criar o primeiro
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
          {products.map((p) => {
            const img = publicMediaUrl(p.image_path);
            return (
              <li key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <Link href={`/admin/produtos/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                    {img && <img src={img} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="truncate text-sm text-gray-500">
                      {formatKz(p.price)} · /{p.slug}
                    </p>
                    <div className="mt-1 flex gap-1.5 text-xs">
                      <span className={`rounded-full px-2 py-0.5 ${p.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                        {p.is_active ? "Ativo" : "Inativo"}
                      </span>
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-800">
                        {p.delivery_type === "pdf" ? "PDF" : "Link"}
                      </span>
                    </div>
                  </div>
                </Link>
                <div className="flex flex-wrap gap-2 text-sm">
                  <CheckoutLink slug={p.slug} />
                  <Link href={`/admin/produtos/${p.id}`} className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">Editar</Link>
                  <Link href={`/admin/produtos/${p.id}/checkout`} className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">Checkout</Link>
                  <form action={duplicateProduct.bind(null, p.id)}>
                    <button className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">Duplicar</button>
                  </form>
                  <form action={setProductActive.bind(null, p.id, !p.is_active)}>
                    <button className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-50">
                      {p.is_active ? "Desativar" : "Ativar"}
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
