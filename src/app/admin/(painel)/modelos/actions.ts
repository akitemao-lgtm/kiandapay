"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import type { ActionResult } from "@/lib/products/types";
import { decide } from "@/lib/proofs/decide";
import { readProof, sniffFile } from "@/lib/proofs/process";
import { toReport, type ProofReport } from "@/lib/proofs/report";
import { saveTemplateSample, TEMPLATE_BUCKET, type TemplateTarget } from "@/lib/proofs/template-admin";
import { getSettings } from "@/lib/settings";

const PATH = /^(uploads|tests)\/[0-9a-f-]{36}\.pdf$/;

type Db = Awaited<ReturnType<typeof requireAdmin>>["supabase"];

async function download(db: Db, path: string): Promise<Uint8Array | null> {
  if (!PATH.test(path)) return null;
  const { data } = await db.storage.from(TEMPLATE_BUCKET).download(path);
  if (!data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  return sniffFile(bytes)?.kind === "pdf" ? bytes : null;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Lê um comprovativo carregado para servir de modelo e mostra o que foi extraído. */
export async function analyzeSample(path: string): Promise<Result<ProofReport>> {
  const { supabase, user } = await requireAdmin();
  const bytes = await download(supabase, path);
  if (!bytes) return { ok: false, error: "Ficheiro inválido. Carregue o PDF original." };
  const read = await readProof(supabase, bytes, "pdf", user.id);
  if (read.error) return { ok: false, error: read.error };
  return { ok: true, data: toReport(read) };
}

const targetSchema = z.union([
  z.object({ templateId: z.string().uuid() }),
  z.object({
    bankCode: z.string().regex(/^[a-z_]{2,30}$/),
    channel: z.enum(["app", "express", "atm", "internet_banking", "outro"]),
    name: z.string().trim().min(2).max(80),
    keywords: z.array(z.string().trim().min(2).max(60)).max(8),
  }),
]);

export async function saveSample(path: string, target: TemplateTarget): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin();
  const t = targetSchema.safeParse(target);
  if (!t.success) return { ok: false, error: "Preencha os dados do modelo." };
  const bytes = await download(supabase, path);
  if (!bytes) return { ok: false, error: "Ficheiro inválido." };
  const read = await readProof(supabase, bytes, "pdf", user.id);
  if (read.error || read.analysis.kind !== "pdf" || !read.extracted) return { ok: false, error: read.error ?? "PDF ilegível." };
  const saved = await saveTemplateSample(supabase, { analysis: read.analysis, extracted: read.extracted, bytes, target: t.data });
  await supabase.storage.from(TEMPLATE_BUCKET).remove([path]);
  if (!saved.ok) return saved;
  revalidatePath("/admin/modelos");
  return { ok: true, message: "Modelo guardado. Comprovativos neste formato passam a ser verificados contra ele." };
}

/**
 * "Testar comprovativo": corre todas as verificações como se fosse um pedido
 * real criado 1 minuto antes do pagamento, com o valor indicado.
 */
export async function testProof(path: string, amount: number | null): Promise<Result<ProofReport>> {
  const { supabase, user } = await requireAdmin();
  const bytes = await download(supabase, path);
  await supabase.storage.from(TEMPLATE_BUCKET).remove([path]);
  if (!bytes) return { ok: false, error: "Ficheiro inválido. Carregue o PDF original." };

  const settings = await getSettings(supabase, user.id);
  const read = await readProof(supabase, bytes, "pdf", user.id);
  if (read.error) return { ok: true, data: toReport(read) };
  const ex = read.extracted!;
  const paid = ex.paidAt ? new Date(ex.paidAt).getTime() : Date.now();
  const created = new Date(paid - 60_000);

  const sha = createHash("sha256").update(bytes).digest("hex");
  const { data: dup } = await supabase.from("payment_proofs").select("order_id").eq("file_sha256", sha).limit(1);
  const { data: reuse } = ex.transactionId
    ? await supabase.from("payment_proofs").select("order_id").eq("ext_transaction_id", ex.transactionId).in("decision", ["approved", "exception", "pending"]).limit(1)
    : { data: [] };

  const decision = decide({
    order: {
      created_at: created.toISOString(),
      expires_at: new Date(created.getTime() + settings.order_ttl_minutes * 60_000).toISOString(),
      amount_due: amount ?? ex.amount ?? 0,
    },
    payment: { entity: settings.payment_entity, reference: settings.payment_reference },
    analysis: read.analysis,
    extracted: ex,
    template: read.template,
    duplicateFile: dup?.length ? { sameOrder: false, otherOrderPaid: false } : null,
    transactionReuse: reuse?.length ? { otherOrderPaid: false } : null,
  });
  return { ok: true, data: toReport(read, decision) };
}

export async function setTemplateFlag(id: string, field: "is_active" | "allows_auto_approve", value: boolean): Promise<void> {
  const { supabase } = await requireAdmin();
  if (!z.string().uuid().safeParse(id).success) return;
  await supabase.from("proof_templates").update({ [field]: value }).eq("id", id);
  revalidatePath("/admin/modelos");
}

export async function deleteTemplate(id: string): Promise<void> {
  const { supabase } = await requireAdmin();
  if (!z.string().uuid().safeParse(id).success) return;
  const { data: samples } = await supabase.from("proof_template_samples").select("storage_path").eq("template_id", id);
  if (samples?.length) await supabase.storage.from(TEMPLATE_BUCKET).remove(samples.map((s) => s.storage_path));
  await supabase.from("proof_template_samples").delete().eq("template_id", id);
  await supabase.from("proof_templates").delete().eq("id", id);
  revalidatePath("/admin/modelos");
}
