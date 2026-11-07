import "server-only";
import type { AccountStatus } from "@/lib/auth";
import type { ServiceDb } from "@/lib/supabase/service";

export type AccountRow = {
  user_id: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  status: AccountStatus;
  is_platform_admin: boolean;
  suspended_reason: string | null;
  created_at: string;
  products: number;
  orders: number;
  paid: number;
  revenue: number;
};

/** Só para o dono da plataforma (verificado antes de chamar): usa a chave de serviço. */
export async function listAccounts(db: ServiceDb, onlyId?: string): Promise<AccountRow[]> {
  const { data, error } = await db.rpc("platform_accounts", { p_user_id: onlyId ?? null });
  if (error) {
    console.error("[contas]", error);
    return [];
  }
  return ((data ?? []) as AccountRow[]).map((r) => ({
    ...r,
    products: Number(r.products),
    orders: Number(r.orders),
    paid: Number(r.paid),
    revenue: Number(r.revenue),
  }));
}

export const STATUS_LABELS: Record<AccountStatus, { label: string; c: string }> = {
  pending: { label: "Por aprovar", c: "bg-amber-100 text-amber-800" },
  active: { label: "Ativa", c: "bg-green-100 text-green-800" },
  suspended: { label: "Suspensa", c: "bg-red-100 text-red-800" },
};
