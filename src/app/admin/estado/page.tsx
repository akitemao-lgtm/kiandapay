import { redirect } from "next/navigation";
import { AuthCard } from "@/components/ui/AuthCard";
import { buttonSecondary } from "@/components/ui/styles";
import { getAccount } from "@/lib/auth";
import { signOut } from "../(painel)/actions";

export const metadata = { title: "Estado da conta" };
export const dynamic = "force-dynamic";

export default async function EstadoPage() {
  const account = await getAccount();
  if (!account) redirect("/admin/login");
  if (account.needsMfa) redirect("/admin/mfa");
  const p = account.profile;
  if (p?.status === "active") redirect("/admin");

  const suspended = p?.status === "suspended";
  return (
    <AuthCard
      title={suspended ? "Conta suspensa" : "Conta à espera de aprovação"}
      subtitle={account.user.email ?? undefined}
    >
      <div className="space-y-3 text-sm text-gray-700">
        {suspended ? (
          <>
            <p>Esta conta foi suspensa e os seus checkouts não aceitam pedidos novos.</p>
            {p?.suspended_reason && <p className="rounded-lg bg-gray-50 px-3 py-2">Motivo: {p.suspended_reason}</p>}
            <p>Se acha que é um engano, contacte o suporte da KiandaPay.</p>
          </>
        ) : (
          <>
            <p>A sua conta foi criada. Assim que for aprovada, pode entrar e começar a criar os seus produtos.</p>
            <p>Volte a esta página mais tarde ou entre de novo.</p>
          </>
        )}
      </div>
      <form action={signOut} className="mt-6">
        <button className={`${buttonSecondary} w-full`}>Sair</button>
      </form>
    </AuthCard>
  );
}
