-- Aprovação automática de comprovativos em imagem.
--
-- A imagem passa a ser lida e decidida como um PDF: modelo reconhecido, dados lidos
-- em leituras iguais, entidade, referência, valor e data certos, e pagamento nunca
-- apresentado noutro pedido. Ver src/lib/proofs/receipt-text.ts e receipt-checks.ts.

-- Hora a que o telemóvel fez a captura (EXIF), como o ficheiro a traz: hora local, sem fuso.
-- Serve para reconhecer o mesmo ecrã enviado outra vez, mesmo cortado ou gravado de novo.
alter table public.payment_proofs add column if not exists capture_taken_at text;

-- Regra 4, aplicada também às imagens: o mesmo pagamento só pode estar aprovado uma vez.
-- São índices únicos (não apenas consultas) porque dois envios em simultâneo, em instâncias
-- diferentes, leriam ambos "nenhum outro pedido tem este pagamento" antes de qualquer um gravar.
create unique index if not exists payment_proofs_payment_approved
  on public.payment_proofs (owner_id, ext_paid_at, ext_amount)
  where decision = 'approved' and ext_paid_at is not null and ext_amount is not null;

create unique index if not exists payment_proofs_capture_approved
  on public.payment_proofs (owner_id, capture_taken_at)
  where decision = 'approved' and capture_taken_at is not null;

create index if not exists payment_proofs_capture
  on public.payment_proofs (owner_id, capture_taken_at)
  where capture_taken_at is not null and decision <> 'rejected';

-- Aceitar ecrãs que não mostram a data do pagamento, usando a hora da captura.
--
-- Desligado por omissão, de propósito. Num ecrã sem data, tudo o que o comprovativo
-- mostra (entidade, referência, valor) está na página do pedido, à vista do cliente, e a
-- hora da captura é um dado do ficheiro que se pode alterar ou renovar tirando o ecrã
-- outra vez. Ligado, um pagamento pode ser apresentado em mais do que um pedido.
alter table public.settings add column if not exists allow_screenshot_time boolean not null default false;

comment on column public.payment_proofs.capture_taken_at is
  'Hora local da captura de ecrã (EXIF), "AAAA-MM-DDTHH:MM:SS". Qualquer pessoa a pode alterar.';
comment on column public.settings.allow_screenshot_time is
  'Aprovar automaticamente ecrãs sem a data do pagamento, pela hora da captura. Menos seguro: ver 0014.';
