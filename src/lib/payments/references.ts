import type { SupabaseClient } from "@supabase/supabase-js";

/** is_default = a referência em uso em todos os checkouts (copiada para settings). */
export type PaymentRef = {
  id: string;
  label: string;
  entity: string;
  reference: string;
  is_default: boolean;
  is_active: boolean;
};

/** available = false enquanto a tabela não existir (migração 0005 por aplicar). */
export async function listReferences(db: SupabaseClient): Promise<{ refs: PaymentRef[]; available: boolean }> {
  const { data, error } = await db
    .from("payment_references")
    .select("id, label, entity, reference, is_default, is_active")
    .order("is_default", { ascending: false })
    .order("created_at");
  if (error) return { refs: [], available: false };
  return { refs: (data ?? []) as PaymentRef[], available: true };
}
