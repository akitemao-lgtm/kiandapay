-- Prova que uma conta não vê nem altera os dados de outra. Correr no SQL Editor.
-- Termina sempre com um erro: "ISOLAMENTO OK" (passou, nada fica gravado) ou
-- "FALHOU: ..." (qual a regra que não se cumpriu).
do $$
declare
  admin uuid := (select user_id from public.profiles where is_platform_admin limit 1);
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  pa uuid; pb uuid; la uuid; lb uuid; oa uuid; ob uuid; ref_a uuid; ref_b uuid; n int;
  phone text := '244900000099';
  as_user text := 'select set_config(''request.jwt.claims'', %L, true), set_config(''role'', ''authenticated'', true)';
  as_service text := 'select set_config(''role'', ''postgres'', true), set_config(''request.jwt.claims'', '''', true)';
begin
  -- Registo: conta pendente, configurações próprias e aviso ao dono da plataforma
  select count(*) into n from public.admin_notifications where type = 'new_account' and owner_id = admin;
  insert into auth.users (id, email, raw_user_meta_data, aud, role) values
    (a, 'a@exemplo.invalid', '{"display_name":"Vendedor A","phone":"900000001"}', 'authenticated', 'authenticated'),
    (b, 'b@exemplo.invalid', '{"display_name":"Vendedor B"}', 'authenticated', 'authenticated'),
    (c, 'c@exemplo.invalid', '{"display_name":"Vendedor C"}', 'authenticated', 'authenticated');
  if (select count(*) from public.profiles where user_id in (a, b, c) and status = 'pending' and not is_platform_admin) <> 3
    then raise exception 'FALHOU: conta nova devia ficar pendente'; end if;
  if (select count(*) from public.settings where owner_id in (a, b, c)) <> 3
    then raise exception 'FALHOU: conta nova sem configurações'; end if;
  if (select count(*) from public.admin_notifications where type = 'new_account' and owner_id = admin) <> n + 3
    then raise exception 'FALHOU: dono da plataforma não foi avisado'; end if;
  update public.profiles set status = 'active' where user_id in (a, b);

  -- Dados de cada vendedor
  insert into public.products (owner_id, slug, name, price, delivery_type, delivery_url, delivery_button_label) values
    (a, 'isolamento-a', 'A', 1000, 'link', 'https://exemplo.invalid', 'Abrir') returning id into pa;
  insert into public.products (owner_id, slug, name, price, delivery_type, delivery_url, delivery_button_label) values
    (b, 'isolamento-b', 'B', 1000, 'link', 'https://exemplo.invalid', 'Abrir') returning id into pb;
  insert into public.payment_references (owner_id, label, entity, reference) values (a, 'A', '11111', '111111111') returning id into ref_a;
  insert into public.payment_references (owner_id, label, entity, reference) values (b, 'B', '22222', '222222222') returning id into ref_b;

  -- O mesmo telefone é cliente das duas contas, com bloqueios independentes
  insert into public.leads (owner_id, phone, name, blocked_at) values (a, phone, 'Cliente', now()) returning id into la;
  insert into public.leads (owner_id, phone, name) values (b, phone, 'Cliente') returning id into lb;

  -- O dono do pedido vem sempre do produto, mesmo que se tente indicar outro
  insert into public.orders (owner_id, product_id, lead_id, customer_name, customer_phone, product_name, base_amount, payment_entity, payment_reference, expires_at)
    values (b, pa, la, 'Cliente', phone, 'A', 1000, '11111', '111111111', now() + interval '1 day') returning id into oa;
  insert into public.orders (product_id, lead_id, customer_name, customer_phone, product_name, base_amount, payment_entity, payment_reference, expires_at)
    values (pb, lb, 'Cliente', phone, 'B', 1000, '22222', '222222222', now() + interval '1 day') returning id into ob;
  if (select owner_id from public.orders where id = oa) <> a then raise exception 'FALHOU: pedido com dono errado'; end if;

  -- O comprovativo e o aviso herdam o dono do pedido
  insert into public.payment_proofs (order_id, lead_id, attempt_no, storage_path, mime_type, size_bytes, kind, file_sha256)
    values (oa, la, 1, oa::text || '/1.pdf', 'application/pdf', 10, 'pdf', repeat('a', 64));
  insert into public.admin_notifications (type, order_id, title) values ('exception', oa, 't');
  if (select owner_id from public.payment_proofs where order_id = oa) <> a then raise exception 'FALHOU: comprovativo com dono errado'; end if;
  if (select owner_id from public.admin_notifications where order_id = oa) <> a then raise exception 'FALHOU: aviso com dono errado'; end if;

  -- Vendedor A vê só o que é seu
  execute format(as_user, json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal1')::text);
  if (select count(*) from public.products) <> 1 then raise exception 'FALHOU: A vê produtos alheios'; end if;
  if (select count(*) from public.orders) <> 1 then raise exception 'FALHOU: A vê pedidos alheios'; end if;
  if (select count(*) from public.leads) <> 1 then raise exception 'FALHOU: A vê clientes alheios'; end if;
  if (select count(*) from public.payment_proofs) <> 1 then raise exception 'FALHOU: A não vê o seu comprovativo'; end if;
  if (select count(*) from public.settings) <> 1 then raise exception 'FALHOU: A vê configurações alheias'; end if;
  if (select count(*) from public.payment_references) <> 1 then raise exception 'FALHOU: A vê referências alheias'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'FALHOU: A vê outras contas'; end if;
  if (select count(*) from public.product_meta_settings where product_id = pb) <> 0 then raise exception 'FALHOU: A vê pixel alheio'; end if;
  if public.is_platform_admin() then raise exception 'FALHOU: A passou por dono da plataforma'; end if;

  -- Vendedor A não altera nem apaga o que é de B
  update public.products set name = 'x' where id = pb; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: A alterou produto de B'; end if;
  delete from public.orders where id = ob; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: A apagou pedido de B'; end if;
  update public.settings set payment_reference = '999999999' where owner_id = b; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: A alterou a referência de B'; end if;
  update public.profiles set status = 'active', is_platform_admin = true where user_id = a; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: A promoveu a própria conta'; end if;
  begin
    insert into public.products (owner_id, slug, name, price, delivery_type, delivery_url, delivery_button_label)
      values (b, 'isolamento-roubo', 'x', 1, 'link', 'https://exemplo.invalid', 'Abrir');
    raise exception 'FALHOU: A criou produto em nome de B';
  exception when insufficient_privilege then null; end;
  begin
    perform public.use_payment_reference(ref_b);
    raise exception 'FALHOU: A pôs em uso a referência de B';
  exception when raise_exception then
    if sqlerrm <> 'not_found' then raise; end if;
  end;

  -- Trocar a referência em uso só mexe na própria conta
  perform public.use_payment_reference(ref_a);
  if (select payment_reference from public.settings) <> '111111111' then raise exception 'FALHOU: troca de referência não chegou às configurações'; end if;

  -- Conta pendente não vê nem cria nada
  execute format(as_user, json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal1')::text);
  if (select count(*) from public.products) <> 0 then raise exception 'FALHOU: pendente vê produtos'; end if;
  if (select count(*) from public.settings) <> 0 then raise exception 'FALHOU: pendente vê configurações'; end if;
  begin
    insert into public.products (slug, name, price, delivery_type, delivery_url, delivery_button_label)
      values ('isolamento-c', 'x', 1, 'link', 'https://exemplo.invalid', 'Abrir');
    raise exception 'FALHOU: pendente criou produto';
  exception when insufficient_privilege then null; end;

  -- Conta suspensa deixa de ver os seus dados
  execute as_service;
  update public.profiles set status = 'suspended' where user_id = b;
  execute format(as_user, json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal1')::text);
  if (select count(*) from public.products) <> 0 then raise exception 'FALHOU: suspensa vê produtos'; end if;

  -- Vendedor que ativou 2FA tem de a usar
  execute as_service;
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
    values (gen_random_uuid(), a, 'teste', 'totp', 'verified', now(), now());
  execute format(as_user, json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal1')::text);
  if (select count(*) from public.products) <> 0 then raise exception 'FALHOU: 2FA ativada mas ignorada'; end if;
  execute format(as_user, json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2')::text);
  if (select count(*) from public.products) <> 1 then raise exception 'FALHOU: 2FA confirmada não dá acesso'; end if;

  -- Dono da plataforma: 2FA obrigatória; pelo RLS só vê a própria conta
  execute format(as_user, json_build_object('sub', admin, 'role', 'authenticated', 'aal', 'aal1')::text);
  if (select count(*) from public.products) <> 0 then raise exception 'FALHOU: dono sem 2FA vê dados'; end if;
  execute format(as_user, json_build_object('sub', admin, 'role', 'authenticated', 'aal', 'aal2')::text);
  if not public.is_platform_admin() then raise exception 'FALHOU: dono não reconhecido'; end if;
  if (select count(*) from public.products where id in (pa, pb)) <> 0 then raise exception 'FALHOU: dono vê produtos alheios pelo RLS'; end if;

  -- A lista de contas não está acessível a quem tem sessão, nem ao dono (só ao servidor)
  begin
    perform * from public.platform_accounts();
    raise exception 'FALHOU: lista de contas acessível sem ser pelo servidor';
  exception when insufficient_privilege then null; end;

  raise exception 'ISOLAMENTO OK';
end $$;
