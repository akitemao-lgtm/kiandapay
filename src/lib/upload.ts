"use client";

import { createClient } from "@/lib/supabase/browser";
import { safeFileName } from "@/lib/slug";
import { BUCKETS, LIMITS, type MediaKind } from "@/lib/storage";

/**
 * O browser carrega o ficheiro directamente para o Storage com a sessão do
 * administrador (as políticas do bucket exigem is_admin()). O servidor só
 * recebe o caminho e volta a validá-lo.
 */
async function upload(bucket: string, path: string, file: File) {
  const { error } = await createClient()
    .storage.from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "31536000" });
  if (error) throw new Error("Falha ao carregar o ficheiro. Verifique a ligação e tente de novo.");
  return path;
}

export async function uploadImage(kind: MediaKind, file: File): Promise<string> {
  if (!LIMITS.imageTypes.includes(file.type)) throw new Error("Use uma imagem PNG, JPG ou WebP.");
  if (file.size > LIMITS.imageBytes) throw new Error("A imagem tem de ter no máximo 5 MB.");
  return upload(BUCKETS.media, `${kind}/${crypto.randomUUID()}/${safeFileName(file.name)}`, file);
}

export async function uploadProductPdf(file: File): Promise<string> {
  if (file.type !== "application/pdf") throw new Error("O ficheiro tem de ser um PDF.");
  if (file.size > LIMITS.pdfBytes) throw new Error("O PDF tem de ter no máximo 100 MB.");
  const name = safeFileName(file.name).replace(/\.[a-z0-9]+$/, "") + ".pdf";
  return upload(BUCKETS.productFiles, `${crypto.randomUUID()}/${name}`, file);
}

/** Comprovativo de referência ou de teste (bucket privado proof-templates). */
export async function uploadProofFile(folder: "uploads" | "tests", file: File): Promise<string> {
  if (file.type !== "application/pdf") throw new Error("Use o PDF original gerado pela app do banco.");
  if (file.size > 10 * 1024 * 1024) throw new Error("O PDF tem de ter no máximo 10 MB.");
  return upload("proof-templates", `${folder}/${crypto.randomUUID()}.pdf`, file);
}

/** Extrato bancário (bucket privado statements). */
export async function uploadStatement(file: File): Promise<string> {
  const ext = file.name.toLowerCase().split(".").pop();
  if (!ext || !["csv", "xlsx", "pdf"].includes(ext)) throw new Error("Use um ficheiro CSV, Excel (.xlsx) ou PDF.");
  if (file.size > 20 * 1024 * 1024) throw new Error("O ficheiro tem de ter no máximo 20 MB.");
  const type = ext === "csv" ? "text/csv" : ext === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return upload("statements", `${crypto.randomUUID()}.${ext}`, new File([file], file.name, { type }));
}
