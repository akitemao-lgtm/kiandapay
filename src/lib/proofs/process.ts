import "server-only";
import { createHash } from "node:crypto";
import { cancelReminders, queueAdminMessage } from "@/lib/messaging/queue";
import { markOrderPaid } from "@/lib/orders/paid";
import { orderView } from "@/lib/orders/public";
import { getSettings, type Settings } from "@/lib/settings";
import { siteUrl } from "@/lib/site";
import type { ServiceDb } from "@/lib/supabase/service";
import { analyzeImage, analyzePdf, type ImageAnalysis, type PdfAnalysis } from "./analyze";
import { decide, type Decision } from "./decide";
import { extractFields, type Extracted } from "./extract";
import { matchTemplate, type TemplateRow } from "./templates";

export const PROOF_BUCKET = "payment-proofs";
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

export type UploadOutcome =
  | { ok: true; decision: Decision["decision"]; reason: string | null; attemptsLeft: number }
  | { ok: false; status: number; error: string };

type FileKind = { kind: "pdf" | "image"; ext: string; mime: string };

/** Confirma o tipo pelos primeiros bytes, não pela extensão. */
export function sniffFile(bytes: Uint8Array): FileKind | null {
  const head = Buffer.from(bytes.subarray(0, 16));
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return { kind: "pdf", ext: "pdf", mime: "application/pdf" };
  if (head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG") return { kind: "image", ext: "png", mime: "image/png" };
  if (head[0] === 0xff && head[1] === 0xd8) return { kind: "image", ext: "jpg", mime: "image/jpeg" };
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") {
    return { kind: "image", ext: "webp", mime: "image/webp" };
  }
  if (head.subarray(4, 8).toString("latin1") === "ftyp" && /hei[cx]|mif1|msf1/.test(head.subarray(8, 12).toString("latin1"))) {
    return { kind: "image", ext: "heic", mime: "image/heic" };
  }
  return null;
}

export type ProofAnalysis = {
  analysis: PdfAnalysis | ImageAnalysis;
  extracted: Extracted | null;
  template: TemplateRow | null;
  error: string | null;
};

/** Leitura completa de um ficheiro: análise do PDF, extracção e identificação do modelo. */
/** ownerId: só os modelos dessa conta contam para identificar o comprovativo. */
export async function readProof(db: ServiceDb, bytes: Uint8Array, kind: "pdf" | "image", ownerId: string): Promise<ProofAnalysis> {
  if (kind === "image") return { analysis: await analyzeImage(bytes), extracted: null, template: null, error: null };
  try {
    const analysis = await analyzePdf(bytes);
    const extracted = extractFields(analysis.lines, analysis.text);
    const { data: templates } = await db.from("proof_templates").select("*").eq("is_active", true).eq("owner_id", ownerId);
    return { analysis, extracted, template: matchTemplate(analysis, (templates ?? []) as TemplateRow[]), error: null };
  } catch (e) {
    console.error("[comprovativo] PDF ilegível", e);
    return { analysis: { kind: "image", qr: [] }, extracted: null, template: null, error: "PDF ilegível ou danificado" };
  }
}

/** Resumo guardado em payment_proofs.pdf_meta (também serve para criar modelos). */
export function pdfMeta(a: PdfAnalysis | ImageAnalysis) {
  if (a.kind !== "pdf") return { kind: a.kind, qr: a.qr };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { lines, text, ...meta } = a;
  return meta;
}

export async function processProofUpload(
  db: ServiceDb,
  input: { token: string; bytes: Uint8Array; filename: string | null; ip: string | null; userAgent: string | null },
): Promise<UploadOutcome> {
  const { data: order } = await db
    .from("orders")
    .select("id, lead_id, status, created_at, expires_at, amount_due, payment_entity, payment_reference, upload_count, order_number, customer_name, customer_phone, product_name, owner_id")
    .eq("public_token", input.token)
    .maybeSingle();
  if (!order) return { ok: false, status: 404, error: "Pedido não encontrado." };

  const settings = await getSettings(db, order.owner_id);
  const view = orderView(order, settings);
  if (view !== "awaiting" && view !== "awaiting_grace") {
    return { ok: false, status: 409, error: "Este pedido já não aceita comprovativos." };
  }

  const { data: lead } = await db.from("leads").select("blocked_at").eq("id", order.lead_id).single();
  if (lead?.blocked_at) return { ok: false, status: 403, error: "Não é possível enviar comprovativos com este número. Contacte o suporte." };

  if (order.upload_count >= settings.max_uploads_per_order) {
    return { ok: false, status: 429, error: "Atingiu o limite de envios para este pedido. Contacte o suporte." };
  }
  const since = new Date(Date.now() - settings.phone_upload_window_hours * 3_600_000).toISOString();
  const { count: phoneUploads } = await db
    .from("payment_proofs")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", order.lead_id)
    .gte("created_at", since);
  if ((phoneUploads ?? 0) >= settings.max_uploads_per_phone) {
    return { ok: false, status: 429, error: "Atingiu o limite de envios para este número. Tente mais tarde ou contacte o suporte." };
  }

  if (input.bytes.byteLength > MAX_PROOF_BYTES) return { ok: false, status: 413, error: "O ficheiro tem de ter no máximo 5 MB." };
  const file = sniffFile(input.bytes);
  if (!file) return { ok: false, status: 415, error: "Envie o comprovativo em PDF (ou uma imagem PNG/JPG)." };

  // Reservar a tentativa (evita duas submissões em simultâneo com o mesmo número).
  const attempt = order.upload_count + 1;
  const { data: claimed } = await db
    .from("orders")
    .update({ upload_count: attempt })
    .eq("id", order.id)
    .eq("upload_count", order.upload_count)
    .select("id");
  if (!claimed?.length) return { ok: false, status: 409, error: "Já está a ser enviado um comprovativo. Aguarde uns segundos." };
  await cancelReminders(db, order.id);

  const sha = createHash("sha256").update(input.bytes).digest("hex");
  const storagePath = `${order.id}/${attempt}-${sha.slice(0, 12)}.${file.ext}`;
  const { error: upErr } = await db.storage
    .from(PROOF_BUCKET)
    .upload(storagePath, input.bytes, { contentType: file.mime, upsert: true });
  if (upErr) {
    console.error("[comprovativo] storage", upErr);
    await db.from("orders").update({ upload_count: order.upload_count }).eq("id", order.id).eq("upload_count", attempt);
    return { ok: false, status: 500, error: "Não foi possível guardar o ficheiro. Tente de novo." };
  }

  // Regra 5 — o mesmo ficheiro já foi enviado?
  const { data: original } = await db
    .from("payment_proofs")
    .select("id, order_id, orders!payment_proofs_order_id_fkey(status)")
    .eq("file_sha256", sha)
    .is("duplicate_of", null)
    .maybeSingle();
  const originalOrderStatus = (original?.orders as unknown as { status: string } | null)?.status;

  const read = original
    ? { analysis: { kind: "image" as const, qr: [] }, extracted: null, template: null, error: null }
    : await readProof(db, input.bytes, file.kind, order.owner_id);

  // Regra 4 — o mesmo n.º de transacção noutro pedido?
  let transactionReuse: { otherOrderPaid: boolean } | null = null;
  const txn = read.extracted?.transactionId;
  if (txn) {
    const { data: reused } = await db
      .from("payment_proofs")
      .select("order_id, decision, orders!payment_proofs_order_id_fkey(status)")
      .eq("ext_transaction_id", txn)
      .neq("order_id", order.id)
      .in("decision", ["approved", "exception", "pending"])
      .limit(1);
    if (reused?.length) {
      const st = (reused[0].orders as unknown as { status: string } | null)?.status;
      transactionReuse = { otherOrderPaid: st === "paid" };
    }
  }

  let result: Decision = read.error
    ? {
        decision: "exception", fraud: false, reasonCode: "unreadable", reason: read.error,
        checks: [{ code: "readable", result: "fail", effect: "exception", message: read.error }],
      }
    : decide({
        order: { created_at: order.created_at, expires_at: order.expires_at, amount_due: Number(order.amount_due) },
        payment: { entity: order.payment_entity, reference: order.payment_reference },
        analysis: read.analysis,
        extracted: read.extracted,
        template: read.template,
        duplicateFile: original
          ? { sameOrder: original.order_id === order.id, otherOrderPaid: originalOrderStatus === "paid" }
          : null,
        transactionReuse,
      });

  const ex = read.extracted;
  const { data: proof, error: insErr } = await db
    .from("payment_proofs")
    .insert({
      order_id: order.id,
      lead_id: order.lead_id,
      attempt_no: attempt,
      storage_path: storagePath,
      original_filename: input.filename?.slice(0, 200) ?? null,
      mime_type: file.mime,
      size_bytes: input.bytes.byteLength,
      kind: file.kind,
      file_sha256: sha,
      duplicate_of: original?.id ?? null,
      template_id: read.template?.id ?? null,
      bank_code: read.template?.bank_code ?? ex?.bankGuess ?? null,
      ext_amount: ex?.amount ?? null,
      ext_paid_at: ex?.paidAt ?? null,
      ext_entity: ex?.entity ?? null,
      ext_reference: ex?.reference ?? null,
      ext_transaction_id: ex?.transactionId ?? null,
      ext_payer_name: ex?.payerName ?? null,
      ext_raw: read.analysis.kind === "pdf" ? { positions: ex?.positions ?? {}, lines: read.analysis.lines.slice(0, 200) } : {},
      pdf_meta: pdfMeta(read.analysis),
      qr_payload: read.analysis.qr[0] ?? null,
      decision: "pending",
      ip: input.ip,
      user_agent: input.userAgent,
    })
    .select("id")
    .single();
  if (insErr || !proof) {
    console.error("[comprovativo] inserir", insErr);
    return { ok: false, status: 500, error: "Não foi possível registar o comprovativo. Tente de novo." };
  }

  await db.from("proof_checks").insert(
    result.checks.map((c) => ({
      proof_id: proof.id, check_code: c.code, result: c.result, effect: c.effect, message: c.message, details: c.details ?? {},
    })),
  );

  result = await applyDecision(db, settings, { ...order, attempt }, proof.id, result);

  const attemptsLeft = Math.max(0, settings.max_uploads_per_order - attempt);
  return { ok: true, decision: result.decision, reason: result.decision === "rejected" ? result.reason : null, attemptsLeft };
}

async function applyDecision(
  db: ServiceDb,
  settings: Settings,
  order: { id: string; lead_id: string; order_number: number; customer_name: string; product_name: string; amount_due: number; attempt: number },
  proofId: string,
  result: Decision,
): Promise<Decision> {
  const now = new Date().toISOString();
  const setProof = (decision: Decision["decision"], r: Decision) =>
    db
      .from("payment_proofs")
      .update({
        decision, decision_source: "auto", decision_reason_code: r.reasonCode, decision_reason: r.reason,
        fraud_suspected: r.fraud, decided_at: now,
      })
      .eq("id", proofId);

  if (result.decision === "approved") {
    const { error } = await setProof("approved", result);
    if (!error) {
      await markOrderPaid(db, settings, order.id, proofId, "auto");
      return result;
    }
    // 23505: corrida rara, a mesma transacção foi aprovada noutro pedido entretanto.
    console.error("[comprovativo] aprovar", error);
    result = error.code === "23505"
      ? { ...result, decision: "exception", reasonCode: "txn_race", reason: "Transação aprovada noutro pedido em simultâneo" }
      : { ...result, decision: "exception", reasonCode: "save_failed", reason: "Erro ao gravar a aprovação: confirmar manualmente" };
  }

  if (result.decision === "exception") {
    await setProof("exception", result);
    await db.from("orders").update({ status: "under_review" }).eq("id", order.id).in("status", ["awaiting_payment", "expired"]);
    await db.from("admin_notifications").insert({
      type: "exception", order_id: order.id, proof_id: proofId,
      title: `Pedido #${order.order_number}: ${result.reason ?? "comprovativo para analisar"}`,
    });
    await queueAdminMessage(db, settings, {
      template: "admin_exception",
      orderId: order.id,
      body:
        `Comprovativo para analisar — pedido #${order.order_number} (${order.product_name}), ${order.customer_name}.\n` +
        `Motivo: ${result.reason}\n${siteUrl()}/admin/excecoes/${proofId}`,
    });
    return result;
  }

  // Rejeitado
  await setProof("rejected", result);
  if (result.fraud) {
    await db.from("leads").update({ blocked_at: now, blocked_reason: `Fraude automática: ${result.reason}` }).eq("id", order.lead_id);
    await db.from("orders").update({ status: "rejected", rejected_reason: result.reason }).eq("id", order.id);
    await db.from("admin_notifications").insert({
      type: "fraud_block", order_id: order.id, proof_id: proofId,
      title: `Pedido #${order.order_number}: número bloqueado (${result.reason})`,
    });
  } else if (order.attempt >= settings.max_uploads_per_order) {
    await db
      .from("orders")
      .update({ status: "rejected", rejected_reason: `${result.reason} Atingiu o limite de envios.` })
      .eq("id", order.id);
  }
  return result;
}
