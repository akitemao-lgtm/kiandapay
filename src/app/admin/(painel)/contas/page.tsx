import Link from "next/link";
import { AccountActions } from "@/components/admin/AccountActions";
import { cardClass } from "@/components/ui/styles";
import { listAccounts, STATUS_LABELS } from "@/lib/accounts";
import { requirePlatformAdmin } from "@/lib/auth";
import { formatDateTime, formatKz } from "@/lib/format";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata = { title: "Contas" };
export const dynamic = "force-dynamic";

export default async function ContasPage() {
  await requirePlatformAdmin();
  const accounts = await listAccounts(createServiceClient());
  const pending = accounts.filter((a) => a.status === "pending");
  const others = accounts.filter((a) => a.status !== "pending");

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Contas</h1>
        <p className="text-sm text-gray-500">
          {accounts.length} contas · {pending.length ? `${pending.length} por aprovar` : "nenhuma por aprovar"}
        </p>
      </div>

      {pending.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 font-semibold">Por aprovar</h2>
          <AccountList rows={pending} />
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Todas</h2>
        {others.length ? <AccountList rows={others} /> : <div className={`${cardClass} text-center text-gray-500`}>Sem contas.</div>}
      </section>
    </>
  );
}

function AccountList({ rows }: { rows: Awaited<ReturnType<typeof listAccounts>> }) {
  return (
    <ul className="divide-y divide-gray-200 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
      {rows.map((a) => {
        const s = STATUS_LABELS[a.status];
        return (
          <li key={a.user_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/admin/contas/${a.user_id}`} className="font-medium underline-offset-2 hover:underline">
                  {a.display_name || "Sem nome"}
                </Link>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.c}`}>{s.label}</span>
                {a.is_platform_admin && <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs font-medium text-white">Dono</span>}
              </div>
              <p className="mt-0.5 break-all text-sm text-gray-600">
                {a.email ?? "—"}{a.phone ? ` · ${a.phone}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                Criada {formatDateTime(a.created_at)} · {a.products} produtos · {a.orders} pedidos · {a.paid} vendas ·{" "}
                {formatKz(a.revenue)}
              </p>
              {a.status === "suspended" && a.suspended_reason && (
                <p className="mt-1 text-xs text-red-700">Motivo: {a.suspended_reason}</p>
              )}
            </div>
            {!a.is_platform_admin && <AccountActions id={a.user_id} status={a.status} name={a.display_name} />}
          </li>
        );
      })}
    </ul>
  );
}
