import type { Movement } from "./parse";

export type PaidOrder = {
  id: string;
  amount: number;
  /** Dia do pagamento (AAAA-MM-DD): data lida no comprovativo ou, sem ela, data de aprovação. */
  paidDate: string;
  transactionId: string | null;
};

export type Reconciliation = {
  matches: { orderId: string; row: number }[];
  /** Pagos quando a entrada já tinha de constar do extrato, e sem movimento correspondente. */
  missing: string[];
  /** Pagos fora do período (ou perto do fim) e sem entrada: ainda não se pode concluir nada. */
  outside: string[];
  /** Entradas de dinheiro sem pedido pago correspondente. */
  unmatchedRows: number[];
  period: { from: string; to: string } | null;
};

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Cruza pedidos pagos com entradas do extrato: mesmo valor (ao cêntimo) e data
 * até `toleranceDays` de diferença (o banco pode lançar no dia útil seguinte).
 * Se o n.º da transação do comprovativo aparecer na descrição/referência do
 * movimento, essa ligação tem prioridade. Cada movimento serve um só pedido.
 */
export function reconcile(orders: PaidOrder[], movements: Movement[], toleranceDays = 3): Reconciliation {
  if (!movements.length) {
    return { matches: [], missing: [], outside: orders.map((o) => o.id), unmatchedRows: [], period: null };
  }
  const sorted = [...movements].sort((a, b) => a.date.localeCompare(b.date));
  const period = { from: sorted[0].date, to: sorted[sorted.length - 1].date };

  // Pode haver entrada para pedidos pagos até `toleranceDays` antes do início do extrato.
  const shift = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
  const inPeriod = orders.filter((o) => o.paidDate >= shift(period.from, -toleranceDays) && o.paidDate <= period.to);
  const outside = orders.filter((o) => !inPeriod.includes(o)).map((o) => o.id);
  // Só se acusa falta quando a entrada já tinha de constar do extrato: pagos entre o início e
  // `toleranceDays` antes do fim (o banco pode lançar dias depois, ex.: fim de semana).
  const mustAppear = (o: PaidOrder) => o.paidDate >= period.from && o.paidDate <= shift(period.to, -toleranceDays);

  const candidatesOf = (o: PaidOrder) =>
    movements
      .filter((m) => Math.abs(m.amount - o.amount) < 0.005 && days(m.date, o.paidDate) <= toleranceDays)
      .map((m) => {
        const txn = o.transactionId ? digits(o.transactionId) : "";
        const text = digits(`${m.description} ${m.reference ?? ""}`);
        const txnHit = txn.length >= 5 && text.includes(txn);
        return { m, score: (txnHit ? 0 : 10) + days(m.date, o.paidDate) };
      })
      .sort((a, b) => a.score - b.score);

  // Primeiro os pedidos com menos alternativas, para não "roubarem" movimentos uns aos outros.
  const queue = inPeriod.map((o) => ({ o, c: candidatesOf(o) })).sort((a, b) => a.c.length - b.c.length);
  const used = new Set<number>();
  const matches: Reconciliation["matches"] = [];
  const missing: string[] = [];
  for (const { o, c } of queue) {
    const pick = c.find((x) => !used.has(x.m.row));
    if (pick) {
      used.add(pick.m.row);
      matches.push({ orderId: o.id, row: pick.m.row });
    } else if (mustAppear(o)) missing.push(o.id);
    else outside.push(o.id);
  }

  return {
    matches,
    missing,
    outside,
    unmatchedRows: movements.filter((m) => !used.has(m.row)).map((m) => m.row),
    period,
  };
}
