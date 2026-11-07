import { z } from "zod";
import { RESERVED_SLUGS, SLUG_REGEX } from "@/lib/slug";
import { MEDIA_PATH, PRODUCT_FILE_PATH } from "@/lib/storage";

export const productSchema = z
  .object({
    name: z.string().trim().min(2, "Indique o nome").max(120, "Máximo 120 caracteres"),
    slug: z
      .string()
      .trim()
      .max(80, "Máximo 80 caracteres")
      .regex(SLUG_REGEX, "Use só letras minúsculas, números e hífens")
      .refine((s) => !RESERVED_SLUGS.has(s), "Este endereço está reservado"),
    description: z.string().trim().max(5000, "Máximo 5000 caracteres"),
    price: z
      .number({ invalid_type_error: "Preço inválido" })
      .positive("O preço tem de ser maior que zero")
      .max(1_000_000_000, "Preço demasiado alto")
      .transform((n) => Math.round(n * 100) / 100),
    imagePath: z.string().regex(MEDIA_PATH, "Imagem inválida").nullable(),
    isActive: z.boolean(),
    deliveryType: z.enum(["pdf", "link"]),
    deliveryFilePath: z.string().regex(PRODUCT_FILE_PATH, "Ficheiro inválido").nullable(),
    deliveryFileName: z.string().trim().max(200).nullable(),
    deliveryUrl: z
      .string()
      .trim()
      .url("URL inválido")
      .refine((u) => u.startsWith("https://"), "O link tem de começar por https://")
      .nullable(),
    deliveryButtonLabel: z.string().trim().max(60, "Máximo 60 caracteres").nullable(),
  })
  .superRefine((p, ctx) => {
    if (p.deliveryType === "pdf" && !p.deliveryFilePath) {
      ctx.addIssue({ code: "custom", path: ["deliveryFilePath"], message: "Carregue o PDF do produto" });
    }
    if (p.deliveryType === "link") {
      if (!p.deliveryUrl) {
        ctx.addIssue({ code: "custom", path: ["deliveryUrl"], message: "Indique o link de acesso" });
      }
      if (!p.deliveryButtonLabel) {
        ctx.addIssue({ code: "custom", path: ["deliveryButtonLabel"], message: "Indique o texto do botão" });
      }
    }
  });

export type ProductInput = z.input<typeof productSchema>;

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
