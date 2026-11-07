import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";

/**
 * Cliente com a chave de serviço: ignora o RLS. Só para rotas públicas do
 * servidor (checkout, página do pedido, cron), que devolvem apenas os campos
 * necessários ao browser.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Variável de ambiente em falta: SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type ServiceDb = ReturnType<typeof createServiceClient>;
