import { formatKz } from "@/lib/format";
import { parseDateTime, parseMoney } from "./extract";
import type { CheckOutcome } from "./templates";

/**
 * Leitura do texto de um comprovativo em imagem. Nos ecrãs do Multicaixa o valor
 * aparece por cima do rótulo, e o OCR pode trocar caracteres, por isso procura-se
 * primeiro o valor esperado e só depois o que estiver junto do rótulo.
 */
export type ReceiptOrder = {
  created_at: string;
  expires_at: string;
  amount_due: number;
  payment_entity: string;
  payment_reference: string;
};

export type ReceiptReading = { entity: string | null; reference: string | null; amount: number | null; paidAt: string | null };

const CLOCK_MARGIN_MS = 2 * 60_000;
const NOT_AMOUNT = /saldo|taxa|comiss|limite|dispon/i;
const AMOUNT_LABEL = /montante|valor|import[aâ]ncia|quantia|total/i;
const MONEY = /\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g;

const digits = (s: string) => s.replace(/\D/g, "");

/** A linha do rótulo e as vizinhas. */
function nearLabel(lines: string[], label: RegExp): string[] {
  const out = new Set<string>();
  lines.forEach((line, i) => {
    if (label.test(line)) [line, lines[i - 1], lines[i + 1]].forEach((l) => l && out.add(l));
  });
  return [...out];
}

function pick(text: string, lines: string[], pattern: RegExp, label: RegExp, expected: string): string | null {
  const found = (s: string) => [...s.matchAll(pattern)].map((m) => digits(m[0]));
  if (found(text).includes(expected)) return expected;
  return nearLabel(lines, label).flatMap(found)[0] ?? null;
}

function readAmount(lines: string[], due: number): number | null {
  const usable = lines.filter((l) => !NOT_AMOUNT.test(l));
  const withCurrency = usable.filter((l) => /\b(kz|aoa)\b/i.test(l));
  const nearby = nearLabel(usable, AMOUNT_LABEL);
  const values = [...withCurrency, ...nearby]
    .flatMap((l) => l.match(MONEY) ?? [])
    .filter((v) => digits(v).length < 9 || /[.,]\d{1,2}$/.test(v)) // referências e contas não são valores
    .map(parseMoney)
    .filter((n): n is number => n !== null && n > 0);
  return values.find((n) => Math.abs(n - due) < 0.005) ?? values[0] ?? null;
}

export function readReceiptText(text: string, order: Pick<ReceiptOrder, "amount_due" | "payment_entity" | "payment_reference">): ReceiptReading {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    entity: pick(text, lines, /(?<!\d)\d{5}(?!\d)/g, /entidade/i, order.payment_entity),
    reference: pick(text, lines, /(?<!\d)\d{3}[ .]?\d{3}[ .]?\d{3}(?!\d)/g, /refer[eê]ncia/i, digits(order.payment_reference)),
    amount: readAmount(lines, order.amount_due),
    paidAt: parseDateTime(text),
  };
}

/** Numa imagem nada prova a origem do ficheiro: estas verificações só ajudam a decidir, nunca aprovam nem rejeitam. */
export function receiptChecks(r: ReceiptReading, order: ReceiptOrder, repeated: boolean): CheckOutcome[] {
  const ok = (code: string, message: string): CheckOutcome => ({ code, result: "pass", effect: "none", message });
  const fail = (code: string, message: string): CheckOutcome => ({ code, result: "fail", effect: "exception", message });
  const unread = (code: string, message: string): CheckOutcome => ({ code, result: "warn", effect: "exception", message });
  const checks: CheckOutcome[] = [ok("image_ocr", "Texto da imagem lido")];

  if (!r.entity || !r.reference) checks.push(unread("entity_reference", "Não foi possível ler a entidade e a referência"));
  else if (r.entity === order.payment_entity && r.reference === digits(order.payment_reference)) checks.push(ok("entity_reference", "Entidade e referência corretas"));
  else checks.push(fail("entity_reference", `Entidade/referência diferentes: ${r.entity} / ${r.reference}`));

  if (r.amount === null) checks.push(unread("amount", "Não foi possível ler o valor pago"));
  else if (r.amount + 0.001 >= order.amount_due) checks.push(ok("amount", `Valor pago ${formatKz(r.amount)}`));
  else checks.push(fail("amount", `Valor pago ${formatKz(r.amount)} inferior a ${formatKz(order.amount_due)}`));

  if (!r.paidAt) checks.push(unread("paid_at_window", "Não foi possível ler a data do pagamento"));
  else {
    const paid = new Date(r.paidAt).getTime();
    if (paid < new Date(order.created_at).getTime() - CLOCK_MARGIN_MS) checks.push(fail("paid_at_window", "Pagamento anterior à criação do pedido"));
    else if (paid > new Date(order.expires_at).getTime() + CLOCK_MARGIN_MS) checks.push(fail("paid_at_window", "Pagamento feito depois do prazo do pedido"));
    else checks.push(ok("paid_at_window", "Pagamento dentro do prazo"));
  }

  checks.push(repeated
    ? fail("image_repeat", "Já existe outro comprovativo com a mesma data, hora e valor")
    : ok("image_repeat", "Nenhum outro comprovativo com a mesma data, hora e valor"));
  return checks;
}

/** Texto mostrado ao administrador nas Exceções. */
export function receiptReason(checks: CheckOutcome[]): string {
  const failed = checks.filter((c) => c.result === "fail").map((c) => c.message);
  if (failed.length) return `Imagem com diferenças: ${failed.join("; ")}`;
  const unread = checks.filter((c) => c.result === "warn").map((c) => c.message);
  if (unread.length) return `Imagem lida em parte: ${unread.join("; ")}`;
  return "Imagem lida: os dados conferem. Confirme a entrada do dinheiro antes de aprovar.";
}
