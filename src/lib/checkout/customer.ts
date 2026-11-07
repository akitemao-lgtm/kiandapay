import { normalizeAngolanPhone } from "@/lib/phone";
import type { CheckoutOptions } from "./types";

/** Guardado quando o checkout não pede o nome. A coluna é obrigatória, mas o Meta nunca o recebe. */
export const NO_NAME = "Sem nome";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type CustomerFields = Pick<CheckoutOptions, "nameField" | "emailField" | "phoneField">;
export type Customer = { name: string | null; email: string | null; phone: string | null };

/** Valida só os campos ativos no checkout. Os desativados são ignorados, mesmo que venham preenchidos. */
export function readCustomer(input: { name: string; email: string; phone: string }, fields: CustomerFields) {
  const errors: Record<string, string> = {};
  const name = fields.nameField === "hidden" ? "" : input.name.replace(/\s+/g, " ").trim();
  const email = fields.emailField === "hidden" ? "" : input.email.trim();
  const rawPhone = fields.phoneField === "hidden" ? "" : input.phone.trim();

  // Basta um nome (ex.: "Maria"); o apelido é opcional.
  if ((fields.nameField === "required" || name) && name.length < 2) errors.name = "Indique o seu nome.";
  if ((fields.emailField === "required" || email) && !EMAIL.test(email)) errors.email = "Indique um e-mail válido.";
  const phone = rawPhone ? normalizeAngolanPhone(rawPhone) : null;
  if ((fields.phoneField === "required" || rawPhone) && !phone) {
    errors.phone = "Número inválido. Use um telemóvel angolano: 9XX XXX XXX.";
  }

  const customer: Customer = { name: name || null, email: email || null, phone };
  return { customer, errors };
}
