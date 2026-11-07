-- =====================================================================
-- 0004 — Dashboard
-- Funil (visitas, pedidos) pela data de criação; vendas e faturação pela
-- data de pagamento. Dias no fuso de Angola. SECURITY INVOKER: o RLS aplica-se
-- (só o administrador com 2FA vê dados).
-- =====================================================================
create or replace function public.admin_dashboard(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
with
visits as (
  select * from public.checkout_visits where created_at >= p_from and created_at < p_to
),
created as (
  select * from public.orders where created_at >= p_from and created_at < p_to
),
paid as (
  select * from public.orders where status = 'paid' and paid_at >= p_from and paid_at < p_to
),
product_rows as (
  select p.id, p.name,
         (select count(*) from visits v where v.product_id = p.id) as visits,
         (select count(*) from created c where c.product_id = p.id) as orders,
         (select count(*) from paid s where s.product_id = p.id) as sales,
         (select coalesce(sum(s.amount_due), 0) from paid s where s.product_id = p.id) as revenue
  from public.products p
),
campaign_keys as (
  select coalesce(utm_source, '(direto)') as source, coalesce(utm_campaign, '(sem campanha)') as campaign from visits
  union
  select coalesce(utm_source, '(direto)'), coalesce(utm_campaign, '(sem campanha)') from created
  union
  select coalesce(utm_source, '(direto)'), coalesce(utm_campaign, '(sem campanha)') from paid
),
campaign_rows as (
  select k.source, k.campaign,
         (select count(*) from visits v where coalesce(v.utm_source, '(direto)') = k.source and coalesce(v.utm_campaign, '(sem campanha)') = k.campaign) as visits,
         (select count(*) from created c where coalesce(c.utm_source, '(direto)') = k.source and coalesce(c.utm_campaign, '(sem campanha)') = k.campaign) as orders,
         (select count(*) from paid s where coalesce(s.utm_source, '(direto)') = k.source and coalesce(s.utm_campaign, '(sem campanha)') = k.campaign) as sales,
         (select coalesce(sum(s.amount_due), 0) from paid s where coalesce(s.utm_source, '(direto)') = k.source and coalesce(s.utm_campaign, '(sem campanha)') = k.campaign) as revenue
  from campaign_keys k
),
days as (
  select d::date as day
  from generate_series(
    (p_from at time zone 'Africa/Luanda')::date,
    ((p_to - interval '1 microsecond') at time zone 'Africa/Luanda')::date,
    interval '1 day'
  ) d
),
daily_rows as (
  select d.day,
         (select count(*) from visits v where (v.created_at at time zone 'Africa/Luanda')::date = d.day) as visits,
         (select count(*) from created c where (c.created_at at time zone 'Africa/Luanda')::date = d.day) as orders,
         (select count(*) from paid s where (s.paid_at at time zone 'Africa/Luanda')::date = d.day) as sales,
         (select coalesce(sum(s.amount_due), 0) from paid s where (s.paid_at at time zone 'Africa/Luanda')::date = d.day) as revenue
  from days d
)
select jsonb_build_object(
  'totals', jsonb_build_object(
    'visits', (select count(*) from visits),
    'orders', (select count(*) from created),
    'orders_paid', (select count(*) from created where status = 'paid'),
    'sales', (select count(*) from paid),
    'sales_auto', (select count(*) from paid where paid_via = 'auto'),
    'revenue', (select coalesce(sum(amount_due), 0) from paid),
    'pending_exceptions', (select count(*) from public.payment_proofs where decision = 'exception'),
    'awaiting_payment', (select count(*) from public.orders where status = 'awaiting_payment' and expires_at > now())
  ),
  'by_product', (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.revenue desc, r.orders desc), '[]'::jsonb)
    from product_rows r where r.visits + r.orders + r.sales > 0
  ),
  'by_campaign', (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.revenue desc, r.orders desc, r.visits desc), '[]'::jsonb)
    from (select * from campaign_rows order by revenue desc, orders desc, visits desc limit 30) r
  ),
  'daily', (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.day), '[]'::jsonb) from daily_rows r
  )
)
$$;

revoke all on function public.admin_dashboard(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_dashboard(timestamptz, timestamptz) to authenticated, service_role;
