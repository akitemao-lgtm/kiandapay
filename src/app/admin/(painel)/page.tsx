import Link from "next/link";
import { RevenueChart, type DailyRow } from "@/components/admin/dashboard/RevenueChart";
import { cardClass } from "@/components/ui/styles";
import { requireAdmin } from "@/lib/auth";
import { formatKz } from "@/lib/format";

export const metadata = { title: "Dashboard" };

type Totals = {
  visits: number; orders: number; orders_paid: number; sales: number; sales_auto: number;
  revenue: number; pending_exceptions: number; awaiting_payment: number;
};
type ProductRow = { id: string; name: string; visits: number; orders: number; sales: number; revenue: number };
type CampaignRow = { source: string; campaign: string; visits: number; orders: number; sales: number; revenue: number };
type Dashboard = { totals: Totals; by_product: ProductRow[]; by_campaign: CampaignRow[]; daily: DailyRow[] };

const PERIODS = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "mes", label: "Este mês" },
] as const;

/** Data de hoje em Luanda (UTC+1) como "AAAA-MM-DD". */
function luandaToday() {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}
function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Início do dia em Luanda → instante UTC. */
const startOf = (day: string) => new Date(`${day}T00:00:00+01:00`).toISOString();

function resolvePeriod(sp: { p?: string; de?: string; ate?: string }) {
  const today = luandaToday();
  const valid = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (sp.p === "custom" && valid(sp.de) && valid(sp.ate) && sp.de! <= sp.ate!) {
    const days = (Date.parse(sp.ate!) - Date.parse(sp.de!)) / 86_400_000;
    const from = days > 366 ? addDays(sp.ate!, -366) : sp.de!;
    return { key: "custom", from, to: sp.ate! };
  }
  if (sp.p === "hoje") return { key: "hoje", from: today, to: today };
  if (sp.p === "30d") return { key: "30d", from: addDays(today, -29), to: today };
  if (sp.p === "mes") return { key: "mes", from: `${today.slice(0, 8)}01`, to: today };
  return { key: "7d", from: addDays(today, -6), to: today };
}

const pct = (a: number, b: number) => (b <= 0 ? "—" : a > b ? "> 100%" : `${((a / b) * 100).toFixed(1).replace(".", ",")}%`);

function Tile({ label, value, hint, href }: { label: string; value: string | number; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className={`${cardClass} block hover:ring-gray-300`}>{body}</Link>
  ) : (
    <div className={cardClass}>{body}</div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ p?: string; de?: string; ate?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const period = resolvePeriod(sp);
  const { data, error } = await supabase.rpc("admin_dashboard", {
    p_from: startOf(period.from),
    p_to: startOf(addDays(period.to, 1)),
  });
  if (error || !data) {
    return <p className="text-red-600">Não foi possível carregar o dashboard.</p>;
  }
  const d = data as Dashboard;
  const t = d.totals;

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <form className="flex flex-wrap items-center gap-2 text-sm">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`?p=${p.key}`}
              className={`rounded-full px-3 py-1.5 ${period.key === p.key ? "bg-gray-900 text-white" : "bg-white ring-1 ring-gray-200 hover:bg-gray-50"}`}
            >
              {p.label}
            </Link>
          ))}
          <input type="hidden" name="p" value="custom" />
          <input type="date" name="de" defaultValue={period.from} aria-label="Desde" className="rounded-lg border border-gray-300 px-2 py-1" />
          <input type="date" name="ate" defaultValue={period.to} aria-label="Até" className="rounded-lg border border-gray-300 px-2 py-1" />
          <button className="rounded-lg border border-gray-300 bg-white px-3 py-1 hover:bg-gray-50">Aplicar</button>
        </form>
      </div>

      <section className={`${cardClass} mb-4`}>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Faturação</p>
        <p className="mt-1 break-words text-4xl font-semibold tabular-nums sm:text-5xl">{formatKz(t.revenue)}</p>
        <p className="mt-1 text-sm text-gray-500">{t.sales} venda(s) paga(s) no período</p>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile label="Checkouts iniciados" value={t.visits} />
        <Tile label="Pedidos" value={t.orders} hint={`${pct(t.orders, t.visits)} dos checkouts`} />
        <Tile label="Vendas pagas" value={t.sales} />
        <Tile label="Conversão" value={pct(t.orders_paid, t.visits)} hint={`pedido → pago: ${pct(t.orders_paid, t.orders)}`} />
        <Tile label="Aprovação automática" value={pct(t.sales_auto, t.sales)} hint={`${t.sales_auto} de ${t.sales} sem intervenção`} />
        <Tile label="Exceções pendentes" value={t.pending_exceptions} hint={`${t.awaiting_payment} a aguardar pagamento`} href="/admin/excecoes" />
      </div>

      <section className={`${cardClass} mb-6`}>
        <h2 className="mb-1 font-semibold">Faturação por dia</h2>
        <RevenueChart data={d.daily.map((r) => ({ ...r, revenue: Number(r.revenue) }))} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={cardClass}>
          <h2 className="mb-3 font-semibold">Por produto</h2>
          <BreakdownTable
            rows={d.by_product.map((r) => ({ key: r.id, label: r.name, ...r }))}
            empty="Sem atividade no período."
          />
        </section>
        <section className={cardClass}>
          <h2 className="mb-3 font-semibold">Por campanha (UTM)</h2>
          <BreakdownTable
            rows={d.by_campaign.map((r) => ({ key: `${r.source}/${r.campaign}`, label: r.campaign, sub: r.source, ...r }))}
            empty="Sem atividade no período."
          />
        </section>
      </div>
      <p className="mt-4 text-xs text-gray-400">
        Checkouts e pedidos contam pela data de criação; vendas e faturação pela data de pagamento. Datas em hora de Angola.
      </p>
    </>
  );
}

function BreakdownTable({
  rows, empty,
}: {
  rows: { key: string; label: string; sub?: string; visits: number; orders: number; sales: number; revenue: number }[];
  empty: string;
}) {
  if (!rows.length) return <p className="text-sm text-gray-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="pb-2 pr-3" />
            <th className="pb-2 pr-3 text-right">Checkouts</th>
            <th className="pb-2 pr-3 text-right">Pedidos</th>
            <th className="pb-2 pr-3 text-right">Vendas</th>
            <th className="pb-2 text-right">Faturação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="py-2 pr-3">
                <span className="font-medium">{r.label}</span>
                {r.sub && <span className="block text-xs text-gray-500">{r.sub}</span>}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.visits}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.orders}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {r.sales} <span className="text-xs text-gray-400">{pct(r.sales, r.visits)}</span>
              </td>
              <td className="py-2 text-right tabular-nums">{formatKz(r.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
