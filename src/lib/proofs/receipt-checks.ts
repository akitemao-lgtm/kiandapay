import { formatKz } from "@/lib/format";
import { formatReference } from "@/lib/settings";
import { captureInstants, IMAGE_EDITOR, type ImageMeta } from "./image-meta";
import { FIELD_LABELS, LAYOUT_LABELS, type ReceiptReading } from "./receipt-text";
import type { CheckOutcome } from "./templates";

/**
 * Verificação de um comprovativo sem assinatura digital (imagem). Como nada prova
 * de onde veio o ficheiro, só é aprovado sozinho quando tudo isto se confirma:
 * modelo conhecido, operação concluída, entidade, referência e valor exatos (lidos
 * duas vezes), data e hora dentro do prazo e pagamento nunca apresentado noutro
 * pedido. Qualquer dúvida deixa a decisão para o administrador; nunca rejeita.
 */

/** Margem para relógios e para comprovativos só com minutos. */
export const CLOCK_MARGIN_MS = 2 * 60_000;

/** Um pedido que o comprovativo pode estar a pagar. */
export type PayableOrder = {
  order_number: number | null;
  created_at: string;
  expires_at: string;
  payment_entity: string;
  payment_reference: string;
};

/** Outro pedido que já tem um comprovativo deste mesmo pagamento. */
export type PaymentReuse = { orderNumber: number | null; sameTransaction: boolean } | null;

export type ReceiptContext = {
  order: PayableOrder & { amount_due: number };
  /** Pedidos anteriores do mesmo cliente, do mesmo valor, por pagar e ainda dentro do prazo de envio. */
  earlier: PayableOrder[];
  /** Momento em que o comprovativo foi enviado. */
  uploadedAt: string;
  reuse: PaymentReuse;
  /** Metadados da imagem; null quando não se aplicam (texto de um PDF). */
  capture: ImageMeta | null;
  /**
   * Outro comprovativo desta conta feito na mesma captura (mesma hora do telemóvel).
   * É assim que se apanha o mesmo ecrã enviado outra vez, cortado ou gravado de novo.
   */
  captureReuse?: { orderNumber: number | null } | null;
  /**
   * Aceitar ecrãs que não mostram a data do pagamento, usando a hora da captura.
   * Ver `allow_screenshot_time` nas Configurações.
   */
  allowCaptureTime?: boolean;
};

const digits = (s: string) => s.replace(/\D/g, "");
const list = (items: string[]) => items.join(", ").replace(/, ([^,]*)$/, " e $1");

const pass = (code: string, message: string): CheckOutcome => ({ code, result: "pass", effect: "none", message });
const info = (code: string, message: string): CheckOutcome => ({ code, result: "skip", effect: "none", message });
const fail = (code: string, message: string): CheckOutcome => ({ code, result: "fail", effect: "exception", message });
const unsure = (code: string, message: string): CheckOutcome => ({ code, result: "warn", effect: "exception", message });

/**
 * Pedidos deste cliente com a entidade e a referência do comprovativo. Quem paga e
 * depois abre um pedido novo para enviar o comprovativo pagou o pedido anterior.
 */
function payable(r: Pick<ReceiptReading, "entity" | "reference">, ctx: Pick<ReceiptContext, "order" | "earlier">): PayableOrder[] {
  return [ctx.order, ...ctx.earlier].filter(
    (o) => o.payment_entity === r.entity && digits(o.payment_reference) === r.reference,
  );
}

/** A data do pagamento cabe no prazo de um destes pedidos? Devolve o pedido, ou o motivo. */
export function paymentWindow(
  paidAt: string,
  targets: PayableOrder[],
  uploadedAt: string,
): { order: PayableOrder } | { problem: "future" | "before" | "after" } {
  const paid = Date.parse(paidAt);
  if (paid > Date.parse(uploadedAt) + CLOCK_MARGIN_MS) return { problem: "future" };
  const within = targets.find(
    (o) => paid >= Date.parse(o.created_at) - CLOCK_MARGIN_MS && paid <= Date.parse(o.expires_at) + CLOCK_MARGIN_MS,
  );
  if (within) return { order: within };
  return { problem: targets.some((o) => paid < Date.parse(o.created_at) - CLOCK_MARGIN_MS) ? "before" : "after" };
}

export const WINDOW_PROBLEMS = {
  future: "A data do pagamento é posterior ao envio do comprovativo",
  before: "Pagamento anterior à criação do pedido",
  after: "Pagamento feito depois do prazo do pedido",
};

/**
 * Ecrãs que não mostram a data do pagamento (o cliente cortou o cabeçalho). A hora
 * da captura faz as vezes dela: o ecrã foi fotografado depois de o pedido ser criado
 * e antes do envio, e essa captura nunca serviu outro pedido.
 */
function captureWindow(ctx: ReceiptContext, targets: PayableOrder[]): CheckOutcome {
  const code = "paid_at_window";
  const missing = "O comprovativo não mostra a data e a hora do pagamento, ou não se leem";
  if (!ctx.allowCaptureTime || !ctx.capture) return unsure(code, missing);
  if (ctx.captureReuse) {
    const where = ctx.captureReuse.orderNumber ? `no pedido #${ctx.captureReuse.orderNumber}` : "noutro pedido";
    return fail(code, `Esta mesma captura de ecrã já foi enviada ${where}`);
  }
  const instants = captureInstants(ctx.capture);
  if (!instants.length) return unsure(code, `${missing}, e a imagem não traz a hora em que foi feita`);
  const latest = Date.parse(ctx.uploadedAt) + CLOCK_MARGIN_MS;
  const within = targets.find((o) =>
    instants.some((t) => t >= Date.parse(o.created_at) - CLOCK_MARGIN_MS && t <= Math.min(latest, Date.parse(o.expires_at) + CLOCK_MARGIN_MS)),
  );
  const taken = ctx.capture.takenAt!.replace("T", " ").slice(0, 16);
  if (!within) return fail(code, `Sem data no comprovativo, e o ecrã foi fotografado a ${taken}, fora do prazo do pedido`);
  const where = within === ctx.order ? "" : ` (prazo do pedido anterior #${within.order_number} deste cliente)`;
  return pass(code, `Sem data no comprovativo; o ecrã foi fotografado a ${taken}, dentro do prazo${where}`);
}

function captureCheck(capture: ImageMeta, paidAt: string | null, uploadedAt: string): CheckOutcome {
  const code = "image_capture";
  if (capture.software && IMAGE_EDITOR.test(capture.software)) {
    return fail(code, `Imagem gravada por um programa de edição: ${capture.software.slice(0, 60)}`);
  }
  const instants = captureInstants(capture);
  if (!instants.length) return info(code, "A imagem não traz a hora em que foi feita");
  const taken = capture.takenAt!.replace("T", " ").slice(0, 16);
  if (!paidAt) return info(code, `Captura feita a ${taken} (hora do telemóvel)`);
  const earliest = Date.parse(paidAt) - CLOCK_MARGIN_MS;
  const latest = Date.parse(uploadedAt) + CLOCK_MARGIN_MS;
  if (instants.some((t) => t >= earliest && t <= latest)) return pass(code, `Captura feita a ${taken}, depois do pagamento`);
  return fail(
    code,
    instants.every((t) => t < earliest)
      ? `A captura (${taken}) é anterior ao pagamento que mostra: possível imagem editada`
      : `A hora da captura (${taken}) não bate certo com o pagamento nem com o envio`,
  );
}

export function receiptChecks(r: ReceiptReading, ctx: ReceiptContext): CheckOutcome[] {
  const checks: CheckOutcome[] = [];
  const { order } = ctx;
  const targets = payable(r, ctx);

  // A data do pagamento é o que prende o comprovativo a este pedido. Quando o ecrã
  // não a mostra, a hora da captura pode fazer as vezes dela (ver captureWindow).
  const window = r.paidAt
    ? null
    : captureWindow(ctx, targets.length ? targets : [order]);
  const byCapture = window?.result === "pass";

  if (!r.layout) {
    checks.push(unsure("receipt_layout", "Não é um dos modelos de comprovativo conhecidos, ou o texto não se lê bem"));
  } else {
    checks.push(pass("receipt_layout", `Modelo reconhecido: ${LAYOUT_LABELS[r.layout]}`));
    const missing = byCapture ? r.missing.filter((f) => f !== "paidAt") : r.missing;
    if (r.conflicts.length) {
      checks.push(fail("receipt_data", `O comprovativo mostra valores diferentes para ${list(r.conflicts.map((f) => FIELD_LABELS[f]))}`));
    } else if (missing.length) {
      checks.push(unsure("receipt_data", `Não foi possível ler com segurança ${list(missing.map((f) => FIELD_LABELS[f]))}`));
    } else {
      checks.push(pass("receipt_data", "Operação concluída e todos os dados lidos em leituras iguais"));
    }
  }

  if (!r.entity || !r.reference) {
    checks.push(unsure("entity_reference", "Não foi possível ler a entidade e a referência"));
  } else if (!targets.length) {
    checks.push(fail("entity_reference", `Entidade/referência diferentes: ${r.entity} / ${formatReference(r.reference)}`));
  } else if (targets.includes(order)) {
    checks.push(pass("entity_reference", "Entidade e referência corretas"));
  } else {
    checks.push(pass("entity_reference", `Entidade e referência do pedido anterior #${targets[0].order_number} deste cliente`));
  }

  if (r.amount === null) checks.push(unsure("amount", "Não foi possível ler o valor pago"));
  else if (Math.abs(r.amount - order.amount_due) < 0.005) checks.push(pass("amount", `Valor pago ${formatKz(r.amount)}`));
  else if (r.amount < order.amount_due) checks.push(fail("amount", `Valor pago ${formatKz(r.amount)} inferior a ${formatKz(order.amount_due)}`));
  else checks.push(unsure("amount", `Valor pago ${formatKz(r.amount)} superior a ${formatKz(order.amount_due)}`));

  if (window) {
    checks.push(window);
  } else if (r.paidAt) {
    const w = paymentWindow(r.paidAt, targets.length ? targets : [order], ctx.uploadedAt);
    if ("problem" in w) checks.push(fail("paid_at_window", WINDOW_PROBLEMS[w.problem]));
    else if (w.order === order) checks.push(pass("paid_at_window", "Pagamento dentro do prazo"));
    else checks.push(pass("paid_at_window", `Pagamento feito no prazo do pedido anterior #${w.order.order_number} deste cliente`));
  }

  if (ctx.reuse) {
    const where = ctx.reuse.orderNumber ? `no pedido #${ctx.reuse.orderNumber}` : "noutro pedido";
    checks.push(fail("image_repeat", ctx.reuse.sameTransaction
      ? `Este pagamento (mesmo n.º de transação) já foi apresentado ${where}`
      : `Já existe ${where} um comprovativo com a mesma data, hora e valor`));
  } else if (r.paidAt && r.amount !== null) {
    checks.push(pass("image_repeat", "Nenhum outro pedido tem um comprovativo deste pagamento"));
  } else if (byCapture) {
    // Sem data no ecrã, o que identifica o pagamento é a captura, já conferida acima.
    checks.push(pass("image_repeat", "Esta captura de ecrã não foi usada noutro pedido"));
  } else {
    checks.push(unsure("image_repeat", "Sem data e valor não se sabe se este pagamento já foi apresentado"));
  }

  if (ctx.capture) checks.push(captureCheck(ctx.capture, r.paidAt, ctx.uploadedAt));
  return checks;
}

/** Só quando nenhuma verificação levanta dúvidas. */
export function receiptApproved(checks: CheckOutcome[]): boolean {
  const done = new Set(checks.filter((c) => c.result === "pass").map((c) => c.code));
  return (
    checks.every((c) => c.effect === "none") &&
    ["receipt_layout", "receipt_data", "entity_reference", "amount", "paid_at_window", "image_repeat"].every((code) => done.has(code))
  );
}

/** Texto mostrado ao administrador nas Exceções. */
export function receiptReason(checks: CheckOutcome[]): string {
  const failed = checks.filter((c) => c.result === "fail").map((c) => c.message);
  if (failed.length) return `Imagem com diferenças: ${failed.join("; ")}`;
  const unread = checks.filter((c) => c.result === "warn").map((c) => c.message);
  if (unread.length) return `Imagem por confirmar: ${unread.join("; ")}`;
  return "Imagem lida: os dados conferem.";
}
