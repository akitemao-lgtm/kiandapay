-- Prova os eventos e o isolamento dos webhooks. Correr no SQL Editor.
-- Termina sempre com um erro: "WEBHOOKS OK" (passou, nada fica gravado) ou "FALHOU: ...".
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  pa uuid; pa2 uuid; pa3 uuid; la uuid; oa uuid; oa2 uuid; ea uuid; eb uuid; ep1 uuid; ep2 uuid; ep3 uuid; n int;
  as_user text := 'select set_config(''request.jwt.claims'', %L, true), set_config(''role'', ''authenticated'', true)';
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'wa@exemplo.invalid', 'authenticated', 'authenticated'), (b, 'wb@exemplo.invalid', 'authenticated', 'authenticated');
  update public.profiles set status = 'active' where user_id in (a, b);
  insert into public.products (owner_id, slug, name, price, delivery_type, delivery_url, delivery_button_label)
    values (a, 'webhook-a', 'Produto A', 1000, 'link', 'https://exemplo.invalid/segredo', 'Abrir') returning id into pa;
  insert into public.leads (owner_id, phone, name) values (a, '244900000098', 'Cliente') returning id into la;

  -- A: só quer "pago"; A2: quer tudo mas está desativado; B: outra conta, quer tudo
  insert into public.webhook_endpoints (owner_id, url, events, secret_encrypted)
    values (a, 'https://exemplo.invalid/a', '{order.paid}', 'x') returning id into ea;
  insert into public.webhook_endpoints (owner_id, url, events, secret_encrypted, is_active)
    values (a, 'https://exemplo.invalid/a2', '{order.created,order.paid}', 'x', false);
  insert into public.webhook_endpoints (owner_id, url, events, secret_encrypted)
    values (b, 'https://exemplo.invalid/b', '{order.created,order.paid,order.expired}', 'x') returning id into eb;

  insert into public.orders (product_id, lead_id, customer_name, customer_phone, product_name, base_amount, payment_entity, payment_reference, expires_at)
    values (pa, la, 'Cliente', '244900000098', 'Produto A', 1000, '11111', '111111111', now() + interval '1 day') returning id into oa;
  if exists (select 1 from public.webhook_deliveries where order_id = oa)
    then raise exception 'FALHOU: pedido criado enviou a quem só quer pago, a desativado ou a outra conta'; end if;

  update public.orders set status = 'paid', paid_at = now(), paid_via = 'manual' where id = oa;
  select count(*) into n from public.webhook_deliveries where order_id = oa;
  if n <> 1 then raise exception 'FALHOU: esperava 1 envio, houve %', n; end if;
  if (select endpoint_id from public.webhook_deliveries where order_id = oa) <> ea then raise exception 'FALHOU: envio para o webhook errado'; end if;
  if (select payload #>> '{order,status}' from public.webhook_deliveries where order_id = oa) <> 'paid' then raise exception 'FALHOU: dados do pedido'; end if;
  if (select payload #>> '{product,slug}' from public.webhook_deliveries where order_id = oa) <> 'webhook-a' then raise exception 'FALHOU: dados do produto'; end if;
  if (select payload::text like '%segredo%' or payload::text like '%public_token%' from public.webhook_deliveries where order_id = oa)
    then raise exception 'FALHOU: payload com o link de entrega do produto'; end if;

  -- Alterar outro campo não gera evento
  update public.orders set rejected_reason = 'x' where id = oa;
  if (select count(*) from public.webhook_deliveries where order_id = oa) <> 1 then raise exception 'FALHOU: evento repetido'; end if;

  -- Webhook de um produto só recebe esse produto; o geral recebe todos
  insert into public.products (owner_id, slug, name, price, delivery_type, delivery_url, delivery_button_label)
    values (a, 'webhook-a2', 'Produto A2', 1000, 'link', 'https://exemplo.invalid/x', 'Abrir') returning id into pa2;
  insert into public.products (owner_id, slug, name, price, delivery_type, delivery_url, delivery_button_label)
    values (a, 'webhook-a3', 'Produto A3', 1000, 'link', 'https://exemplo.invalid/x', 'Abrir') returning id into pa3;
  insert into public.webhook_endpoints (owner_id, product_id, url, events, secret_encrypted)
    values (a, pa, 'https://exemplo.invalid/p1', '{order.paid}', 'x') returning id into ep1;
  insert into public.webhook_endpoints (owner_id, product_id, url, events, secret_encrypted)
    values (a, pa2, 'https://exemplo.invalid/p2', '{order.paid}', 'x') returning id into ep2;
  insert into public.orders (product_id, lead_id, customer_name, customer_phone, product_name, base_amount, payment_entity, payment_reference, expires_at, status, paid_at, paid_via)
    values (pa2, la, 'Cliente', '244900000098', 'Produto A2', 1000, '11111', '111111111', now() + interval '1 day', 'paid', now(), 'manual') returning id into oa2;
  update public.orders set status = 'rejected' where id = oa2;
  update public.orders set status = 'paid' where id = oa2;
  if (select count(*) from public.webhook_deliveries where order_id = oa2) <> 2 then raise exception 'FALHOU: esperava o geral e o do produto'; end if;
  if not exists (select 1 from public.webhook_deliveries where order_id = oa2 and endpoint_id = ep2) then raise exception 'FALHOU: webhook do produto não recebeu'; end if;
  if not exists (select 1 from public.webhook_deliveries where order_id = oa2 and endpoint_id = ea) then raise exception 'FALHOU: webhook geral não recebeu'; end if;
  if exists (select 1 from public.webhook_deliveries where order_id = oa2 and endpoint_id = ep1) then raise exception 'FALHOU: webhook de outro produto recebeu'; end if;

  -- Não se liga a um produto de outra conta, e apagar o produto apaga o webhook
  begin
    insert into public.webhook_endpoints (owner_id, product_id, url, events, secret_encrypted) values (b, pa, 'https://exemplo.invalid/r', '{order.paid}', 'x');
    raise exception 'FALHOU: webhook ligado a produto de outra conta';
  exception when foreign_key_violation then null; end;
  insert into public.webhook_endpoints (owner_id, product_id, url, events, secret_encrypted)
    values (a, pa3, 'https://exemplo.invalid/p3', '{order.paid}', 'x') returning id into ep3;
  delete from public.products where id = pa3;
  if exists (select 1 from public.webhook_endpoints where id = ep3) then raise exception 'FALHOU: webhook ficou sem produto'; end if;

  -- B não vê os webhooks de A nem o histórico
  execute format(as_user, json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal1')::text);
  if (select count(*) from public.webhook_endpoints) <> 1 then raise exception 'FALHOU: B vê webhooks alheios'; end if;
  if (select count(*) from public.webhook_deliveries) <> 0 then raise exception 'FALHOU: B vê envios alheios'; end if;

  -- Ninguém escreve diretamente: nem forjar envios com o segredo alheio, nem contornar a validação do URL
  begin
    insert into public.webhook_deliveries (endpoint_id, owner_id, event, payload) values (ea, b, 'order.paid', '{}');
    raise exception 'FALHOU: B forjou um envio';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.webhook_endpoints (owner_id, url, events, secret_encrypted) values (b, 'https://127.0.0.1/x', '{order.paid}', 'x');
    raise exception 'FALHOU: B criou webhook sem passar pelo servidor';
  exception when insufficient_privilege then null; end;
  update public.webhook_endpoints set url = 'https://127.0.0.1/x' where id = eb; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: B alterou o URL sem passar pelo servidor'; end if;
  delete from public.webhook_deliveries; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: B apagou envios'; end if;

  -- A vê o seu histórico
  execute format(as_user, json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal1')::text);
  if (select count(*) from public.webhook_deliveries where order_id = oa) <> 1 then raise exception 'FALHOU: A não vê os seus envios'; end if;

  raise exception 'WEBHOOKS OK';
end $$;
