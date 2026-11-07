-- =====================================================================
-- 0007 — Várias contas (vendedores)
-- Cada conta é dona dos seus produtos, referências, modelos, pedidos,
-- comprovativos, clientes, extratos, notificações e configurações.
-- O RLS só deixa cada conta ver o que é seu; o dono da plataforma vê as
-- outras contas através do servidor (service role), depois de verificado.
-- Tudo o que já existia passa para a conta do administrador actual.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Contas
-- ---------------------------------------------------------------------
create type public.account_status as enum ('pending', 'active', 'suspended');

create table public.profiles (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  display_name       text not null default '' check (char_length(display_name) <= 80),
  phone              text check (char_length(phone) <= 30),
  status             public.account_status not null default 'pending',
  is_platform_admin  boolean not null default false,
  approved_at        timestamptz,
  suspended_at       timestamptz,
  suspended_reason   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

insert into public.profiles (user_id, display_name, status, is_platform_admin, approved_at)
select user_id, 'Kitanda', 'active', true, now() from public.admin_users;

-- Registo: cada utilizador novo do Supabase Auth fica com uma conta pendente.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name, phone)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80),
    left(nullif(new.raw_user_meta_data ->> 'phone', ''), 30)
  )
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Acesso
-- 2FA: opcional para os vendedores, mas quem a ativou tem de a usar;
-- obrigatória para o dono da plataforma.
-- ---------------------------------------------------------------------
create or replace function public.mfa_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'
      )
$$;

-- is_admin() passa a querer dizer "conta ativa com sessão válida" (nome mantido
-- para não mexer nas políticas e no painel de uma vez).
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.status = 'active'
      and (not p.is_platform_admin or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
  ) and public.mfa_ok()
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.status = 'active' and p.is_platform_admin
  ) and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function public.owns(o uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select o = auth.uid() and public.is_admin()
$$;

revoke all on function public.mfa_ok(), public.is_platform_admin(), public.owns(uuid) from public, anon;
grant execute on function public.mfa_ok(), public.is_platform_admin(), public.owns(uuid) to authenticated, service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Donos
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  admin uuid := (select user_id from public.profiles where is_platform_admin limit 1);
begin
  foreach t in array array[
    'settings', 'products', 'payment_references', 'proof_templates', 'proof_template_samples',
    'leads', 'orders', 'payment_proofs', 'bank_statement_imports', 'admin_notifications', 'outbound_messages'
  ] loop
    execute format('alter table public.%I add column owner_id uuid references auth.users (id) on delete restrict', t);
    execute format('update public.%I set owner_id = %L', t, admin);
    execute format('create index %I on public.%I (owner_id)', t || '_owner', t);
  end loop;

  -- Inseridos pelo painel: o dono é quem tem a sessão.
  foreach t in array array['products', 'payment_references', 'proof_templates', 'proof_template_samples', 'bank_statement_imports'] loop
    execute format('alter table public.%I alter column owner_id set default auth.uid()', t);
  end loop;
  foreach t in array array[
    'settings', 'products', 'payment_references', 'proof_templates', 'proof_template_samples',
    'leads', 'orders', 'payment_proofs', 'bank_statement_imports'
  ] loop
    execute format('alter table public.%I alter column owner_id set not null', t);
  end loop;

  -- Transição: o checkout ainda não indica o dono do cliente. Retirado na fase 3.
  execute format('alter table public.leads alter column owner_id set default %L::uuid', admin);
end $$;

-- Configurações: uma linha por conta. A coluna id fica até o código deixar de a usar.
alter table public.settings drop constraint settings_pkey, drop constraint settings_id_check;
alter table public.settings add primary key (owner_id);

-- Uma conta nova recebe as suas configurações por omissão.
create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.settings (owner_id, site_name) values (new.user_id, new.display_name)
  on conflict (owner_id) do nothing;
  return new;
end $$;
create trigger on_profile_created after insert on public.profiles
  for each row execute function public.handle_new_profile();
revoke all on function public.handle_new_profile() from public, anon, authenticated;

-- Pedidos, comprovativos e avisos herdam sempre o dono do produto/pedido.
create or replace function public.orders_set_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select owner_id into new.owner_id from public.products where id = new.product_id;
  return new;
end $$;
create trigger orders_set_owner before insert or update of product_id on public.orders
  for each row execute function public.orders_set_owner();

create or replace function public.set_owner_from_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.order_id is not null then
    select owner_id into new.owner_id from public.orders where id = new.order_id;
  end if;
  return new;
end $$;
create trigger payment_proofs_set_owner before insert on public.payment_proofs
  for each row execute function public.set_owner_from_order();
create trigger admin_notifications_set_owner before insert on public.admin_notifications
  for each row execute function public.set_owner_from_order();
create trigger outbound_messages_set_owner before insert on public.outbound_messages
  for each row execute function public.set_owner_from_order();
revoke all on function public.orders_set_owner(), public.set_owner_from_order() from public, anon, authenticated;

-- Avisos sem pedido criados pelo painel ficam com o dono da sessão.
alter table public.admin_notifications alter column owner_id set default auth.uid();

-- Unicidade por conta
alter table public.leads add constraint leads_owner_phone_key unique (owner_id, phone);
alter table public.proof_templates drop constraint proof_templates_bank_code_channel_version_key,
  add constraint proof_templates_owner_bank_channel_version_key unique (owner_id, bank_code, channel, version);
drop index public.payment_references_one_default;
create unique index payment_references_one_default on public.payment_references (owner_id) where is_default;

-- ---------------------------------------------------------------------
-- Regras de acesso (RLS)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'legal_pages', 'products', 'checkout_pages', 'product_meta_settings', 'leads',
    'checkout_visits', 'proof_templates', 'proof_template_samples', 'orders', 'payment_proofs',
    'proof_checks', 'meta_events', 'order_access_logs', 'order_events', 'outbound_messages',
    'admin_notifications', 'bank_statement_imports', 'bank_statement_lines', 'payment_references'
  ] loop
    execute format('drop policy if exists admin_all on public.%I', t);
  end loop;

  -- Tabelas com dono directo
  foreach t in array array[
    'settings', 'products', 'payment_references', 'proof_templates', 'proof_template_samples', 'leads',
    'orders', 'payment_proofs', 'bank_statement_imports', 'admin_notifications', 'outbound_messages'
  ] loop
    execute format(
      'create policy owner_all on public.%I for all to authenticated using (public.owns(owner_id)) with check (public.owns(owner_id))', t);
  end loop;

  -- Tabelas que pertencem a um produto
  foreach t in array array['checkout_pages', 'product_meta_settings', 'checkout_visits', 'meta_events'] loop
    execute format($f$
      create policy owner_all on public.%I for all to authenticated
      using (exists (select 1 from public.products p where p.id = product_id and public.owns(p.owner_id)))
      with check (exists (select 1 from public.products p where p.id = product_id and public.owns(p.owner_id)))$f$, t);
  end loop;

  -- Tabelas que pertencem a um pedido
  foreach t in array array['order_access_logs', 'order_events'] loop
    execute format($f$
      create policy owner_all on public.%I for all to authenticated
      using (exists (select 1 from public.orders o where o.id = order_id and public.owns(o.owner_id)))
      with check (exists (select 1 from public.orders o where o.id = order_id and public.owns(o.owner_id)))$f$, t);
  end loop;
end $$;

create policy owner_all on public.proof_checks for all to authenticated
  using (exists (select 1 from public.payment_proofs p where p.id = proof_id and public.owns(p.owner_id)))
  with check (exists (select 1 from public.payment_proofs p where p.id = proof_id and public.owns(p.owner_id)));

create policy owner_all on public.bank_statement_lines for all to authenticated
  using (exists (select 1 from public.bank_statement_imports i where i.id = import_id and public.owns(i.owner_id)))
  with check (exists (select 1 from public.bank_statement_imports i where i.id = import_id and public.owns(i.owner_id)));

-- Páginas legais: da plataforma.
create policy platform_all on public.legal_pages for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Contas: cada um vê a sua (alterações só pelo servidor).
alter table public.profiles enable row level security;
create policy own_select on public.profiles for select to authenticated using (user_id = auth.uid());

-- O administrador único deixa de existir como tabela.
drop table public.admin_users;

-- Trocar a referência em uso: só na própria conta.
create or replace function public.use_payment_reference(p_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare r public.payment_references%rowtype;
begin
  select * into r from public.payment_references where id = p_id and public.owns(owner_id) for update;
  if not found then raise exception 'not_found'; end if;
  if not r.is_active then raise exception 'inactive'; end if;
  update public.payment_references set is_default = false where owner_id = r.owner_id and is_default and id <> p_id;
  update public.payment_references set is_default = true where id = p_id and not is_default;
  update public.settings set payment_entity = r.entity, payment_reference = r.reference where owner_id = r.owner_id;
end $$;

-- ---------------------------------------------------------------------
-- Ficheiros (Storage)
-- Cada ficheiro é de quem o carregou, ou da conta cujo id é a primeira pasta.
-- Comprovativos dos clientes: da conta dona do pedido (1.ª pasta = id do pedido).
-- ---------------------------------------------------------------------
update storage.objects set owner_id = (select user_id::text from public.profiles where is_platform_admin limit 1)
where owner_id is null and bucket_id in ('product-media', 'product-files', 'proof-templates', 'statements');

drop policy admin_storage_all on storage.objects;

create policy seller_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('product-media', 'product-files', 'proof-templates', 'statements') and public.is_admin());

create policy seller_rw on storage.objects for all to authenticated
  using (
    bucket_id in ('product-media', 'product-files', 'proof-templates', 'statements') and public.is_admin()
    and (owner_id = auth.uid()::text or (storage.foldername(name))[1] = auth.uid()::text)
  )
  with check (
    bucket_id in ('product-media', 'product-files', 'proof-templates', 'statements') and public.is_admin()
    and (owner_id = auth.uid()::text or (storage.foldername(name))[1] = auth.uid()::text)
  );

create policy seller_proofs_read on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs' and exists (
      select 1 from public.orders o
      where o.id::text = (storage.foldername(name))[1] and public.owns(o.owner_id)
    )
  );
