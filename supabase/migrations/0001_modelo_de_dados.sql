-- =====================================================================
-- 0001 — Modelo de dados
-- Plataforma de venda de produtos digitais com pagamento por referência
-- Todas as datas em timestamptz (UTC na BD); a app mostra em Africa/Luanda.
-- Valores monetários em Kwanza, numeric(14,2) (exacto, sem floats).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.delivery_type      as enum ('pdf', 'link');
create type public.order_status       as enum ('awaiting_payment', 'under_review', 'paid', 'rejected', 'expired');
create type public.proof_kind         as enum ('pdf', 'image');
create type public.proof_decision     as enum ('pending', 'approved', 'rejected', 'exception');
create type public.decision_source    as enum ('auto', 'manual');
create type public.check_result       as enum ('pass', 'fail', 'warn', 'skip');
create type public.message_channel    as enum ('sms', 'whatsapp', 'email');
create type public.message_status     as enum ('scheduled', 'sent', 'failed', 'cancelled');
create type public.access_kind        as enum ('status_view', 'pdf_download', 'link_click');
create type public.reconciliation     as enum ('pending', 'matched', 'missing');

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Administrador (único) — Supabase Auth + MFA (TOTP)
-- O registo público fica desligado no Supabase; o utilizador é criado à mão
-- e inserido aqui. is_admin() exige sessão com 2FA (aal2).
-- ---------------------------------------------------------------------
create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- ---------------------------------------------------------------------
-- Configurações gerais (linha única)
-- ---------------------------------------------------------------------
create table public.settings (
  id                         boolean primary key default true check (id),
  -- Pagamento por referência (provedor "fixed_reference")
  payment_entity             text not null default '',
  payment_reference          text not null default '',
  -- Pedidos
  order_ttl_minutes          int  not null default 1440 check (order_ttl_minutes > 0),
  upload_grace_hours         int  not null default 24   check (upload_grace_hours >= 0),
  unique_amount_enabled      boolean not null default false,
  -- Anti-abuso
  max_uploads_per_order      int  not null default 3 check (max_uploads_per_order > 0),
  max_uploads_per_phone      int  not null default 3 check (max_uploads_per_phone > 0),
  phone_upload_window_hours  int  not null default 24 check (phone_upload_window_hours > 0),
  -- Mensagens ao lead (link da página de estado + lembrete)
  lead_channels              public.message_channel[] not null default '{sms}',
  reminder_enabled           boolean not null default false,
  reminder_after_minutes     int  not null default 30 check (reminder_after_minutes > 0),
  -- Notificações ao administrador (exceções, erros Meta, fraude)
  admin_channels             public.message_channel[] not null default '{email}',
  admin_email                text,
  admin_phone                text,
  -- Geral
  site_name                  text not null default '',
  support_phone              text,
  updated_at                 timestamptz not null default now()
);
insert into public.settings default values;

create table public.legal_pages (
  slug       text primary key check (slug in ('privacidade', 'termos')),
  title      text not null,
  body_md    text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.legal_pages (slug, title) values
  ('privacidade', 'Política de Privacidade'),
  ('termos',      'Termos e Condições');

-- ---------------------------------------------------------------------
-- Produtos
-- O ficheiro/link de entrega é lido sempre do produto no momento do acesso:
-- se trocar o PDF ou o link, quem já comprou recebe a versão nova.
-- ---------------------------------------------------------------------
create table public.products (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name                   text not null,
  description            text not null default '',
  price                  numeric(14,2) not null check (price > 0),
  image_path             text,                       -- bucket público product-media
  is_active              boolean not null default false,
  delivery_type          public.delivery_type not null,
  delivery_file_path     text,                       -- bucket privado product-files
  delivery_file_name     text,                       -- nome sugerido no download
  delivery_file_version  int  not null default 1,    -- incrementa a cada troca de ficheiro
  delivery_url           text,
  delivery_button_label  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint products_delivery_ok check (
       (delivery_type = 'pdf'  and delivery_file_path is not null and delivery_url is null)
    or (delivery_type = 'link' and delivery_url is not null and delivery_button_label is not null
                               and delivery_file_path is null)
  )
);

-- Personalização do checkout (1:1 com produto)
create table public.checkout_pages (
  product_id            uuid primary key references public.products (id) on delete cascade,
  logo_path             text,
  banner_path           text,
  primary_color         text not null default '#0F766E' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color          text not null default '#F59E0B' check (accent_color  ~ '^#[0-9A-Fa-f]{6}$'),
  background_color      text not null default '#FFFFFF' check (background_color ~ '^#[0-9A-Fa-f]{6}$'),
  title                 text,
  description           text,
  testimonials          jsonb not null default '[]',  -- [{name, text, photo_path?, rating?}]
  guarantee_text        text,
  timer_enabled         boolean not null default false,
  timer_minutes         int check (timer_minutes > 0),
  button_text           text not null default 'Finalizar pedido',
  payment_instructions  jsonb not null default '{}',  -- {bank_app:[passos], express:[passos], atm:[passos]}
  updated_at            timestamptz not null default now(),
  constraint checkout_timer_ok check (not timer_enabled or timer_minutes is not null)
);

-- Meta por produto. O token da CAPI fica numa tabela à parte, sem acesso
-- nenhum fora do servidor (service role), e cifrado pela app.
create table public.product_meta_settings (
  product_id       uuid primary key references public.products (id) on delete cascade,
  enabled          boolean not null default false,
  pixel_id         text check (pixel_id ~ '^[0-9]{5,20}$'),
  test_event_code  text,
  currency         char(3) not null default 'AOA',
  conversion_rate  numeric(18,8) check (conversion_rate > 0),  -- 1 AOA = x <currency>
  updated_at       timestamptz not null default now(),
  constraint meta_currency_ok check (currency = 'AOA' or conversion_rate is not null)
);

create table public.product_meta_secrets (
  product_id            uuid primary key references public.products (id) on delete cascade,
  capi_token_encrypted  text not null,   -- AES-256-GCM com META_TOKEN_ENCRYPTION_KEY
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Leads (sem conta). Identificados pelo telefone normalizado: 2449XXXXXXXX.
-- Bloqueio por fraude vive aqui.
-- ---------------------------------------------------------------------
create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null unique check (phone ~ '^2449[0-9]{8}$'),
  name            text not null,
  email           text,
  blocked_at      timestamptz,
  blocked_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Visitas ao checkout (topo do funil: clique no anúncio → página)
-- ---------------------------------------------------------------------
create table public.checkout_visits (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references public.products (id) on delete cascade,
  visitor_id            uuid not null,          -- cookie first-party
  view_content_event_id text not null default replace(gen_random_uuid()::text, '-', ''),
  fbclid                text,
  fbp                   text,
  fbc                   text,                   -- gerado a partir do fbclid se não existir cookie
  utm_source            text,
  utm_medium            text,
  utm_campaign          text,
  utm_content           text,
  utm_term              text,
  ip                    inet,
  user_agent            text,
  landing_url           text,
  referrer              text,
  created_at            timestamptz not null default now()
);
create index checkout_visits_product_created on public.checkout_visits (product_id, created_at desc);
create index checkout_visits_visitor on public.checkout_visits (visitor_id);

-- ---------------------------------------------------------------------
-- Modelos de comprovativos (um por banco/app/versão de layout)
-- ---------------------------------------------------------------------
create table public.proof_templates (
  id                     uuid primary key default gen_random_uuid(),
  bank_code              text not null,   -- bai, bfa, bic, atlantico, millennium, sol, keve, bpc, mcx_express, ...
  channel                text not null check (channel in ('app', 'express', 'atm', 'internet_banking', 'outro')),
  name                   text not null,   -- ex.: "BAI Directo — app (2026)"
  version                int  not null default 1,
  is_active              boolean not null default true,
  allows_auto_approve    boolean not null default true,
  detection              jsonb not null default '{}',  -- {keywords:[], producer_regex, ...}
  fingerprint            jsonb not null default '{}',  -- {producer, creator, pdf_version, fonts:[], page_size:[w,h], page_count, structure}
  field_rules            jsonb not null default '{}',  -- {amount:{regex,bbox}, paid_at:{...}, entity, reference, transaction_id, payer_name}
  qr_rules               jsonb,                        -- como ler e comparar QR/código de verificação
  created_from_proof_id  uuid,                         -- FK adicionada abaixo
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (bank_code, channel, version)
);

-- Comprovativos verdadeiros carregados como referência
create table public.proof_template_samples (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid references public.proof_templates (id) on delete set null,
  bank_code     text not null,
  storage_path  text not null,                 -- bucket privado proof-templates
  file_sha256   text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_meta      jsonb not null default '{}',
  extracted     jsonb not null default '{}',
  notes         text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------
create sequence public.order_number_seq start 1001;

create table public.orders (
  id                        uuid primary key default gen_random_uuid(),
  order_number              bigint not null unique default nextval('public.order_number_seq'),
  public_token              text   not null unique
                              default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  product_id                uuid not null references public.products (id) on delete restrict,
  lead_id                   uuid not null references public.leads (id) on delete restrict,
  visit_id                  uuid references public.checkout_visits (id) on delete set null,
  status                    public.order_status not null default 'awaiting_payment',

  -- Fotografia no momento do pedido
  customer_name             text not null,
  customer_phone            text not null check (customer_phone ~ '^2449[0-9]{8}$'),
  customer_email            text,
  product_name              text not null,
  base_amount               numeric(14,2) not null check (base_amount > 0),
  unique_offset             smallint not null default 0 check (unique_offset between 0 and 99),
  amount_due                numeric(14,2) generated always as (base_amount + unique_offset) stored,
  currency                  char(3) not null default 'AOA',

  -- Camada de pagamento modular: hoje "fixed_reference"; amanhã um gateway
  -- com referência dinâmica + webhook preenche provider_* sem mudar o resto.
  payment_provider          text not null default 'fixed_reference',
  payment_entity            text not null,
  payment_reference         text not null,
  provider_payment_id       text,
  provider_data             jsonb not null default '{}',

  expires_at                timestamptz not null,
  paid_at                   timestamptz,
  paid_via                  public.decision_source,
  approved_proof_id         uuid,             -- FK adicionada abaixo
  rejected_reason           text,

  -- Rastreamento
  fbclid                    text,
  fbp                       text,
  fbc                       text,
  utm_source                text,
  utm_medium                text,
  utm_campaign              text,
  utm_content               text,
  utm_term                  text,
  ip                        inet,
  user_agent                text,
  source_url                text,
  referrer                  text,

  -- Meta: event_ids fixos por pedido → deduplicação Pixel/CAPI
  initiate_checkout_event_id text not null unique default 'ic_'  || replace(gen_random_uuid()::text, '-', ''),
  purchase_event_id          text not null unique default 'pur_' || replace(gen_random_uuid()::text, '-', ''),
  purchase_capi_sent_at      timestamptz,
  purchase_pixel_fired_at    timestamptz,

  -- Contadores / auditoria
  upload_count              int not null default 0,
  reconciliation            public.reconciliation,
  reconciled_import_id      uuid,             -- FK adicionada abaixo
  reconciled_at             timestamptz,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint orders_paid_ok check (status <> 'paid' or (paid_at is not null and paid_via is not null))
);
create index orders_status_created  on public.orders (status, created_at desc);
create index orders_product_created on public.orders (product_id, created_at desc);
create index orders_lead            on public.orders (lead_id);
create index orders_campaign        on public.orders (utm_campaign) where utm_campaign is not null;
create index orders_expiry          on public.orders (expires_at) where status = 'awaiting_payment';
-- "Valor único por pedido": nenhum valor repetido entre pedidos pendentes
create unique index orders_unique_pending_amount on public.orders (amount_due)
  where unique_offset > 0 and status in ('awaiting_payment', 'under_review');

-- ---------------------------------------------------------------------
-- Comprovativos carregados
-- ---------------------------------------------------------------------
create table public.payment_proofs (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders (id) on delete cascade,
  lead_id               uuid not null references public.leads (id),
  attempt_no            smallint not null check (attempt_no > 0),
  storage_path          text not null,         -- bucket privado payment-proofs
  original_filename     text,
  mime_type             text not null,
  size_bytes            int  not null check (size_bytes > 0),
  kind                  public.proof_kind not null,
  file_sha256           text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  duplicate_of          uuid references public.payment_proofs (id),

  -- Identificação e extracção
  template_id           uuid references public.proof_templates (id) on delete set null,
  bank_code             text,
  ext_amount            numeric(14,2),
  ext_paid_at           timestamptz,
  ext_entity            text,
  ext_reference         text,
  ext_transaction_id    text,                  -- normalizado (maiúsculas, sem espaços)
  ext_payer_name        text,
  ext_raw               jsonb not null default '{}',   -- texto e posições
  pdf_meta              jsonb not null default '{}',   -- producer, creator, versão, datas, fontes, página, n.º xref/%%EOF
  qr_payload            text,

  -- Decisão
  decision              public.proof_decision not null default 'pending',
  decision_source       public.decision_source,
  decision_reason_code  text,
  decision_reason       text,                  -- texto mostrado ao lead / no painel
  fraud_suspected       boolean not null default false,
  decided_at            timestamptz,
  decided_by            uuid references auth.users (id),
  review_note           text,
  saved_as_template_id  uuid references public.proof_templates (id) on delete set null,

  ip                    inet,
  user_agent            text,
  created_at            timestamptz not null default now(),

  unique (order_id, attempt_no),
  constraint proofs_duplicate_ok check (duplicate_of is null or decision in ('pending', 'rejected')),
  constraint proofs_decided_ok   check (decision = 'pending' or decision_source is not null)
);
create index payment_proofs_order     on public.payment_proofs (order_id, created_at desc);
create index payment_proofs_lead      on public.payment_proofs (lead_id, created_at desc);
create index payment_proofs_sha       on public.payment_proofs (file_sha256);
create index payment_proofs_txn       on public.payment_proofs (ext_transaction_id) where ext_transaction_id is not null;
create index payment_proofs_exception on public.payment_proofs (created_at) where decision = 'exception';
-- Regra 5: só pode existir um "original" por hash; repetições apontam para ele
create unique index payment_proofs_sha_original on public.payment_proofs (file_sha256) where duplicate_of is null;
-- Regra 4: um número de transacção só pode estar aprovado uma vez
create unique index payment_proofs_txn_approved
  on public.payment_proofs (coalesce(bank_code, ''), ext_transaction_id)
  where decision = 'approved' and ext_transaction_id is not null;

-- Resultado de cada verificação (regras + autenticidade)
create table public.proof_checks (
  id          bigint generated always as identity primary key,
  proof_id    uuid not null references public.payment_proofs (id) on delete cascade,
  check_code  text not null,   -- entity_reference, amount, paid_at_window, txn_unique, file_unique,
                               -- template_known, producer, mod_date, incremental_updates, fonts,
                               -- page_layout, hidden_text, qr_match
  result      public.check_result not null,
  effect      text not null default 'none' check (effect in ('none', 'reject', 'exception')),
  message     text,
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  unique (proof_id, check_code)
);

alter table public.orders
  add constraint orders_approved_proof_fk
  foreign key (approved_proof_id) references public.payment_proofs (id) on delete set null;
alter table public.proof_templates
  add constraint proof_templates_source_fk
  foreign key (created_from_proof_id) references public.payment_proofs (id) on delete set null;

-- ---------------------------------------------------------------------
-- Eventos Meta (Pixel + CAPI)
-- source = 'server' → envio CAPI (com resposta); 'browser' → Pixel disparado
-- (reportado pelo browser após fbq). Payload guardado já com hashes, sem token.
-- ---------------------------------------------------------------------
create table public.meta_events (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products (id) on delete cascade,
  order_id         uuid references public.orders (id) on delete cascade,
  visit_id         uuid references public.checkout_visits (id) on delete set null,
  event_name       text not null check (event_name in ('PageView', 'ViewContent', 'InitiateCheckout', 'Purchase')),
  event_id         text not null,
  source           text not null check (source in ('browser', 'server')),
  trigger          text not null default 'auto' check (trigger in ('auto', 'manual_approval', 'manual_resend', 'status_page')),
  pixel_id         text,
  test_event_code  text,
  value            numeric(18,2),
  currency         char(3),
  request_payload  jsonb,
  response_status  int,
  response_body    jsonb,
  fbtrace_id       text,
  status           text not null default 'pending' check (status in ('pending', 'success', 'error')),
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index meta_events_order on public.meta_events (order_id, created_at desc);
create index meta_events_errors on public.meta_events (created_at desc) where status = 'error';
-- Idempotência: um único Purchase CAPI em curso/bem-sucedido por pedido
create unique index meta_events_purchase_once on public.meta_events (order_id)
  where event_name = 'Purchase' and source = 'server' and status in ('pending', 'success');

-- ---------------------------------------------------------------------
-- Entrega e histórico do pedido
-- ---------------------------------------------------------------------
create table public.order_access_logs (
  id            bigint generated always as identity primary key,
  order_id      uuid not null references public.orders (id) on delete cascade,
  kind          public.access_kind not null,
  file_version  int,
  ip            inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index order_access_logs_order on public.order_access_logs (order_id, created_at desc);

create table public.order_events (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references public.orders (id) on delete cascade,
  type         text not null,                 -- status_changed, proof_uploaded, message_sent, ...
  from_status  public.order_status,
  to_status    public.order_status,
  actor        text not null default 'system' check (actor in ('system', 'admin', 'lead')),
  data         jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index order_events_order on public.order_events (order_id, created_at);

create or replace function public.log_order_status()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events (order_id, type, to_status)
    values (new.id, 'created', new.status);
  elsif new.status is distinct from old.status then
    insert into public.order_events (order_id, type, from_status, to_status)
    values (new.id, 'status_changed', old.status, new.status);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Mensagens (SMS / WhatsApp / email) e notificações do painel
-- Ao lead envia-se SEMPRE o link da página de estado, nunca o produto.
-- ---------------------------------------------------------------------
create table public.outbound_messages (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid references public.orders (id) on delete cascade,
  audience             text not null check (audience in ('lead', 'admin')),
  channel              public.message_channel not null,
  template             text not null,   -- status_link, reminder, admin_exception, admin_meta_error, ...
  recipient            text not null,
  body                 text not null,
  status               public.message_status not null default 'scheduled',
  scheduled_for        timestamptz not null default now(),
  sent_at              timestamptz,
  provider             text,
  provider_message_id  text,
  error                text,
  created_at           timestamptz not null default now()
);
create index outbound_messages_due on public.outbound_messages (scheduled_for) where status = 'scheduled';
create index outbound_messages_order on public.outbound_messages (order_id);

create table public.admin_notifications (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('exception', 'meta_error', 'fraud_block', 'reconciliation')),
  order_id    uuid references public.orders (id) on delete cascade,
  proof_id    uuid references public.payment_proofs (id) on delete cascade,
  title       text not null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index admin_notifications_unread on public.admin_notifications (created_at desc) where read_at is null;

-- ---------------------------------------------------------------------
-- Auditoria por extracto bancário (opcional)
-- ---------------------------------------------------------------------
create table public.bank_statement_imports (
  id              uuid primary key default gen_random_uuid(),
  storage_path    text not null,    -- bucket privado statements
  file_format     text not null check (file_format in ('csv', 'xlsx', 'pdf')),
  period_start    date,
  period_end      date,
  line_count      int not null default 0,
  matched_count   int not null default 0,
  missing_count   int not null default 0,
  status          text not null default 'processing' check (status in ('processing', 'done', 'error')),
  error           text,
  created_at      timestamptz not null default now()
);

create table public.bank_statement_lines (
  id                bigint generated always as identity primary key,
  import_id         uuid not null references public.bank_statement_imports (id) on delete cascade,
  booked_at         timestamptz,
  amount            numeric(14,2) not null,
  description       text,
  reference         text,
  transaction_id    text,
  matched_order_id  uuid references public.orders (id) on delete set null,
  raw               jsonb not null default '{}'
);
create index bank_statement_lines_import on public.bank_statement_lines (import_id);
create index bank_statement_lines_txn on public.bank_statement_lines (transaction_id) where transaction_id is not null;

alter table public.orders
  add constraint orders_reconciled_import_fk
  foreign key (reconciled_import_id) references public.bank_statement_imports (id) on delete set null;

-- ---------------------------------------------------------------------
-- Rate limiting (checkout, uploads) — janela fixa, chamado pelo servidor
-- ---------------------------------------------------------------------
create table public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          int not null default 0,
  primary key (key, window_start)
);

create or replace function public.rate_limit_hit(p_key text, p_window_seconds int, p_max int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits   int;
begin
  insert into public.rate_limits (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

-- Expira pedidos sem pagamento (agendado por pg_cron ou cron da Vercel)
create or replace function public.expire_orders()
returns int language sql security definer set search_path = '' as $$
  with expired as (
    update public.orders set status = 'expired'
    where status = 'awaiting_payment' and expires_at < now()
    returning 1
  )
  select count(*)::int from expired
$$;

-- ---------------------------------------------------------------------
-- Vistas para o painel
-- ---------------------------------------------------------------------
create view public.v_pending_exceptions with (security_invoker = true) as
select p.id as proof_id, p.created_at, p.decision_reason_code, p.decision_reason,
       p.bank_code, p.ext_amount, p.ext_paid_at, p.ext_transaction_id, p.kind,
       o.id as order_id, o.order_number, o.amount_due, o.customer_name, o.customer_phone,
       o.product_name, o.created_at as order_created_at, o.expires_at
from public.payment_proofs p
join public.orders o on o.id = p.order_id
where p.decision = 'exception';

create view public.v_daily_funnel with (security_invoker = true) as
with v as (
  select product_id, (created_at at time zone 'Africa/Luanda')::date as day, count(*) as visits
  from public.checkout_visits group by 1, 2
), o as (
  select product_id, (created_at at time zone 'Africa/Luanda')::date as day,
         count(*) as orders,
         count(*) filter (where status = 'paid') as paid,
         count(*) filter (where status = 'paid' and paid_via = 'auto') as paid_auto,
         coalesce(sum(amount_due) filter (where status = 'paid'), 0) as revenue
  from public.orders group by 1, 2
)
select coalesce(v.product_id, o.product_id) as product_id,
       coalesce(v.day, o.day) as day,
       coalesce(v.visits, 0) as visits,
       coalesce(o.orders, 0) as orders,
       coalesce(o.paid, 0) as paid,
       coalesce(o.paid_auto, 0) as paid_auto,
       coalesce(o.revenue, 0) as revenue
from v full join o on o.product_id = v.product_id and o.day = v.day;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create trigger settings_updated_at              before update on public.settings              for each row execute function public.set_updated_at();
create trigger legal_pages_updated_at           before update on public.legal_pages           for each row execute function public.set_updated_at();
create trigger products_updated_at              before update on public.products              for each row execute function public.set_updated_at();
create trigger checkout_pages_updated_at        before update on public.checkout_pages        for each row execute function public.set_updated_at();
create trigger product_meta_settings_updated_at before update on public.product_meta_settings for each row execute function public.set_updated_at();
create trigger product_meta_secrets_updated_at  before update on public.product_meta_secrets  for each row execute function public.set_updated_at();
create trigger leads_updated_at                 before update on public.leads                 for each row execute function public.set_updated_at();
create trigger proof_templates_updated_at       before update on public.proof_templates       for each row execute function public.set_updated_at();
create trigger orders_updated_at                before update on public.orders                for each row execute function public.set_updated_at();
create trigger orders_log_status                after insert or update of status on public.orders for each row execute function public.log_order_status();

-- ---------------------------------------------------------------------
-- Segurança (RLS)
-- Público (leads): ZERO acesso directo. Tudo passa por rotas do servidor
-- Next.js com a service role, que só devolvem os campos necessários
-- (ex.: delivery_url nunca sai antes de status = 'paid').
-- Administrador: acesso via is_admin() (exige 2FA), excepto segredos.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'admin_users', 'settings', 'legal_pages', 'products', 'checkout_pages',
    'product_meta_settings', 'product_meta_secrets', 'leads', 'checkout_visits',
    'proof_templates', 'proof_template_samples', 'orders', 'payment_proofs',
    'proof_checks', 'meta_events', 'order_access_logs', 'order_events',
    'outbound_messages', 'admin_notifications', 'bank_statement_imports',
    'bank_statement_lines', 'rate_limits'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    if t not in ('product_meta_secrets', 'rate_limits', 'admin_users') then
      execute format(
        'create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    end if;
  end loop;
end $$;

revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
revoke all on function public.expire_orders() from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
grant execute on function public.expire_orders() to service_role;
