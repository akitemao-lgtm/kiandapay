-- =====================================================================
-- 0011 — Integrações da conta: Pixel do Meta e UTMify para todos os produtos.
-- Os tokens ficam cifrados numa tabela sem acesso fora do servidor.
-- =====================================================================
create table public.account_integrations (
  owner_id              uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  meta_enabled          boolean not null default false,
  meta_pixel_id         text check (meta_pixel_id ~ '^[0-9]{5,20}$'),
  meta_test_event_code  text,
  meta_currency         char(3) not null default 'AOA',
  meta_conversion_rate  numeric(18,8) check (meta_conversion_rate > 0),
  utmify_enabled        boolean not null default false,
  utmify_currency       char(3) not null default 'USD',
  utmify_conversion_rate numeric(18,8) check (utmify_conversion_rate > 0),
  updated_at            timestamptz not null default now(),
  constraint account_meta_currency_ok check (meta_currency = 'AOA' or meta_conversion_rate is not null),
  constraint account_meta_enabled_ok check (not meta_enabled or meta_pixel_id is not null),
  constraint account_utmify_enabled_ok check (not utmify_enabled or utmify_conversion_rate is not null)
);
create trigger account_integrations_updated_at before update on public.account_integrations
  for each row execute function public.set_updated_at();

alter table public.account_integrations enable row level security;
create policy owner_all on public.account_integrations for all to authenticated
  using (public.owns(owner_id)) with check (public.owns(owner_id));

create table public.account_integration_secrets (
  owner_id                     uuid primary key references auth.users (id) on delete cascade,
  meta_capi_token_encrypted    text,
  utmify_token_encrypted       text,
  updated_at                   timestamptz not null default now()
);
create trigger account_integration_secrets_updated_at before update on public.account_integration_secrets
  for each row execute function public.set_updated_at();
alter table public.account_integration_secrets enable row level security;

-- Último estado aceite pela UTMify, para só reenviar quando o estado do pedido muda.
alter table public.orders
  add column utmify_status text,
  add column utmify_attempts int not null default 0,
  add column utmify_error text,
  add column utmify_sent_at timestamptz;
create index orders_utmify_pending on public.orders (owner_id, created_at desc);
