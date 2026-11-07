-- Várias referências de pagamento; cada checkout escolhe uma (ou usa a predefinida).
create table public.payment_references (
  id          uuid primary key default gen_random_uuid(),
  label       text not null default '' check (char_length(label) <= 60),
  entity      text not null check (entity ~ '^\d{5}$'),
  reference   text not null check (reference ~ '^\d{9}$'),
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint payment_references_default_active check (not is_default or is_active)
);
create unique index payment_references_one_default on public.payment_references (is_default) where is_default;
create unique index payment_references_unique_pair on public.payment_references (entity, reference);

create trigger payment_references_updated_at before update on public.payment_references
  for each row execute function public.set_updated_at();

alter table public.payment_references enable row level security;
create policy admin_all on public.payment_references for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into public.payment_references (label, entity, reference, is_default)
select 'Principal', payment_entity, payment_reference, true
from public.settings
where payment_entity ~ '^\d{5}$' and payment_reference ~ '^\d{9}$';
