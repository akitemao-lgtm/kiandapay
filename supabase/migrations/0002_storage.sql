-- =====================================================================
-- 0002 — Buckets de storage
-- Só product-media é público (imagens, logos, banners do checkout).
-- Tudo o resto é privado e servido por links assinados de curta duração
-- gerados no servidor.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-media',   'product-media',   true,  5242880,  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('product-files',   'product-files',   false, 104857600, array['application/pdf']),
  ('payment-proofs',  'payment-proofs',  false, 10485760,  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic']),
  ('proof-templates', 'proof-templates', false, 10485760,  array['application/pdf', 'image/png', 'image/jpeg']),
  ('statements',      'statements',      false, 20971520,  array['text/csv', 'application/pdf',
                                                               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                                               'application/vnd.ms-excel'])
on conflict (id) do nothing;

-- Administrador (com 2FA) gere todos os ficheiros; leads não têm acesso directo.
create policy admin_storage_all on storage.objects
  for all to authenticated
  using (bucket_id in ('product-media', 'product-files', 'payment-proofs', 'proof-templates', 'statements') and public.is_admin())
  with check (bucket_id in ('product-media', 'product-files', 'payment-proofs', 'proof-templates', 'statements') and public.is_admin());
