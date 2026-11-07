-- Tarefas periódicas no plano grátis do Render: o Supabase chama /api/cron a cada 5 minutos.
-- O segredo é gerado aqui e fica só no Vault; a aplicação valida-o com cron_secret_ok().
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'cron_secret',
  'Autoriza o pg_cron a chamar /api/cron'
);

create or replace function public.cron_secret_ok(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'cron_secret' and decrypted_secret = p_secret)
$$;
revoke all on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

select cron.schedule(
  'kiandapay-tarefas',
  '*/5 * * * *',
  $job$
  select net.http_get(
    url := 'https://kiandapay.onrender.com/api/cron',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 90000
  )
  $job$
);
