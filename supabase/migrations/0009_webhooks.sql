-- =====================================================================
-- 0009 — Webhooks: cada conta recebe os eventos dos seus pedidos num URL.
-- As contas só leem; alterações e envios passam pelo servidor, que valida o
-- URL. Se uma conta pudesse inserir envios, forjaria avisos com o segredo alheio.
-- =====================================================================
create table public.webhook_endpoints (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users (id) on delete cascade,
  url               text not null check (url ~ '^https://' and char_length(url) <= 500),
  description       text not null default '' check (char_length(description) <= 80),
  events            text[] not null check (cardinality(events) > 0),
  secret_encrypted  text not null,   -- AES-256-GCM pela app
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index webhook_endpoints_owner on public.webhook_endpoints (owner_id);
create trigger webhook_endpoints_updated_at before update on public.webhook_endpoints
  for each row execute function public.set_updated_at();

create table public.webhook_deliveries (
  id               uuid primary key default gen_random_uuid(),
  endpoint_id      uuid not null references public.webhook_endpoints (id) on delete cascade,
  owner_id         uuid not null references auth.users (id) on delete cascade,
  order_id         uuid references public.orders (id) on delete set null,
  event            text not null,
  payload          jsonb not null,
  status           text not null default 'pending' check (status in ('pending', 'sending', 'success', 'failed')),
  attempts         int not null default 0,
  next_attempt_at  timestamptz not null default now(),
  claimed_at       timestamptz,
  last_status      int,
  last_error       text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index webhook_deliveries_due on public.webhook_deliveries (next_attempt_at) where status = 'pending';
create index webhook_deliveries_stuck on public.webhook_deliveries (claimed_at) where status = 'sending';
create index webhook_deliveries_endpoint on public.webhook_deliveries (endpoint_id, created_at desc);
create index webhook_deliveries_owner on public.webhook_deliveries (owner_id);
create index webhook_deliveries_order on public.webhook_deliveries (order_id);

alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;
create policy owner_select on public.webhook_endpoints for select to authenticated using (public.owns(owner_id));
create policy owner_select on public.webhook_deliveries for select to authenticated using (public.owns(owner_id));

-- O envio guarda o estado do pedido no momento do evento.
create or replace function public.enqueue_order_webhooks()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'order.created';
  elsif new.status is distinct from old.status then
    v_event := case new.status::text
      when 'under_review' then 'order.under_review'
      when 'paid' then 'order.paid'
      when 'rejected' then 'order.rejected'
      when 'expired' then 'order.expired'
    end;
  end if;
  if v_event is null then return new; end if;

  insert into public.webhook_deliveries (endpoint_id, owner_id, order_id, event, payload)
  select e.id, e.owner_id, new.id, v_event, jsonb_build_object(
    'order', jsonb_build_object(
      'id', new.id, 'number', new.order_number, 'status', new.status,
      'amount', new.amount_due, 'currency', new.currency,
      'entity', new.payment_entity, 'reference', new.payment_reference,
      'created_at', new.created_at, 'expires_at', new.expires_at, 'paid_at', new.paid_at,
      'rejected_reason', new.rejected_reason
    ),
    'customer', jsonb_build_object('name', new.customer_name, 'phone', new.customer_phone, 'email', new.customer_email),
    'product', (select jsonb_build_object('id', p.id, 'name', new.product_name, 'slug', p.slug) from public.products p where p.id = new.product_id),
    'tracking', jsonb_build_object(
      'utm_source', new.utm_source, 'utm_medium', new.utm_medium, 'utm_campaign', new.utm_campaign,
      'utm_content', new.utm_content, 'utm_term', new.utm_term
    )
  )
  from public.webhook_endpoints e
  where e.owner_id = new.owner_id and e.is_active and v_event = any (e.events);
  return new;
end $$;
revoke all on function public.enqueue_order_webhooks() from public, anon, authenticated;

create trigger orders_enqueue_webhooks after insert or update of status on public.orders
  for each row execute function public.enqueue_order_webhooks();
