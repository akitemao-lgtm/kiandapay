import { z } from "zod";

const channel = z.enum(["sms", "whatsapp", "email"]);
const optional = (max: number) =>
  z.string().trim().max(max).transform((s) => (s === "" ? null : s)).nullable();

export const settingsSchema = z
  .object({
    paymentEntity: z.string().transform((s) => s.replace(/\s/g, "")).pipe(z.string().regex(/^\d{5}$/, "A Entidade tem 5 dígitos")).optional(),
    paymentReference: z.string().transform((s) => s.replace(/\s/g, "")).pipe(z.string().regex(/^\d{9}$/, "A Referência tem 9 dígitos")).optional(),
    orderTtlMinutes: z.number().int().min(10, "Mínimo 10 minutos").max(43200, "Máximo 30 dias"),
    uploadGraceHours: z.number().int().min(0).max(168, "Máximo 7 dias"),
    uniqueAmountEnabled: z.boolean(),
    maxUploadsPerOrder: z.number().int().min(1).max(10),
    maxUploadsPerPhone: z.number().int().min(1).max(50),
    phoneUploadWindowHours: z.number().int().min(1).max(720),
    leadChannels: z.array(channel.exclude(["email"])),
    reminderEnabled: z.boolean(),
    reminderAfterMinutes: z.number().int().min(5).max(10080),
    adminChannels: z.array(channel),
    adminEmail: z.string().trim().email("Email inválido").or(z.literal("")).transform((s) => s || null).nullable(),
    adminPhone: optional(30),
    siteName: z.string().trim().max(80),
    supportPhone: optional(30),
  })
  .superRefine((s, ctx) => {
    if (s.adminChannels.includes("email") && !s.adminEmail) {
      ctx.addIssue({ code: "custom", path: ["adminEmail"], message: "Indique o email para as notificações" });
    }
    if (s.adminChannels.some((c) => c !== "email") && !s.adminPhone) {
      ctx.addIssue({ code: "custom", path: ["adminPhone"], message: "Indique o telefone para as notificações" });
    }
  });

export type SettingsInput = z.input<typeof settingsSchema>;

export const legalSchema = z.object({
  slug: z.enum(["privacidade", "termos"]),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(50000),
});
