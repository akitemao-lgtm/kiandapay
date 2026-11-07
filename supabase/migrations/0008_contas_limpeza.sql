-- =====================================================================
-- 0008 — Várias contas: limpeza da transição e gestão das contas
-- Só depois de publicado o código que indica o dono do cliente e lê as
-- configurações por conta.
-- =====================================================================

-- Um telefone pode ser cliente de várias contas; o dono vem sempre do produto.
alter table public.leads alter column owner_id drop default;
alter table public.leads drop constraint leads_phone_key;
alter table public.settings drop column id;

-- Aviso ao dono da plataforma quando alguém se regista.
alter table public.admin_notifications drop constraint admin_notifications_type_check;
alter table public.admin_notifications add constraint admin_notifications_type_check
  check (type in ('exception', 'meta_error', 'fraud_block', 'reconciliation', 'new_account'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text := left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80);
begin
  insert into public.profiles (user_id, display_name, phone)
  values (new.id, v_name, left(nullif(new.raw_user_meta_data ->> 'phone', ''), 30))
  on conflict (user_id) do nothing;

  insert into public.admin_notifications (type, title, owner_id)
  select 'new_account', 'Conta nova por aprovar: ' || coalesce(nullif(v_name, ''), new.email, 'sem nome'), p.user_id
  from public.profiles p where p.is_platform_admin;
  return new;
end $$;

-- Lista de contas com números. Só o servidor a chama, depois de confirmar o dono da plataforma.
create or replace function public.platform_accounts(p_user_id uuid default null)
returns table (
  user_id uuid, display_name text, phone text, email text, status public.account_status,
  is_platform_admin boolean, suspended_reason text, created_at timestamptz,
  products bigint, orders bigint, paid bigint, revenue numeric
)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.display_name, p.phone, u.email::text, p.status, p.is_platform_admin, p.suspended_reason, p.created_at,
         (select count(*) from public.products x where x.owner_id = p.user_id),
         (select count(*) from public.orders o where o.owner_id = p.user_id),
         (select count(*) from public.orders o where o.owner_id = p.user_id and o.status = 'paid'),
         (select coalesce(sum(o.amount_due), 0) from public.orders o where o.owner_id = p.user_id and o.status = 'paid')
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where p_user_id is null or p.user_id = p_user_id
  order by p.created_at desc
$$;
revoke all on function public.platform_accounts(uuid) from public, anon, authenticated;
grant execute on function public.platform_accounts(uuid) to service_role;
