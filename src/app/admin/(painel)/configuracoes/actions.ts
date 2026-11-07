"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requirePlatformAdmin } from "@/lib/auth";
import { fieldErrors } from "@/lib/products/schema";
import type { ActionResult } from "@/lib/products/types";
import { legalSchema, settingsSchema, type SettingsInput } from "@/lib/settings-schema";

export async function saveSettings(input: SettingsInput): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Verifique os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
  }
  const s = parsed.data;
  const { error } = await supabase
    .from("settings")
    .update({
      ...(s.paymentEntity && s.paymentReference
        ? { payment_entity: s.paymentEntity, payment_reference: s.paymentReference }
        : {}),
      order_ttl_minutes: s.orderTtlMinutes,
      upload_grace_hours: s.uploadGraceHours,
      unique_amount_enabled: s.uniqueAmountEnabled,
      max_uploads_per_order: s.maxUploadsPerOrder,
      max_uploads_per_phone: s.maxUploadsPerPhone,
      phone_upload_window_hours: s.phoneUploadWindowHours,
      lead_channels: s.leadChannels,
      reminder_enabled: s.reminderEnabled,
      reminder_after_minutes: s.reminderAfterMinutes,
      admin_channels: s.adminChannels,
      admin_email: s.adminEmail,
      admin_phone: s.adminPhone,
      site_name: s.siteName,
      support_phone: s.supportPhone,
    })
    .eq("owner_id", user.id);
  if (error) {
    console.error("[configuracoes]", error);
    return { ok: false, error: "Não foi possível guardar. Tente de novo." };
  }
  revalidatePath("/admin/configuracoes");
  return { ok: true, message: "Configurações guardadas." };
}

export async function saveLegalPage(input: { slug: string; title: string; body: string }): Promise<ActionResult> {
  const { supabase } = await requirePlatformAdmin();
  const parsed = legalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Texto inválido." };
  const { error } = await supabase
    .from("legal_pages")
    .update({ title: parsed.data.title, body_md: parsed.data.body })
    .eq("slug", parsed.data.slug);
  if (error) return { ok: false, error: "Não foi possível guardar." };
  revalidatePath(`/${parsed.data.slug}`);
  return { ok: true, message: "Página guardada." };
}
