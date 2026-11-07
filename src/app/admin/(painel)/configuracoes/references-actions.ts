"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import type { ActionResult } from "@/lib/products/types";

const digits = (n: number, msg: string) =>
  z.string().transform((s) => s.replace(/\s/g, "")).pipe(z.string().regex(new RegExp(`^\\d{${n}}$`), msg));

const refSchema = z.object({
  label: z.string().trim().max(60, "Máximo 60 caracteres"),
  entity: digits(5, "A Entidade tem 5 dígitos"),
  reference: digits(9, "A Referência tem 9 dígitos"),
});

type Db = Awaited<ReturnType<typeof requireAdmin>>["supabase"];

/** Põe em uso e copia para settings (de onde os pedidos novos a leem), numa só transacção. */
function activateReference(db: Db, id: string) {
  return db.rpc("use_payment_reference", { p_id: id });
}

function done(message: string): ActionResult {
  revalidatePath("/admin/configuracoes");
  return { ok: true, message };
}

export async function addReference(input: { label: string; entity: string; reference: string }): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const parsed = refSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    return { ok: false, error: "Verifique os campos.", fieldErrors };
  }
  const { data, error } = await supabase.from("payment_references").insert(parsed.data).select("id").single();
  if (error || !data) {
    if (error?.code === "23505") return { ok: false, error: "Esta Entidade e Referência já estão registadas na KiandaPay." };
    console.error("[referencias] inserir", error);
    return { ok: false, error: "Não foi possível guardar. Tente de novo." };
  }
  const { count } = await supabase.from("payment_references").select("id", { count: "exact", head: true }).eq("is_default", true);
  if (!count) {
    await activateReference(supabase, data.id);
    return done("Referência adicionada e posta em uso nos checkouts.");
  }
  return done("Referência adicionada. Toque em “Usar nos checkouts” para a pôr em uso.");
}

export async function renameReference(id: string, label: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("payment_references").update({ label: label.trim().slice(0, 60) }).eq("id", id);
  if (error) return { ok: false, error: "Não foi possível guardar." };
  return done("Nome guardado.");
}

export async function setDefaultReference(id: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const { error } = await activateReference(supabase, id);
  if (error) {
    if (error.message.includes("inactive")) return { ok: false, error: "Ative a referência antes de a pôr em uso." };
    if (error.message.includes("not_found")) return { ok: false, error: "Referência não encontrada." };
    console.error("[referencias] usar", error);
    return { ok: false, error: "Não foi possível trocar. Tente de novo." };
  }
  return done("Referência em uso alterada. Os novos pedidos já a usam.");
}

export async function setReferenceActive(id: string, active: boolean): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const { data: target } = await supabase.from("payment_references").select("is_default").eq("id", id).maybeSingle();
  if (!target) return { ok: false, error: "Referência não encontrada." };
  if (!active && target.is_default) return { ok: false, error: "Esta referência está em uso. Escolha outra antes de a desativar." };
  const { error } = await supabase.from("payment_references").update({ is_active: active }).eq("id", id);
  if (error) return { ok: false, error: "Não foi possível guardar." };
  return done(active ? "Referência ativada." : "Referência desativada.");
}

export async function deleteReference(id: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const { data: target } = await supabase.from("payment_references").select("is_default").eq("id", id).maybeSingle();
  if (!target) return { ok: false, error: "Referência não encontrada." };
  if (target.is_default) return { ok: false, error: "Esta referência está em uso. Escolha outra antes de a apagar." };
  const { error } = await supabase.from("payment_references").delete().eq("id", id);
  if (error) return { ok: false, error: "Não foi possível apagar." };
  return done("Referência apagada.");
}
