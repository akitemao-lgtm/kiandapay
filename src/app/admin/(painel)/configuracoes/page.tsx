import Link from "next/link";
import { PaymentReferences } from "@/components/admin/PaymentReferences";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { buttonSecondary, cardClass, hintClass } from "@/components/ui/styles";
import { requireAdmin } from "@/lib/auth";
import { listReferences } from "@/lib/payments/references";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  const { supabase, user, profile } = await requireAdmin();
  const [settings, { data: legal }, { refs, available }, { data: factors }] = await Promise.all([
    getSettings(supabase, user.id),
    supabase.from("legal_pages").select("slug, title, body_md").order("slug"),
    listReferences(supabase),
    supabase.auth.mfa.listFactors(),
  ]);
  const hasMfa = !!factors?.totp.some((f) => f.status === "verified");
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Configurações</h1>
      {available && (
        <div className="mb-6">
          <PaymentReferences refs={refs} />
        </div>
      )}
      <section className={`${cardClass} mb-6 space-y-3`}>
        <div>
          <h2 className="font-semibold">Segurança da conta</h2>
          <p className={hintClass}>
            {user.email} · {profile.display_name || "sem nome"}
          </p>
        </div>
        {hasMfa ? (
          <p className="text-sm text-green-700">Verificação em dois passos (2FA) ativada.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-gray-700">
              A verificação em dois passos (2FA) está desligada. Ative-a para que ninguém consiga trocar a sua
              referência de pagamento só com a palavra-passe.
            </p>
            <Link href="/admin/mfa?ativar=1" className={buttonSecondary}>Ativar 2FA</Link>
          </div>
        )}
      </section>
      <SettingsForm settings={settings} legal={legal ?? []} showPaymentFields={!available} />
    </>
  );
}
