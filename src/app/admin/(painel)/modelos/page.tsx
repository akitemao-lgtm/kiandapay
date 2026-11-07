import { ProofTester, SampleUploader } from "@/components/admin/ProofTools";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { cardClass } from "@/components/ui/styles";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { bankLabel, CHANNEL_LABELS } from "@/lib/proofs/banks";
import type { Fingerprint } from "@/lib/proofs/templates";
import { deleteTemplate, setTemplateFlag } from "./actions";

export const metadata = { title: "Modelos de comprovativos" };

type Row = {
  id: string; bank_code: string; channel: string; name: string; version: number; is_active: boolean;
  allows_auto_approve: boolean; detection: { keywords?: string[] }; fingerprint: Fingerprint; created_at: string;
};

export default async function ModelosPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("proof_templates").select("*").order("bank_code").order("version");
  const templates = (data ?? []) as Row[];

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold">Modelos de comprovativos</h1>
      <p className="mb-6 text-sm text-gray-500">
        Um comprovativo só é aprovado automaticamente se corresponder a um destes modelos. Bancos sem modelo vão sempre para Exceções.
      </p>

      <div className="space-y-6">
        <section className={cardClass}>
          <h2 className="mb-3 font-semibold">Modelos ({templates.length})</h2>
          {templates.length === 0 ? (
            <p className="text-sm text-gray-500">
              Ainda não há modelos. Carregue abaixo comprovativos verdadeiros, ou aprove um comprovativo nas Exceções e marque
              “Guardar como modelo”.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {templates.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {t.name} <span className="text-xs text-gray-400">v{t.version}</span>
                    </p>
                    <p className="text-sm text-gray-500">
                      {bankLabel(t.bank_code)} · {CHANNEL_LABELS[t.channel] ?? t.channel} · {t.fingerprint.samples} exemplo(s) ·
                      criado {formatDateTime(t.created_at)}
                    </p>
                    <p className="truncate text-xs text-gray-400">
                      {t.fingerprint.producers.filter(Boolean).join(", ") || "sem produtor"} · fontes: {t.fingerprint.fonts.join(", ") || "—"}
                      {t.detection.keywords?.length ? ` · palavras: ${t.detection.keywords.join(", ")}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <form action={setTemplateFlag.bind(null, t.id, "is_active", !t.is_active)}>
                      <button className={`rounded-lg border px-3 py-1.5 ${t.is_active ? "border-green-300 bg-green-50 text-green-800" : "border-gray-300"}`}>
                        {t.is_active ? "Ativo" : "Inativo"}
                      </button>
                    </form>
                    <form action={setTemplateFlag.bind(null, t.id, "allows_auto_approve", !t.allows_auto_approve)}>
                      <button className="rounded-lg border border-gray-300 px-3 py-1.5">
                        {t.allows_auto_approve ? "Aprovação automática" : "Só manual"}
                      </button>
                    </form>
                    <form action={deleteTemplate.bind(null, t.id)}>
                      <ConfirmButton message={`Apagar o modelo “${t.name}” e os seus exemplos? Comprovativos deste formato passam a ir para Exceções.`} className="rounded-lg px-3 py-1.5 text-red-600">
                        Apagar
                      </ConfirmButton>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <SampleUploader templates={templates.filter((t) => t.is_active).map((t) => ({ id: t.id, name: t.name }))} />
        <ProofTester />
      </div>
    </>
  );
}
