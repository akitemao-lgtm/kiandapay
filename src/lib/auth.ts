import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AccountStatus = "pending" | "active" | "suspended";
export type Profile = {
  user_id: string;
  display_name: string;
  phone: string | null;
  status: AccountStatus;
  is_platform_admin: boolean;
  suspended_reason: string | null;
};

const PROFILE_COLUMNS = "user_id, display_name, phone, status, is_platform_admin, suspended_reason";

/** Sessão e conta, sem exigir que a conta esteja ativa (páginas de estado e de 2FA). */
export async function getAccount() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("user_id", user.id).maybeSingle();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const p = profile as Profile | null;
  // 2FA: obrigatória para o dono da plataforma; para os outros, só para quem a ativou.
  const needsMfa = aal?.currentLevel !== "aal2" && (p?.is_platform_admin || aal?.nextLevel === "aal2");
  return { supabase, user, profile: p, needsMfa };
}

/**
 * Garante uma conta ativa com a sessão válida. Usar em todos os layouts,
 * páginas e server actions do painel. O RLS só mostra os dados desta conta.
 */
export async function requireAdmin() {
  const account = await getAccount();
  if (!account) redirect("/admin/login");
  const { supabase, user, profile, needsMfa } = account;
  if (!profile) {
    await supabase.auth.signOut();
    redirect("/admin/login?erro=sem-acesso");
  }
  if (needsMfa) redirect("/admin/mfa");
  if (profile.status !== "active") redirect("/admin/estado");
  return { supabase, user, profile };
}

/** Só o dono da plataforma (gestão das contas). */
export async function requirePlatformAdmin() {
  const r = await requireAdmin();
  if (!r.profile.is_platform_admin) redirect("/admin");
  return r;
}
