import { formatKz } from "@/lib/format";
import type { ImageAnalysis, PdfAnalysis } from "./analyze";
import type { Extracted } from "./extract";
import { paymentWindow, WINDOW_PROBLEMS, type PayableOrder } from "./receipt-checks";
import { authenticityChecks, type CheckOutcome, type TemplateRow } from "./templates";

export type DecisionInput = {
  order: { created_at: string; expires_at: string; amount_due: number };
  payment: { entity: string; reference: string };
  /**
   * Pedidos anteriores do mesmo cliente, do mesmo valor, ainda dentro do prazo de envio.
   * Quem paga e só depois abre o pedido novo está a pagar um destes.
   */
  earlier?: PayableOrder[];
  /** Momento em que o comprovativo foi enviado. */
  uploadedAt?: string;
  analysis: PdfAnalysis | ImageAnalysis;
  extracted: Extracted | null;
  template: TemplateRow | null;
  /** O mesmo ficheiro (hash) já tinha sido carregado. */
  duplicateFile: { sameOrder: boolean; otherOrderPaid: boolean } | null;
  /** O mesmo n.º de transacção já existe noutro pedido. */
  transactionReuse: { otherOrderPaid: boolean } | null;
};

export type Decision = {
  decision: "approved" | "rejected" | "exception";
  reasonCode: string | null;
  /** Texto mostrado ao lead (rejeição) ou ao administrador (exceção). */
  reason: string | null;
  fraud: boolean;
  checks: CheckOutcome[];
};

export function decide(input: DecisionInput): Decision {
  const checks: CheckOutcome[] = [];
  const add = (c: CheckOutcome) => checks.push(c);
  const { order, payment, analysis, extracted: ex, template } = input;

  // Regra 5 — ficheiro repetido
  if (input.duplicateFile) {
    const fraud = !input.duplicateFile.sameOrder && input.duplicateFile.otherOrderPaid;
    add({
      code: "file_unique", result: "fail", effect: "reject",
      message: input.duplicateFile.sameOrder ? "Ficheiro já enviado neste pedido" : "Ficheiro já usado noutro pedido",
    });
    return {
      decision: "rejected", fraud, checks, reasonCode: "duplicate_file",
      reason: input.duplicateFile.sameOrder
        ? "Este comprovativo já foi enviado. Se fez um novo pagamento, envie o comprovativo desse pagamento."
        : "Este comprovativo já foi usado noutro pedido.",
    };
  }
  add({ code: "file_unique", result: "pass", effect: "none", message: "Ficheiro nunca carregado antes" });

  // Imagens: a decisão vem da leitura do texto, que corre a seguir (image-reading.ts).
  if (analysis.kind === "image") {
    add({ code: "file_type", result: "skip", effect: "none", message: "Imagem: decidida pela leitura do texto" });
    return { decision: "exception", fraud: false, checks, reasonCode: "image", reason: "A ler o comprovativo…" };
  }
  const x = ex!;

  // Regra 1 — Entidade e Referência (deste pedido ou de um pedido anterior por pagar)
  const here: PayableOrder = {
    order_number: null, created_at: order.created_at, expires_at: order.expires_at,
    payment_entity: payment.entity, payment_reference: payment.reference,
  };
  const targets = [here, ...(input.earlier ?? [])].filter(
    (o) => o.payment_entity === x.entity && o.payment_reference.replace(/\D/g, "") === x.reference,
  );
  if (!x.entity || !x.reference) {
    add({ code: "entity_reference", result: "warn", effect: "exception", message: "Não foi possível ler a entidade e a referência" });
  } else if (!targets.length) {
    add({ code: "entity_reference", result: "fail", effect: "reject",
          message: `Entidade/referência diferentes: ${x.entity} / ${x.reference}`,
          details: { expected: payment } });
  } else if (targets.includes(here)) {
    add({ code: "entity_reference", result: "pass", effect: "none", message: "Entidade e referência corretas" });
  } else {
    add({ code: "entity_reference", result: "pass", effect: "none",
          message: `Entidade e referência do pedido anterior #${targets[0].order_number} deste cliente` });
  }

  // Regra 2 — Valor
  if (x.amount === null) {
    add({ code: "amount", result: "warn", effect: "exception", message: "Não foi possível ler o valor pago" });
  } else if (x.amount + 0.001 >= order.amount_due) {
    add({ code: "amount", result: "pass", effect: "none", message: `Valor pago ${formatKz(x.amount)}` });
  } else {
    add({ code: "amount", result: "fail", effect: "exception",
          message: `Valor pago ${formatKz(x.amount)} inferior a ${formatKz(order.amount_due)}` });
  }

  // Regra 3 — Data dentro da validade do pedido (ou do pedido anterior que está a pagar)
  if (!x.paidAt) {
    add({ code: "paid_at_window", result: "warn", effect: "exception", message: "Não foi possível ler a data do pagamento" });
  } else {
    const w = paymentWindow(x.paidAt, targets.length ? targets : [here], input.uploadedAt ?? new Date().toISOString());
    if ("problem" in w) {
      // Uma data adiantada é quase sempre um relógio mal acertado: fica para análise, não recusa.
      const effect = w.problem === "future" ? "exception" : "reject";
      add({ code: "paid_at_window", result: "fail", effect, message: WINDOW_PROBLEMS[w.problem] });
    } else if (w.order === here) {
      add({ code: "paid_at_window", result: "pass", effect: "none", message: "Pagamento dentro do prazo" });
    } else {
      add({ code: "paid_at_window", result: "pass", effect: "none",
            message: `Pagamento feito no prazo do pedido anterior #${w.order.order_number} deste cliente` });
    }
  }

  // Regra 4 — Transacção nunca usada
  if (!x.transactionId) {
    add({ code: "txn_unique", result: "warn", effect: "exception", message: "Não foi possível ler o n.º da transação" });
  } else if (input.transactionReuse) {
    add({ code: "txn_unique", result: "fail", effect: "reject", message: `Transação ${x.transactionId} já usada noutro pedido` });
  } else {
    add({ code: "txn_unique", result: "pass", effect: "none", message: `Transação ${x.transactionId} nunca usada` });
  }

  // Regra 6 — Autenticidade
  const qrMatches = (payload: string) => {
    const p = payload.replace(/\s/g, "").toUpperCase();
    return (
      (!!x.transactionId && p.includes(x.transactionId)) ||
      (!!x.reference && p.includes(x.reference)) ||
      (x.amount !== null && p.replace(/[.,]/g, "").includes(String(Math.round(x.amount))))
    );
  };
  checks.push(...authenticityChecks(analysis, x, template, qrMatches));
  if (template && !template.allows_auto_approve) {
    add({ code: "auto_approve", result: "warn", effect: "exception", message: "Modelo marcado para revisão manual" });
  }

  // Decisão
  const reject = checks.find((c) => c.effect === "reject");
  if (reject) {
    const fraud = reject.code === "txn_unique" && !!input.transactionReuse?.otherOrderPaid;
    return { decision: "rejected", fraud, checks, reasonCode: reject.code, reason: leadReason(reject.code) };
  }
  const exception = checks.find((c) => c.effect === "exception");
  if (exception) return { decision: "exception", fraud: false, checks, reasonCode: exception.code, reason: exception.message };
  return { decision: "approved", fraud: false, checks, reasonCode: null, reason: null };
}

function leadReason(code: string): string {
  switch (code) {
    case "entity_reference":
      return "A Entidade ou a Referência do comprovativo não correspondem às indicadas nesta página.";
    case "paid_at_window":
      return "A data do pagamento está fora do prazo deste pedido.";
    case "txn_unique":
      return "Este comprovativo já foi usado noutro pedido.";
    default:
      return "Não foi possível confirmar este comprovativo.";
  }
}
