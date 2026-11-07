import type { CheckOutcome } from "@/lib/proofs/templates";

const CHECK_LABELS: Record<string, string> = {
  file_unique: "Ficheiro único",
  file_type: "Tipo de ficheiro",
  readable: "Leitura do PDF",
  entity_reference: "Entidade e referência",
  amount: "Valor",
  paid_at_window: "Data do pagamento",
  txn_unique: "N.º da transação único",
  digital_signature: "Assinatura digital",
  editor_software: "Software de edição",
  encrypted: "PDF protegido",
  hidden_text: "Texto escondido/sobreposto",
  template_known: "Modelo de referência",
  producer: "Produtor do PDF",
  pdf_version: "Versão do PDF",
  fonts: "Fontes",
  page_layout: "Página",
  incremental_updates: "Gravações posteriores",
  mod_date: "Datas do PDF",
  field_positions: "Posição dos campos",
  qr_match: "QR code",
  auto_approve: "Aprovação automática",
};

const ICON = {
  pass: { i: "✓", c: "bg-green-100 text-green-800" },
  fail: { i: "✕", c: "bg-red-100 text-red-800" },
  warn: { i: "!", c: "bg-amber-100 text-amber-800" },
  skip: { i: "–", c: "bg-gray-100 text-gray-500" },
};

type Check = Pick<CheckOutcome, "code" | "result" | "message">;

export function ChecksList({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y divide-gray-100">
      {checks.map((c) => (
        <li key={c.code} className="flex gap-3 py-2">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ICON[c.result].c}`}>
            {ICON[c.result].i}
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-medium">{CHECK_LABELS[c.code] ?? c.code}</p>
            <p className="break-words text-gray-600">{c.message}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
