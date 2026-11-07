import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PdfAnalysis } from "./analyze";
import type { Extracted } from "./extract";
import { buildFingerprint, type Fingerprint } from "./templates";

export const TEMPLATE_BUCKET = "proof-templates";

export type TemplateTarget =
  | { templateId: string }
  | { bankCode: string; channel: string; name: string; keywords: string[] };

/**
 * Cria um modelo novo ou alarga um existente com um comprovativo verdadeiro,
 * e guarda o ficheiro como amostra (bucket privado proof-templates).
 */
export async function saveTemplateSample(
  db: SupabaseClient,
  input: { analysis: PdfAnalysis; extracted: Extracted; bytes: Uint8Array; target: TemplateTarget; sourceProofId?: string },
): Promise<{ ok: true; templateId: string } | { ok: false; error: string }> {
  const { analysis, extracted, target } = input;
  let templateId: string;

  if ("templateId" in target) {
    const { data: t } = await db.from("proof_templates").select("id, fingerprint").eq("id", target.templateId).maybeSingle();
    if (!t) return { ok: false, error: "Modelo não encontrado." };
    const fingerprint = buildFingerprint(analysis, extracted, t.fingerprint as Fingerprint);
    const { error } = await db.from("proof_templates").update({ fingerprint }).eq("id", t.id);
    if (error) return { ok: false, error: "Não foi possível actualizar o modelo." };
    templateId = t.id;
  } else {
    const { data: existing } = await db
      .from("proof_templates")
      .select("version")
      .eq("bank_code", target.bankCode)
      .eq("channel", target.channel)
      .order("version", { ascending: false })
      .limit(1);
    const { data: created, error } = await db
      .from("proof_templates")
      .insert({
        bank_code: target.bankCode,
        channel: target.channel,
        name: target.name,
        version: (existing?.[0]?.version ?? 0) + 1,
        detection: { keywords: target.keywords },
        fingerprint: buildFingerprint(analysis, extracted),
        created_from_proof_id: input.sourceProofId ?? null,
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: "Não foi possível criar o modelo." };
    templateId = created.id;
  }

  const sha = createHash("sha256").update(input.bytes).digest("hex");
  const path = `samples/${templateId}/${sha.slice(0, 16)}.pdf`;
  await db.storage.from(TEMPLATE_BUCKET).upload(path, input.bytes, { contentType: "application/pdf", upsert: true });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { lines, text, ...meta } = analysis;
  await db.from("proof_template_samples").insert({
    template_id: templateId,
    bank_code: "templateId" in target ? extracted.bankGuess ?? "outro" : target.bankCode,
    storage_path: path,
    file_sha256: sha,
    pdf_meta: meta,
    extracted,
  });
  return { ok: true, templateId };
}
