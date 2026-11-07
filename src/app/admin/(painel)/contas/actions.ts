"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth";
import type { ActionResult } from "@/lib/products/types";
import { createServiceClient, type ServiceDb } from "@/lib/supabase/service";

const uuid = z.string().uuid();

/** As contas só se alteram pelo servidor; o dono da plataforma não se pode suspender a si próprio. */
async function target(id: string): Promise<{ error: string } | { db: ServiceDb }> {
  const { user } = await requirePlatformAdmin();
  if (!uuid.safeParse(id).success) return { error: "Conta inválida." };
  const db = createServiceClient();
  const { data } = await db.from("profiles").select("user_id, is_platform_admin").eq("user_id", id).maybeSingle();
  if (!data) return { error: "Conta não encontrada." };
  if (data.is_platform_admin || data.user_id === user.id) return { error: "Não pode alterar a conta do dono da plataforma." };
  return { db };
}

function done(id: string, message: string): ActionResult {
  revalidatePath("/admin/contas");
  revalidatePath(`/admin/contas/${id}`);
  return { ok: true, message };
}

export async function approveAccount(id: string): Promise<ActionResult> {
  const t = await target(id);
  if ("error" in t) return { ok: false, error: t.error };
  const { error } = await t.db
    .from("profiles")
    .update({ status: "active", approved_at: new Date().toISOString(), suspended_at: null, suspended_reason: null })
    .eq("user_id", id);
  if (error) return { ok: false, error: "Não foi possível aprovar." };
  // Sem isto, quem não recebeu o e-mail de confirmação continuava sem conseguir entrar.
  const { error: confirmError } = await t.db.auth.admin.updateUserById(id, { email_confirm: true });
  if (confirmError) {
    console.error("[contas] confirmar e-mail", confirmError);
    return { ok: false, error: "Conta aprovada, mas o e-mail ficou por confirmar. Tente aprovar de novo." };
  }
  return done(id, "Conta aprovada. Já pode entrar e criar produtos.");
}

export async function suspendAccount(id: string, reason: string): Promise<ActionResult> {
  const t = await target(id);
  if ("error" in t) return { ok: false, error: t.error };
  const { error } = await t.db
    .from("profiles")
    .update({ status: "suspended", suspended_at: new Date().toISOString(), suspended_reason: reason.trim().slice(0, 300) || null })
    .eq("user_id", id);
  if (error) return { ok: false, error: "Não foi possível suspender." };
  return done(id, "Conta suspensa. Os checkouts dela deixaram de aceitar pedidos.");
}

export async function reactivateAccount(id: string): Promise<ActionResult> {
  return approveAccount(id);
}

export async function setProductActive(accountId: string, productId: string, active: boolean): Promise<ActionResult> {
  await requirePlatformAdmin();
  if (!uuid.safeParse(accountId).success || !uuid.safeParse(productId).success) return { ok: false, error: "Produto inválido." };
  const { error } = await createServiceClient()
    .from("products")
    .update({ is_active: active })
    .eq("id", productId)
    .eq("owner_id", accountId);
  if (error) return { ok: false, error: "Não foi possível alterar o produto." };
  return done(accountId, active ? "Produto ativado." : "Produto desativado.");
}
