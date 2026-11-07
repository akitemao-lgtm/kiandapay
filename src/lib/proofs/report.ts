import type { ProofAnalysis } from "./process";
import type { Decision } from "./decide";

/** Resumo serializável para mostrar no painel ("Testar comprovativo", Modelos). */
export type ProofReport = {
  kind: "pdf" | "image";
  error: string | null;
  meta: {
    producer: string | null;
    creator: string | null;
    pdfVersion: string | null;
    creationDate: string | null;
    modDate: string | null;
    fonts: string[];
    pageSize: [number, number] | null;
    pageCount: number | null;
    incrementalUpdates: number | null;
    qr: string[];
    signature: { present: boolean; valid: boolean; coversWholeFile: boolean; signer: string | null; error: string | null } | null;
  };
  extracted: {
    entity: string | null;
    reference: string | null;
    amount: number | null;
    paidAt: string | null;
    transactionId: string | null;
    payerName: string | null;
    bankGuess: string | null;
  } | null;
  template: { id: string; name: string } | null;
  textPreview: string;
  decision?: Pick<Decision, "decision" | "reason" | "checks">;
};

export function toReport(read: ProofAnalysis, decision?: Decision): ProofReport {
  const a = read.analysis;
  const pdf = a.kind === "pdf" ? a : null;
  const ex = read.extracted;
  return {
    kind: a.kind,
    error: read.error,
    meta: {
      producer: pdf?.producer ?? null,
      creator: pdf?.creator ?? null,
      pdfVersion: pdf?.pdfVersion ?? null,
      creationDate: pdf?.creationDate ?? null,
      modDate: pdf?.modDate ?? null,
      fonts: pdf?.fonts ?? [],
      pageSize: pdf?.pageSize ?? null,
      pageCount: pdf?.pageCount ?? null,
      incrementalUpdates: pdf?.incrementalUpdates ?? null,
      qr: a.qr,
      signature: pdf
        ? {
            present: pdf.signature.present, valid: pdf.signature.valid, coversWholeFile: pdf.signature.coversWholeFile,
            signer: pdf.signature.signer, error: pdf.signature.error,
          }
        : null,
    },
    extracted: ex
      ? {
          entity: ex.entity, reference: ex.reference, amount: ex.amount, paidAt: ex.paidAt,
          transactionId: ex.transactionId, payerName: ex.payerName, bankGuess: ex.bankGuess,
        }
      : null,
    template: read.template ? { id: read.template.id, name: read.template.name } : null,
    textPreview: pdf ? pdf.text.slice(0, 3000) : "",
    decision: decision ? { decision: decision.decision, reason: decision.reason, checks: decision.checks } : undefined,
  };
}
