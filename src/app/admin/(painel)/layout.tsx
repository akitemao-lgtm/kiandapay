import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { signOut } from "./actions";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/pedidos", label: "Pedidos" },
  { href: "/admin/excecoes", label: "Exceções" },
  { href: "/admin/produtos", label: "Produtos" },
  { href: "/admin/modelos", label: "Modelos" },
  { href: "/admin/auditoria", label: "Auditoria" },
  { href: "/admin/webhooks", label: "Webhooks" },
  { href: "/admin/integracoes", label: "Integrações" },
  { href: "/admin/configuracoes", label: "Configurações" },
];

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile } = await requireAdmin();
  const nav = profile.is_platform_admin ? [...NAV, { href: "/admin/contas", label: "Contas" }] : NAV;
  const [{ count: pending }, { count: unread }] = await Promise.all([
    supabase.from("v_pending_exceptions").select("proof_id", { count: "exact", head: true }),
    supabase.from("admin_notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/admin" className="font-semibold">Painel</Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-3 py-1.5 text-gray-700 hover:bg-gray-100">
                {n.label}
                {n.href === "/admin/excecoes" && !!pending && (
                  <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white">{pending}</span>
                )}
              </Link>
            ))}
          </nav>
          <Link
            href="/admin/notificacoes"
            aria-label={unread ? `Notificações: ${unread} por ler` : "Notificações"}
            className="relative rounded-md p-1.5 text-gray-600 hover:bg-gray-100"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {!!unread && (
              <span className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[1.1rem] text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
          <form action={signOut}>
            <button className="text-sm text-gray-500 hover:text-gray-900">Sair</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
