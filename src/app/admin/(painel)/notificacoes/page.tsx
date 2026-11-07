import { cardClass } from "@/components/ui/styles";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { markAllRead, openNotification } from "./actions";

export const metadata = { title: "Notificações" };

const TYPES: Record<string, { label: string; c: string }> = {
  exception: { label: "Comprovativo", c: "bg-amber-100 text-amber-800" },
  fraud_block: { label: "Fraude", c: "bg-red-100 text-red-800" },
  meta_error: { label: "Meta", c: "bg-blue-100 text-blue-800" },
  reconciliation: { label: "Auditoria", c: "bg-purple-100 text-purple-800" },
  new_account: { label: "Conta nova", c: "bg-green-100 text-green-800" },
};

type Row = { id: string; type: string; title: string; order_id: string | null; proof_id: string | null; read_at: string | null; created_at: string };

function target(n: Row) {
  if (n.type === "reconciliation") return "/admin/auditoria";
  if (n.type === "new_account") return "/admin/contas";
  if (n.proof_id && n.type === "exception") return `/admin/excecoes/${n.proof_id}`;
  if (n.order_id) return `/admin/pedidos/${n.order_id}`;
  return "/admin/notificacoes";
}

export default async function NotificacoesPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("admin_notifications").select("*").order("created_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as Row[];
  const unread = rows.filter((r) => !r.read_at).length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notificações</h1>
          <p className="text-sm text-gray-500">{unread ? `${unread} por ler` : "Tudo lido"}</p>
        </div>
        {unread > 0 && (
          <form action={markAllRead}>
            <button className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">Marcar todas como lidas</button>
          </form>
        )}
      </div>
      {!rows.length ? (
        <div className={`${cardClass} text-center text-gray-500`}>Sem notificações.</div>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
          {rows.map((n) => {
            const t = TYPES[n.type] ?? { label: n.type, c: "bg-gray-100" };
            return (
              <li key={n.id}>
                <form action={openNotification.bind(null, n.id, target(n))}>
                  <button className={`flex w-full items-start gap-3 p-4 text-left hover:bg-gray-50 ${n.read_at ? "opacity-60" : ""}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-blue-600"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${t.c}`}>{t.label}</span>
                      <span className={n.read_at ? "" : "font-medium"}>{n.title}</span>
                      <span className="mt-0.5 block text-xs text-gray-500">{formatDateTime(n.created_at)}{!n.read_at && " · por ler"}</span>
                    </span>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
