-- =====================================================================
-- 0010 — Webhook de um produto. Sem produto, serve todos os da conta.
-- A chave composta impede ligar um webhook a um produto de outra conta.
-- =====================================================================
alter table public.products add constraint products_id_owner_key unique (id, owner_id);

alter table public.webhook_endpoints
  add column product_id uuid,
  add constraint webhook_endpoints_product_fk
    foreign key (product_id, owner_id) references public.products (id, owner_id) on delete cascade;
create index webhook_endpoints_product on public.webhook_endpoints (product_id) where product_id is not null;

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
  where e.owner_id = new.owner_id and e.is_active and v_event = any (e.events)
    and (e.product_id is null or e.product_id = new.product_id);
  return new;
end $$;
