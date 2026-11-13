import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageChannel } from "@/lib/messaging/types";

export type Settings = {
  payment_entity: string;
  payment_reference: string;
  order_ttl_minutes: number;
  upload_grace_hours: number;
  unique_amount_enabled: boolean;
  /** Aprovar ecrãs sem a data do pagamento, pela hora da captura. */
  allow_screenshot_time: boolean;
  max_uploads_per_order: number;
  max_uploads_per_phone: number;
  phone_upload_window_hours: number;
  lead_channels: MessageChannel[];
  reminder_enabled: boolean;
  reminder_after_minutes: number;
  admin_channels: MessageChannel[];
  admin_email: string | null;
  admin_phone: string | null;
  site_name: string;
  support_phone: string | null;
  updated_at: string;
};

/** Configurações de uma conta. Funciona com o cliente do painel (RLS) ou com o de serviço. */
export async function getSettings(db: SupabaseClient, ownerId: string): Promise<Settings> {
  const { data, error } = await db.from("settings").select("*").eq("owner_id", ownerId).single();
  if (error || !data) throw new Error("Não foi possível ler as configurações");
  return data as Settings;
}

/** "987654321" → "987 654 321" */
export function formatReference(ref: string): string {
  return ref.replace(/\D/g, "").replace(/(\d{3})(?=\d)/g, "$1 ");
}
