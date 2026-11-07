import Link from "next/link";
import { ORDER_STATUSES, StatusBadge } from "@/components/admin/StatusBadge";
import { inputClass } from "@/components/ui/styles";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatKz } from "@/lib/format";
import { formatAngolanPhone } from "@/lib/phone";

export const metadata = { title: "Pedidos" };

const PAGE = 50;

type Search = { estado?: string; produto?: string; de?: string; ate?: string; pagina?: string };

/** "2026-10-16" (data de Luanda) → ISO do início desse dia em Luanda. */
function luandaDay(d: string, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return new Date(`${d}T${endOfDay ? "23:59:59.999" : "00:00:00"}+01:00`).toISOString();
}

export default async function PedidosPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const page = Math.max(1, Number(sp.pagina) || 1);

  let q = supabase
    .from("orders")
    .select("id, order_number, created_at, customer_name, customer_phone, product_name, amount_due, status, utm_campaign, utm_source", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.estado && ORDER_STATUSES.some((s) => s.value === sp.estado)) q = q.eq("status", sp.estado);
  if (sp.produto && /^[0-9a-f-]{36}$/.test(sp.produto)) q = q.eq("product_id", sp.produto);
  const from = sp.de ? luandaDay(sp.de) : null;
  const to = sp.ate ? luandaDay(sp.ate, true) : null;
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to);

  const [{ data: orders, count }, { data: products }] = await Promise.all([
    q,
    supabase.from("products").select("id, name").order("name"),
  ]);
  const total = count ?? 0;
  const link = (p: number) => `?${new URLSearchParams({ ...sp, pagina: String(p) } as Record<string, string>)}`;

  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Pedidos</h1>
      <form className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <select name="estado" defaultValue={sp.estado ?? ""} className={inputClass} aria-label="Estado">
          <option value="">Todos os estados</option>
          {ORDER_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select name="produto" defaultValue={sp.produto ?? ""} className={inputClass} aria-label="Produto">
          <option value="">Todos os produtos</option>
          {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" name="de" defaultValue={sp.de} className={inputClass} aria-label="Desde" />
        <input type="date" name="ate" defaultValue={sp.ate} className={inputClass} aria-label="Até" />
        <button className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white">Filtrar</button>
      </form>

      <p className="mb-2 text-sm text-gray-500">{total} pedido(s)</p>
      <ul className="divide-y divide-gray-200 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
        {(orders ?? []).map((o) => (
          <li key={o.id}>
            <Link href={`/admin/pedidos/${o.id}`} className="flex items-center gap-3 p-4 hover:bg-gray-50">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">#{o.order_number} · {o.customer_name}</p>
                <p className="truncate text-sm text-gray-700 tabular-nums">{formatAngolanPhone(o.customer_phone)}</p>
                <p className="truncate text-sm text-gray-500">
                  {o.product_name} · {formatDateTime(o.created_at)}
                  {o.utm_campaign && ` · ${o.utm_source ?? ""}/${o.utm_campaign}`}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-sm font-medium">{formatKz(o.amount_due)}</span>
                <StatusBadge status={o.status} />
              </div>
            </Link>
          </li>
        ))}
        {!orders?.length && <li className="p-8 text-center text-gray-500">Nenhum pedido com estes filtros.</li>}
      </ul>
      {total > PAGE && (
        <div className="mt-4 flex justify-between text-sm">
          {page > 1 ? <Link href={link(page - 1)} className="underline">← Anteriores</Link> : <span />}
          {page * PAGE < total && <Link href={link(page + 1)} className="underline">Seguintes →</Link>}
        </div>
      )}
    </>
  );
}
