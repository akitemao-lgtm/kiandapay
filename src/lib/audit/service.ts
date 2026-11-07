import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzePdf } from "@/lib/proofs/analyze";
import { parseCsv, parseXlsx, pdfLinesToTable, toMovements, type Mapping, type StatementTable } from "./parse";
import { reconcile, type PaidOrder } from "./reconcile";

export const STATEMENT_BUCKET = "statements";
export const STATEMENT_PATH = /^[0-9a-f-]{36}\.(csv|xlsx|pdf)$/;

export type FileFormat = "csv" | "xlsx" | "pdf";

/** Dia em Angola (UTC+1) de um instante ISO. */
export function luandaDate(iso: string): string {
  return new Date(Date.parse(iso) + 3_600_000).toISOString().slice(0, 10);
}

export async function readStatement(db: SupabaseClient, path: string): Promise<{ format: FileFormat; table: StatementTable } | { error: string }> {
  if (!STATEMENT_PATH.test(path)) return { error: "Ficheiro inválido." };
  const { data } = await db.storage.from(STATEMENT_BUCKET).download(path);
  if (!data) return { error: "Não foi possível ler o ficheiro." };
  const bytes = new Uint8Array(await data.arrayBuffer());
  const format = path.split(".").pop() as FileFormat;
  try {
    if (format === "csv") {
      // Os bancos exportam em UTF-8 ou em Latin-1; se aparecerem caracteres inválidos, tenta Latin-1.
      let text = new TextDecoder("utf-8").decode(bytes);
      if (text.includes("�")) text = new TextDecoder("latin1").decode(bytes);
      return { format, table: parseCsv(text) };
    }
    if (format === "xlsx") {
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { error: "Ficheiro Excel antigo (.xls). Guarde-o como .xlsx ou CSV." };
      return { format, table: await parseXlsx(bytes) };
    }
    const analysis = await analyzePdf(bytes);
    return { format, table: pdfLinesToTable(analysis.lines) };
  } catch (e) {
    console.error("[auditoria] leitura", e);
    return { error: "Não foi possível interpretar o ficheiro." };
  }
}

export type OrderBrief = {
  id: string;
  order_number: number;
  customer_name: string;
  customer_phone: string;
  amount: number;
  paidDate: string;
};

export type ImportResult = {
  importId: string;
  period: { from: string; to: string } | null;
  credits: number;
  matched: OrderBrief[];
  missing: OrderBrief[];
  outside: number;
  unmatched: { date: string; amount: number; description: string; candidates: { id: string; order_number: number; customer_name: string; status: string }[] }[];
};

type OrderRow = {
  id: string; order_number: number; customer_name: string; customer_phone: string; amount_due: number;
  paid_at: string; payment_proofs: { ext_paid_at: string | null; ext_transaction_id: string | null } | null;
};

export async function runImport(db: SupabaseClient, path: string, format: FileFormat, table: StatementTable, mapping: Mapping): Promise<ImportResult | { error: string }> {
  const movements = toMovements(table, mapping);
  if (!movements.length) return { error: "Nenhuma entrada de dinheiro encontrada com estas colunas. Confirme a data e o valor." };

  const dates = movements.map((m) => m.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];

  // Pedidos pagos à volta do período (a data do comprovativo pode diferir da aprovação).
  const { data: rows } = await db
    .from("orders")
    .select("id, order_number, customer_name, customer_phone, amount_due, paid_at, payment_proofs!orders_approved_proof_fk(ext_paid_at, ext_transaction_id)")
    .eq("status", "paid")
    .gte("paid_at", new Date(Date.parse(from) - 7 * 86_400_000).toISOString())
    .lte("paid_at", new Date(Date.parse(to) + 8 * 86_400_000).toISOString());
  const orders = ((rows ?? []) as unknown as OrderRow[]).map((o) => ({
    ...o,
    amount: Number(o.amount_due),
    paidDate: luandaDate(o.payment_proofs?.ext_paid_at ?? o.paid_at),
  }));

  const r = reconcile(
    orders.map((o): PaidOrder => ({ id: o.id, amount: o.amount, paidDate: o.paidDate, transactionId: o.payment_proofs?.ext_transaction_id ?? null })),
    movements,
  );

  const { data: imp, error } = await db
    .from("bank_statement_imports")
    .insert({
      storage_path: path, file_format: format, period_start: from, period_end: to,
      line_count: movements.length, matched_count: r.matches.length, missing_count: r.missing.length, status: "done",
    })
    .select("id")
    .single();
  if (error || !imp) return { error: "Não foi possível registar a importação." };

  const matchedBy = new Map(r.matches.map((m) => [m.row, m.orderId]));
  await db.from("bank_statement_lines").insert(
    movements.map((m) => ({
      import_id: imp.id,
      booked_at: `${m.date}T12:00:00+01:00`,
      amount: m.amount,
      description: m.description || null,
      reference: m.reference,
      matched_order_id: matchedBy.get(m.row) ?? null,
      raw: Object.fromEntries(table.headers.map((h, i) => [h, m.raw[i] ?? ""])),
    })),
  );

  const now = new Date().toISOString();
  if (r.matches.length) {
    await db.from("orders").update({ reconciliation: "matched", reconciled_import_id: imp.id, reconciled_at: now })
      .in("id", r.matches.map((m) => m.orderId));
  }
  if (r.missing.length) {
    await db.from("orders").update({ reconciliation: "missing", reconciled_import_id: imp.id, reconciled_at: now })
      .in("id", r.missing);
    await db.from("admin_notifications").insert({
      type: "reconciliation",
      title: `Auditoria: ${r.missing.length} pedido(s) pago(s) sem pagamento no extrato (${from} a ${to})`,
    });
  }

  // Entradas sem pedido: sugerir pedidos ainda não pagos com o mesmo valor (pagou e não enviou comprovativo?).
  const unmatchedMov = movements.filter((m) => r.unmatchedRows.includes(m.row));
  const amounts = [...new Set(unmatchedMov.map((m) => m.amount))];
  const { data: pending } = amounts.length
    ? await db.from("orders").select("id, order_number, customer_name, status, amount_due")
        .in("status", ["awaiting_payment", "under_review", "expired"]).in("amount_due", amounts)
        .gte("created_at", new Date(Date.parse(from) - 3 * 86_400_000).toISOString()).limit(200)
    : { data: [] };

  const brief = (id: string): OrderBrief => {
    const o = orders.find((x) => x.id === id)!;
    return { id, order_number: o.order_number, customer_name: o.customer_name, customer_phone: o.customer_phone, amount: o.amount, paidDate: o.paidDate };
  };
  return {
    importId: imp.id,
    period: r.period,
    credits: movements.length,
    matched: r.matches.map((m) => brief(m.orderId)),
    missing: r.missing.map(brief),
    outside: r.outside.length,
    unmatched: unmatchedMov.map((m) => ({
      date: m.date,
      amount: m.amount,
      description: m.description,
      candidates: (pending ?? [])
        .filter((p: { amount_due: number }) => Math.abs(Number(p.amount_due) - m.amount) < 0.005)
        .map((p: { id: string; order_number: number; customer_name: string; status: string }) => ({
          id: p.id, order_number: p.order_number, customer_name: p.customer_name, status: p.status,
        })),
    })),
  };
}
