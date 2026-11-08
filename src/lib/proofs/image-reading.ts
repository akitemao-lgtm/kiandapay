import "server-only";
import { after } from "next/server";
import { createServiceClient, type ServiceDb } from "@/lib/supabase/service";
import { readImageText } from "./ocr";
import { receiptChecks, receiptReason, readReceiptText, type ReceiptOrder, type ReceiptReading } from "./receipt-image";

const BUCKET = "payment-proofs";
const OCR_CHECK = "image_ocr";

type PendingProof = {
  id: string; order_id: string; storage_path: string;
  orders: ReceiptOrder & { products: { is_active: boolean } };
};

const COLUMNS =
  "id, order_id, storage_path, orders!payment_proofs_order_id_fkey(created_at, expires_at, amount_due, payment_entity, payment_reference, products(is_active))";

async function saveChecks(db: ServiceDb, proofId: string, checks: ReturnType<typeof receiptChecks>) {
  await db.from("proof_checks").upsert(
    checks.map((c) => ({ proof_id: proofId, check_code: c.code, result: c.result, effect: c.effect, message: c.message, details: {} })),
    { onConflict: "proof_id,check_code" },
  );
}

async function isRepeated(db: ServiceDb, orderId: string, r: ReceiptReading) {
  if (!r.paidAt || r.amount === null) return false;
  const { count } = await db
    .from("payment_proofs")
    .select("id", { count: "exact", head: true })
    .eq("ext_paid_at", r.paidAt)
    .eq("ext_amount", r.amount)
    .neq("order_id", orderId)
    .neq("decision", "rejected");
  return (count ?? 0) > 0;
}

/** Só acrescenta informação: o comprovativo continua em Exceções até um administrador decidir. */
async function readProofImage(db: ServiceDb, proof: PendingProof) {
  const order = { ...proof.orders, amount_due: Number(proof.orders.amount_due) };
  try {
    const { data: file, error } = await db.storage.from(BUCKET).download(proof.storage_path);
    if (error || !file) throw error ?? new Error("Ficheiro não encontrado");
    const text = await readImageText(new Uint8Array(await file.arrayBuffer()));
    const reading = readReceiptText(text, order);
    const checks = receiptChecks(reading, order, await isRepeated(db, proof.order_id, reading));
    await saveChecks(db, proof.id, checks);
    await db
      .from("payment_proofs")
      .update({
        ext_amount: reading.amount, ext_paid_at: reading.paidAt, ext_entity: reading.entity, ext_reference: reading.reference,
        ext_raw: { ocr: text.slice(0, 2000) }, decision_reason: receiptReason(checks),
      })
      .eq("id", proof.id)
      .eq("decision", "exception");
  } catch (e) {
    console.error("[comprovativo] leitura da imagem", proof.id, e);
    await saveChecks(db, proof.id, [{ code: OCR_CHECK, result: "warn", effect: "exception", message: "Não foi possível ler o texto da imagem" }]);
  }
}

/** Depois de responder ao cliente, para o envio não ficar mais lento. */
export function scheduleImageReading(proofId: string) {
  const run = async () => {
    const db = createServiceClient();
    const { data } = await db.from("payment_proofs").select(COLUMNS).eq("id", proofId).eq("decision", "exception").maybeSingle();
    const proof = data as unknown as PendingProof | null;
    if (proof?.orders.products.is_active) await readProofImage(db, proof);
  };
  try {
    after(() => run().catch((e) => console.error("[comprovativo] leitura da imagem", e)));
  } catch {
    void run();
  }
}

/** Cron: imagens em Exceções ainda por ler (ex.: o servidor reiniciou a meio). */
export async function readPendingImages(db: ServiceDb, limit = 2): Promise<number> {
  const { data } = await db
    .from("payment_proofs")
    .select(COLUMNS)
    .eq("kind", "image")
    .eq("decision", "exception")
    .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  const proofs = ((data ?? []) as unknown as PendingProof[]).filter((p) => p.orders.products.is_active);
  if (!proofs.length) return 0;
  const { data: done } = await db.from("proof_checks").select("proof_id").eq("check_code", OCR_CHECK).in("proof_id", proofs.map((p) => p.id));
  const read = new Set((done ?? []).map((c: { proof_id: string }) => c.proof_id));
  const pending = proofs.filter((p) => !read.has(p.id)).slice(0, limit);
  for (const proof of pending) await readProofImage(db, proof);
  return pending.length;
}
