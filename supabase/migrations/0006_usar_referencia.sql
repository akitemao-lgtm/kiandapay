-- Põe uma referência em uso e copia-a para settings, numa só transacção.
-- security invoker: corre com as permissões do admin (RLS admin_all).
create or replace function public.use_payment_reference(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare r public.payment_references%rowtype;
begin
  select * into r from public.payment_references where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if not r.is_active then raise exception 'inactive'; end if;
  update public.payment_references set is_default = false where is_default and id <> p_id;
  update public.payment_references set is_default = true where id = p_id and not is_default;
  update public.settings set payment_entity = r.entity, payment_reference = r.reference where id;
end $$;

revoke all on function public.use_payment_reference(uuid) from public, anon;
grant execute on function public.use_payment_reference(uuid) to authenticated;
