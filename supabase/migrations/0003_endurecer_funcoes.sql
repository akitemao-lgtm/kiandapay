-- =====================================================================
-- 0003 — Correções dos alertas de segurança do Supabase
-- =====================================================================
alter function public.set_updated_at() set search_path = '';
alter function public.log_order_status() set search_path = '';

-- is_admin() só é útil para utilizadores com sessão (RLS e verificação no painel).
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
