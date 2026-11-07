import { z } from "zod";
import { MEDIA_PATH } from "@/lib/storage";

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Cor inválida");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .transform((s) => (s === "" ? null : s))
    .nullable();
const mediaPath = z.string().regex(MEDIA_PATH, "Ficheiro inválido").nullable();
const steps = z.array(z.string().trim().min(1, "Passo vazio").max(300)).max(10, "Máximo 10 passos");

export const checkoutSchema = z
  .object({
    logoPath: mediaPath,
    bannerPath: mediaPath,
    primaryColor: hex,
    accentColor: hex,
    backgroundColor: hex,
    title: optionalText(160),
    description: optionalText(5000),
    testimonials: z
      .array(
        z.object({
          name: z.string().trim().min(1, "Indique o nome").max(80),
          text: z.string().trim().min(1, "Escreva o depoimento").max(600),
          rating: z.number().int().min(1).max(5).nullable(),
          photoPath: mediaPath,
        }),
      )
      .max(12, "Máximo 12 depoimentos"),
    guaranteeText: optionalText(1000),
    timerEnabled: z.boolean(),
    timerMinutes: z.number().int().min(1).max(1440).nullable(),
    buttonText: z.string().trim().min(1, "Indique o texto do botão").max(60),
    emailField: z.enum(["required", "optional", "hidden"]).default("required"),
    proofAlwaysVisible: z.boolean().default(false),
    instructionsMode: z.enum(["shown", "collapsed", "hidden"]).default("shown"),
    paymentInstructions: z.object({ bank_app: steps, express: steps, atm: steps, later: steps.default([]) }),
  })
  .refine((c) => !c.timerEnabled || c.timerMinutes !== null, {
    path: ["timerMinutes"],
    message: "Indique a duração do temporizador",
  });

export type CheckoutInput = z.input<typeof checkoutSchema>;
