import "server-only";
import { after } from "next/server";
import { queueAdminMessage, queuePaidMessage } from "@/lib/messaging/queue";
import { markOrderPaid } from "@/lib/orders/paid";
import { getSettings, type Settings } from "@/lib/settings";
import { siteUrl } from "@/lib/site";
import { createServiceClient, type ServiceDb } from "@/lib/supabase/service";
import { readImageTexts } from "./ocr";
import { receiptApproved, receiptChecks, receiptReason } from "./receipt-checks";
import { buildReceiptContext, type ProofOrder } from "./receipt-context";
import { readReceiptText, type ReceiptLayout } from "./receipt-text";
import type { CheckOutcome } from "./templates";

const BUCKET = "payment-proofs";
const OCR_CHECK = "image_ocr";
/** Um dado só conta quando duas leituras do OCR o dizem igual. */
const QUORUM = 2;

const BANK_BY_LAYOUT: Record<ReceiptLayout, string> = {
  express_success: "mcx_express",
  express_detail: "mcx_express",
  express_pdf: "mcx_express",
  bai_directo: "bai",
};

type PendingProof = {
  id: string;
  order_id: string;
  storage_path: string;
  created_at: string;
  orders: ProofOrder & { status: string; customer_name: string; product_name: string; products: { is_active: boolean } | null };
};

const ORDER_COLUMNS =
  "id, order_number, status, lead_id, owner_id, amount_due, payment_entity, payment_reference, " +
  "created_at, expires_at, customer_name, product_name";
const COLUMNS = `id, order_id, storage_path, created_at, orders!payment_proofs_order_id_fkey(${ORDER_COLUMNS}, products(is_active))`;
/** "!inner" é o que faz a condição do produto activo excluir a linha, em vez de a devolver sem produto. */
const COLUMNS_ACTIVE = `id, order_id, storage_path, created_at, orders!payment_proofs_order_id_fkey!inner(${ORDER_COLUMNS}, products!inner(is_active))`;

async function saveChecks(db: ServiceDb, proofId: string, checks: CheckOutcome[]) {
  await db.from("proof_checks").upsert(
    checks.map((c) => ({ proof_id: proofId, check_code: c.code, result: c.result, effect: c.effect, message: c.message, details: c.details ?? {} })),
    { onConflict: "proof_id,check_code" },
  );
}

/**
 * Lê a imagem e decide. Aprova apenas quando todas as verificações passam; em qualquer
 * outro caso fica em Exceções com o que foi lido, para o administrador decidir. Uma
 * imagem nunca rejeita sozinha: um erro de leitura não pode recusar quem pagou.
 */
async function readProofImage(db: ServiceDb, proof: PendingProof, settings: Settings) {
  const order: ProofOrder = { ...proof.orders, amount_due: Number(proof.orders.amount_due) };
  let bytes: Uint8Array | null = null;
  try {
    const { data: file, error: downloadError } = await db.storage.from(BUCKET).download(proof.storage_path);
    if (downloadError || !file) throw downloadError ?? new Error("Ficheiro não encontrado");
    bytes = new Uint8Array(await file.arrayBuffer());
    // Com duas leituras a concordarem em tudo, a terceira não muda a decisão.
    const texts = await readImageTexts(bytes, (so_far) => {
      const r = readReceiptText(so_far);
      return r.layout !== null && r.success && !r.conflicts.length && !r.missing.length;
    });
    const reading = readReceiptText(texts, QUORUM);
    const ctx = await buildReceiptContext(db, { order, settings, reading, bytes, uploadedAt: proof.created_at });
    const checks = [
      { code: OCR_CHECK, result: "pass", effect: "none", message: "Texto da imagem lido" } as CheckOutcome,
      ...receiptChecks(reading, ctx),
    ];
    await saveChecks(db, proof.id, checks);

    const read = {
      ext_amount: reading.amount,
      ext_paid_at: reading.paidAt,
      ext_entity: reading.entity,
      ext_reference: reading.reference,
      ext_transaction_id: reading.transactionId,
      capture_taken_at: ctx.capture?.takenAt ?? null,
      bank_code: reading.layout ? BANK_BY_LAYOUT[reading.layout] : null,
    };
    let reason = receiptApproved(checks) ? null : receiptReason(checks);

    if (reason === null) {
      const { error: approveError } = await db
        .from("payment_proofs")
        .update({ ...read, decision: "approved", decision_source: "auto", decision_reason: null, decision_reason_code: null, decided_at: new Date().toISOString() })
        .eq("id", proof.id)
        .eq("decision", "exception");
      if (!approveError) {
        await approve(db, settings, proof);
        return;
      }
      // 23505: este pagamento foi aprovado noutro pedido entretanto. Fica para análise.
      console.error("[comprovativo] aprovar imagem", proof.id, approveError);
      reason = approveError.code === "23505"
        ? "Este pagamento foi aprovado noutro pedido em simultâneo"
        : "Erro ao gravar a aprovação: confirmar manualmente";
    }

    const { error } = await db.from("payment_proofs").update({ ...read, decision_reason: reason }).eq("id", proof.id).eq("decision", "exception");
    if (error) console.error("[comprovativo] gravar leitura", proof.id, error);
    await notifyException(db, settings, proof, reason);
  } catch (e) {
    console.error("[comprovativo] leitura da imagem", proof.id, e);
    const message = "Não foi possível ler o texto da imagem";
    await saveChecks(db, proof.id, [{ code: OCR_CHECK, result: "warn", effect: "exception", message }]);
    await notifyException(db, settings, proof, message);
  }
}

/** O pedido fica pago e o cliente é avisado: já não está à espera de ninguém. */
async function approve(db: ServiceDb, settings: Settings, proof: PendingProof) {
  if (!(await markOrderPaid(db, settings, proof.order_id, proof.id, "auto"))) return;
  const { data: contact } = await db
    .from("orders")
    .select("id, order_number, public_token, customer_phone, customer_email")
    .eq("id", proof.order_id)
    .single();
  // O cliente chegou a ver "em análise" na página do pedido, por isso vale a pena avisá-lo.
  if (contact) await queuePaidMessage(db, contact, settings);
}

/**
 * Avisa o administrador de um comprovativo que ficou para análise. Só uma vez por
 * comprovativo: a leitura pode correr outra vez pelo cron depois de o servidor reiniciar.
 */
export async function notifyException(
  db: ServiceDb,
  settings: Settings,
  proof: { id: string; order_id: string; orders: { order_number: number; customer_name: string; product_name: string } },
  reason: string,
) {
  const { data: already } = await db.from("admin_notifications").select("id").eq("proof_id", proof.id).limit(1);
  if (already?.length) return;
  const order = proof.orders;
  await db.from("admin_notifications").insert({
    type: "exception", order_id: proof.order_id, proof_id: proof.id,
    title: `Pedido #${order.order_number}: ${reason}`,
  });
  await queueAdminMessage(db, settings, {
    template: "admin_exception",
    orderId: proof.order_id,
    body:
      `Comprovativo para analisar — pedido #${order.order_number} (${order.product_name}), ${order.customer_name}.\n` +
      `Motivo: ${reason}\n${siteUrl()}/admin/excecoes/${proof.id}`,
  });
}

async function loadAndRead(db: ServiceDb, proofId: string) {
  const { data } = await db.from("payment_proofs").select(COLUMNS).eq("id", proofId).eq("decision", "exception").maybeSingle();
  const proof = data as unknown as PendingProof | null;
  if (!proof?.orders.products?.is_active) return;
  const settings = await getSettings(db, proof.orders.owner_id);
  await readProofImage(db, proof, settings);
}

/** Depois de responder ao cliente, para o envio não ficar mais lento. */
export function scheduleImageReading(proofId: string) {
  const run = async () => loadAndRead(createServiceClient(), proofId);
  try {
    after(() => run().catch((e) => console.error("[comprovativo] leitura da imagem", e)));
  } catch {
    void run();
  }
}

/**
 * Cron: imagens em Exceções ainda por ler (ex.: o servidor reiniciou a meio, ou o
 * plano é lento e a leitura não chegou ao fim).
 *
 * Procura um lote e só depois escolhe dentro dele: um comprovativo que não se possa
 * ler — o produto foi desactivado, por exemplo — não pode ficar à frente da fila a
 * tapar os seguintes. O produto activo é condição da própria consulta, e o lote é
 * maior do que o número que se vai ler, para a filtragem nunca o deixar vazio.
 */
export async function readPendingImages(db: ServiceDb, limit = 1): Promise<number> {
  const { data, error } = await db
    .from("payment_proofs")
    .select(COLUMNS_ACTIVE)
    .eq("kind", "image")
    .eq("decision", "exception")
    .eq("orders.products.is_active", true)
    .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order("created_at", { ascending: true }) // os mais antigos primeiro: são os que ficaram para trás
    .limit(Math.max(20, limit * 5));
  if (error) {
    console.error("[comprovativo] procurar imagens por ler", error);
    return 0;
  }
  const candidatos = (data ?? []) as unknown as PendingProof[];
  if (!candidatos.length) return 0;

  // Os já lidos têm uma verificação "image_ocr". Pergunta-se só pelos candidatos,
  // para a lista não crescer sem fim à medida que a plataforma for tendo mais pedidos.
  const { data: read } = await db
    .from("proof_checks")
    .select("proof_id")
    .eq("check_code", OCR_CHECK)
    .in("proof_id", candidatos.map((p) => p.id));
  const lidos = new Set((read ?? []).map((c: { proof_id: string }) => c.proof_id));
  const pending = candidatos.filter((p) => !lidos.has(p.id)).slice(0, limit);
  for (const proof of pending) {
    // Marca já que passou por aqui: se o OCR estourar o tempo, não volta a prender o cron.
    await saveChecks(db, proof.id, [{ code: OCR_CHECK, result: "warn", effect: "exception", message: "A ler o texto da imagem…" }]);
    const settings = await getSettings(db, proof.orders.owner_id);
    await readProofImage(db, proof, settings);
  }
  return pending.length;
}
