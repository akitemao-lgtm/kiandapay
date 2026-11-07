import { ChecksList } from "@/components/admin/ChecksList";
import { formatDateTime, formatKz } from "@/lib/format";
import { bankLabel } from "@/lib/proofs/banks";
import type { ProofReport } from "@/lib/proofs/report";
import { formatReference } from "@/lib/settings";

const VERDICT = {
  approved: { text: "Aprovaria automaticamente", c: "bg-green-50 text-green-800" },
  exception: { text: "Iria para Exceções", c: "bg-amber-50 text-amber-900" },
  rejected: { text: "Rejeitaria", c: "bg-red-50 text-red-800" },
};

export function ReportView({ report }: { report: ProofReport }) {
  const ex = report.extracted;
  const m = report.meta;
  const rows: [string, string | null][] = ex
    ? [
        ["Banco/app", report.template?.name ?? bankLabel(ex.bankGuess)],
        ["Valor", ex.amount !== null ? formatKz(ex.amount) : null],
        ["Data/hora", ex.paidAt ? formatDateTime(ex.paidAt) : null],
        ["Entidade", ex.entity],
        ["Referência", ex.reference ? formatReference(ex.reference) : null],
        ["N.º transação", ex.transactionId],
        ["Ordenante", ex.payerName],
      ]
    : [];
  return (
    <div className="space-y-4 text-sm">
      {report.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">{report.error}</p>}
      {report.decision && (
        <div className={`rounded-xl px-4 py-3 ${VERDICT[report.decision.decision].c}`}>
          <p className="font-semibold">{VERDICT[report.decision.decision].text}</p>
          {report.decision.reason && <p>{report.decision.reason}</p>}
        </div>
      )}
      {ex && (
        <div>
          <h3 className="mb-1 font-semibold">Dados extraídos</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-gray-500">{k}</dt>
                <dd className={v ? "font-medium" : "text-gray-400"}>{v ?? "não encontrado"}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div>
        <h3 className="mb-1 font-semibold">Ficheiro</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-gray-500">Produtor</dt><dd className="break-all">{m.producer ?? "—"}</dd>
          <dt className="text-gray-500">Criador</dt><dd className="break-all">{m.creator ?? "—"}</dd>
          <dt className="text-gray-500">Versão</dt><dd>{m.pdfVersion ?? "—"}</dd>
          <dt className="text-gray-500">Criado / alterado</dt>
          <dd>{m.creationDate ? formatDateTime(m.creationDate) : "—"} / {m.modDate ? formatDateTime(m.modDate) : "—"}</dd>
          <dt className="text-gray-500">Página</dt><dd>{m.pageSize?.join(" × ") ?? "—"} pt · {m.pageCount ?? "—"} pág.</dd>
          <dt className="text-gray-500">Gravações extra</dt><dd>{m.incrementalUpdates ?? "—"}</dd>
          <dt className="text-gray-500">Fontes</dt><dd className="break-words">{m.fonts.join(", ") || "—"}</dd>
          <dt className="text-gray-500">Assinatura digital</dt>
          <dd className="break-words">
            {!m.signature?.present
              ? "sem assinatura"
              : m.signature.valid && m.signature.coversWholeFile
                ? `válida — ${m.signature.signer}`
                : `INVÁLIDA${m.signature.error ? ` (${m.signature.error})` : ""}`}
          </dd>
          <dt className="text-gray-500">QR code</dt><dd className="break-all">{m.qr[0] ?? "não encontrado"}</dd>
        </dl>
      </div>
      {report.decision && (
        <div>
          <h3 className="mb-1 font-semibold">Verificações</h3>
          <ChecksList checks={report.decision.checks} />
        </div>
      )}
      {report.textPreview && (
        <details>
          <summary className="cursor-pointer text-gray-600">Texto lido do PDF</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs">{report.textPreview}</pre>
        </details>
      )}
    </div>
  );
}
