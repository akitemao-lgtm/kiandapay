"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { suggestMapping, type Mapping } from "@/lib/audit/parse";
import { readStatement, runImport, type ImportResult } from "@/lib/audit/service";
import type { ActionResult } from "@/lib/products/types";
import { kickWebhooks } from "@/lib/webhooks/dispatch";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type Preview = { format: string; headers: string[]; rows: string[][]; total: number; suggested: Mapping };

export async function previewStatement(path: string): Promise<Result<Preview>> {
  const { supabase } = await requireAdmin();
  const r = await readStatement(supabase, path);
  if ("error" in r) return { ok: false, error: r.error };
  if (!r.table.rows.length) return { ok: false, error: "O ficheiro não tem linhas de movimentos." };
  return {
    ok: true,
    data: { format: r.format, headers: r.table.headers, rows: r.table.rows.slice(0, 12), total: r.table.rows.length, suggested: suggestMapping(r.table) },
  };
}

const col = z.number().int().min(0).max(200);
const mappingSchema = z.object({
  date: col,
  amount: col,
  description: col.nullable(),
  reference: col.nullable(),
  amountMode: z.enum(["signed", "credit"]),
});

export async function importStatement(path: string, mapping: Mapping): Promise<Result<ImportResult>> {
  const { supabase } = await requireAdmin();
  const m = mappingSchema.safeParse(mapping);
  if (!m.success) return { ok: false, error: "Escolha as colunas da data e do valor." };
  const read = await readStatement(supabase, path);
  if ("error" in read) return { ok: false, error: read.error };
  const result = await runImport(supabase, path, read.format, read.table, m.data);
  if ("error" in result) return { ok: false, error: result.error };
  revalidatePath("/admin/auditoria");
  return { ok: true, data: result };
}

const ids = z.array(z.string().uuid()).min(1).max(500);

/** Pagamento não encontrado no extrato: retira o acesso, marca o comprovativo e bloqueia o número. */
export async function markAsFraud(orderIds: string[]): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const parsed = ids.safeParse(orderIds);
  if (!parsed.success) return { ok: false, error: "Nada selecionado." };
  const { data: orders } = await supabase
    .from("orders")
    .select("id, lead_id, approved_proof_id")
    .in("id", parsed.data)
    .eq("status", "paid");
  if (!orders?.length) return { ok: false, error: "Estes pedidos já não estão pagos." };
  const now = new Date().toISOString();
  const reason = "Pagamento não encontrado no extrato bancário.";
  await supabase.from("orders").update({ status: "rejected", rejected_reason: reason }).in("id", orders.map((o) => o.id));
  await supabase.from("leads").update({ blocked_at: now, blocked_reason: `Fraude (auditoria): ${reason}` }).in("id", orders.map((o) => o.lead_id));
  const proofs = orders.map((o) => o.approved_proof_id).filter(Boolean) as string[];
  if (proofs.length) await supabase.from("payment_proofs").update({ fraud_suspected: true }).in("id", proofs);
  kickWebhooks();
  revalidatePath("/admin/auditoria");
  return { ok: true, message: `${orders.length} pedido(s) marcado(s) como fraude: acesso retirado e número bloqueado.` };
}

/** O pagamento existe (ex.: entrou noutra conta ou noutro extrato). */
export async function markAsFound(orderId: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  if (!z.string().uuid().safeParse(orderId).success) return { ok: false, error: "Pedido inválido." };
  await supabase.from("orders").update({ reconciliation: "matched", reconciled_at: new Date().toISOString() }).eq("id", orderId);
  revalidatePath("/admin/auditoria");
  return { ok: true, message: "Marcado como confirmado." };
}
