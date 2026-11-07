"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";

/** Marca como lida e abre o destino (comprovativo, pedido ou auditoria). */
export async function openNotification(id: string, href: string): Promise<void> {
  const { supabase } = await requireAdmin();
  if (z.string().uuid().safeParse(id).success) {
    await supabase.from("admin_notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  }
  revalidatePath("/admin", "layout");
  redirect(href.startsWith("/admin") ? href : "/admin/notificacoes");
}

export async function markAllRead(): Promise<void> {
  const { supabase } = await requireAdmin();
  await supabase.from("admin_notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  revalidatePath("/admin", "layout");
}
