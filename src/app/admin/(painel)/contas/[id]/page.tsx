import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AccountActions, ProductToggle } from "@/components/admin/AccountActions";
import { cardClass } from "@/components/ui/styles";
import { listAccounts, STATUS_LABELS } from "@/lib/accounts";
import { requirePlatformAdmin } from "@/lib/auth";
import { formatDateTime, formatKz } from "@/lib/format";
import { formatReference } from "@/lib/settings";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata = { title: "Conta" };
export const dynamic = "force-dynamic";

export default async function ContaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePlatformAdmin();
  if (!z.string().uuid().safeParse(id).success) notFound();

  const db = createServiceClient();
  const [account] = await listAccounts(db, id);
  if (!account) notFound();

  const [{ data: products }, { data: orders }, { data: refs }] = await Promise.all([
    db.from("products").select("id, name, slug, price, is_active").eq("owner_id", id).order("created_at", { ascending: false }),
    db.from("orders")
      .select("id, order_number, product_name, customer_name, amount_due, status, created_at")
      .eq("owner_id", id).order("created_at", { ascending: false }).limit(30),
    db.from("payment_references").select("id, label, entity, reference, is_default, is_active").eq("owner_id", id).order("created_at"),
  ]);
  const s = STATUS_LABELS[account.status];

  return (
    <>
      <Link href="/admin/contas" className="text-sm text-gray-500 underline">← Contas</Link>
      <div className="mb-6 mt-2 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{account.display_name || "Sem nome"}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.c}`}>{s.label}</span>
          </div>
          <p className="mt-1 break-all text-sm text-gray-600">{account.email ?? "—"}{account.phone ? ` · ${account.phone}` : ""}</p>
          <p className="mt-1 text-sm text-gray-600">
            {account.orders} pedidos · {account.paid} vendas · {formatKz(account.revenue)}
          </p>
        </div>
        {!account.is_platform_admin && <AccountActions id={account.user_id} status={account.status} name={account.display_name} />}
      </div>

      <section className={`${cardClass} mb-6`}>
        <h2 className="mb-3 font-semibold">Produtos ({products?.length ?? 0})</h2>
        {products?.length ? (
          <ul className="divide-y divide-gray-100">
            {products.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <a href={`/${p.slug}`} target="_blank" className="font-medium underline-offset-2 hover:underline">{p.name}</a>
                  <p className="text-xs text-gray-500">/{p.slug} · {formatKz(p.price)} · {p.is_active ? "Ativo" : "Inativo"}</p>
                </div>
                <ProductToggle accountId={id} productId={p.id} active={p.is_active} />
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-gray-500">Sem produtos.</p>}
      </section>

      <section className={`${cardClass} mb-6`}>
        <h2 className="mb-3 font-semibold">Referências de pagamento</h2>
        {refs?.length ? (
          <ul className="space-y-1 text-sm">
            {refs.map((r) => (
              <li key={r.id} className={r.is_active ? "" : "opacity-60"}>
                <span className="font-mono">{r.entity} / {formatReference(r.reference)}</span>
                {r.label && ` · ${r.label}`}
                {r.is_default && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Em uso</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-gray-500">Sem referências.</p>}
      </section>

      <section className={cardClass}>
        <h2 className="mb-3 font-semibold">Últimos pedidos</h2>
        {orders?.length ? (
          <ul className="divide-y divide-gray-100 text-sm">
            {orders.map((o) => (
              <li key={o.id} className="py-2">
                <span className="font-medium">#{o.order_number}</span> · {o.product_name} · {o.customer_name}
                <span className="block text-xs text-gray-500">{formatKz(o.amount_due)} · {o.status} · {formatDateTime(o.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-gray-500">Sem pedidos.</p>}
      </section>
    </>
  );
}
