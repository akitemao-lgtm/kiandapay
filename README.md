# KiandaPay

KiandaPay — plataforma de venda de produtos digitais em Angola com Pagamento por Referência,
confirmação automática pelo comprovativo e rastreamento Meta (Pixel + CAPI).

Stack: Next.js 15 (App Router) · Supabase (Postgres, Auth, Storage) · Tailwind 4.

## Estado

- [x] 1. Modelo de dados — `supabase/migrations/`, explicado em `docs/modelo-de-dados.md`
- [x] 2. Painel de produtos e personalização do checkout
- [x] 3. Checkout e página de estado do pedido
- [x] 4. Comprovativos e Exceções
- [x] 5. Meta Pixel + CAPI
- [x] 6. Entrega e dashboard

## Configuração

1. Criar um projeto Supabase e aplicar as migrações por ordem
   (`supabase db push` com a CLI, ou colar no SQL Editor).
2. Em **Authentication → Sign In / Providers**: desligar "Allow new users to sign up".
   Em **Authentication → Multi-Factor**: TOTP ativo (vem ligado por omissão).
3. Criar o utilizador administrador em **Authentication → Users → Add user**
   e marcá-lo como administrador no SQL Editor:
   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where email = 'o-seu-email@exemplo.com';
   ```
4. Copiar `.env.example` para `.env.local` e preencher.
5. `npm install` e `npm run dev`. Abrir `/admin`: login → configurar a app
   autenticadora (primeira vez) → painel.

## Variáveis de ambiente

| Variável | Onde | Para quê |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + servidor | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + servidor | Chave pública; o acesso é limitado pelo RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | só servidor | Checkout, página do pedido e cron (chave *secret*) |
| `NEXT_PUBLIC_SITE_URL` | browser + servidor | Base dos links enviados ao lead |
| `CRON_SECRET` | só servidor | Protege `/api/cron` |
| `SMS_PROVIDER`, `WHATSAPP_PROVIDER`, `EMAIL_PROVIDER` | só servidor | `twilio` / `resend` / `log` |
| `TWILIO_*`, `RESEND_API_KEY`, `EMAIL_FROM` | só servidor | Credenciais dos provedores de mensagens |
| `META_TOKEN_ENCRYPTION_KEY` | só servidor | Cifra (AES-256-GCM) dos tokens da API de Conversões |
| `META_GRAPH_VERSION` | só servidor | Versão da Graph API (por omissão `v23.0`) |

Lista completa e comentada em `.env.example`.

## Tarefas periódicas

`GET /api/cron` com o cabeçalho `Authorization: Bearer <CRON_SECRET>` expira pedidos
fora do prazo e envia lembretes. Chamar a cada 1–5 minutos (cron-job.org, GitHub
Actions, ou `pg_cron` + `pg_net` no Supabase). O link do pedido é enviado logo ao criar
o pedido, sem depender do cron.

## Rotas públicas

| Rota | O que é |
|---|---|
| `/<slug>` | Checkout do produto |
| `/pedido/<token>` | Página de estado do pedido (pagamento, análise, entrega) |
| `/pedido/<token>/download` · `/acesso` | Entrega: link assinado de 60 s / redirecionamento, só com pedido pago |
| `/privacidade` · `/termos` | Páginas legais (editáveis em Configurações) |

## Segurança (resumo)

- `/admin` exige sessão **com 2FA** (middleware + `requireAdmin()` em cada página e
  server action + RLS `is_admin()` na base de dados).
- Leads não têm acesso direto à base de dados nem ao storage: tudo passa pelo servidor.
- PDFs vendidos e comprovativos ficam em buckets privados; só imagens do checkout são públicas.

## Verificação de comprovativos

1. O lead carrega o PDF (ou uma imagem) na página do pedido. O ficheiro vai para o bucket privado `payment-proofs`.
2. O servidor lê o PDF (pdfjs): metadados, fontes, tamanho da página, nº de gravações (`%%EOF`), texto com posições,
   texto sobreposto/escondido e QR code (renderização com `@napi-rs/canvas` + `jsqr`).
3. Extrai valor, data/hora (hora de Luanda), entidade, referência, nº da transação e ordenante.
4. Compara com o **modelo de referência** do banco/app (Painel → Modelos). Sem modelo → Exceções, nunca aprovação.
5. Decide: aprovado / rejeitado (com motivo) / Exceções. Regras em `src/lib/proofs/decide.ts`.

Para começar: em **Modelos**, carregue 2–3 comprovativos verdadeiros de cada banco/app que os seus clientes usam
(o PDF original, sem reenviar por WhatsApp). Ou aprove o primeiro comprovativo de cada formato nas **Exceções**
com “Guardar como modelo”.

`scripts/gerar-comprovativo-teste.mjs` gera comprovativos falsos do formato fictício "BancoTeste" para testar.

**Limite conhecido:** a verificação de autenticidade apanha edições comuns (editores de PDF, Word/Canva, texto tapado,
gravações posteriores), mas um falsificador que reproduza exactamente o PDF do banco pode passar. Ative o
"valor único por pedido" e cruze periodicamente com o extrato (passo de auditoria).

## Meta (Pixel + API de Conversões)

Configuração por produto em **Produtos → (produto) → Meta**: Pixel ID, token da API de Conversões (guardado cifrado,
nunca enviado ao browser), Test Event Code e moeda (AOA ou outra com taxa fixa).

| Evento | Browser (Pixel) | Servidor (CAPI) | event_id |
|---|---|---|---|
| PageView, ViewContent | página do checkout | — | — |
| InitiateCheckout | ao submeter nome e telefone | logo a seguir | `orders.initiate_checkout_event_id` |
| Purchase | página do pedido quando pago (uma vez) | quando o pedido passa a Pago | `orders.purchase_event_id` |

- O Purchase pelo servidor é enviado **uma única vez** por pedido (índice único na BD). Falhas ficam registadas com a
  resposta do Meta, são repetidas pelo cron (até 3 vezes, 7 dias) e podem ser reenviadas no detalhe do pedido.
- Dados enviados: telefone (`244…`), nome e apelido e país em SHA-256; `external_id` = ID do pedido (SHA-256);
  `_fbp`, `_fbc` (gerado a partir do `fbclid` se faltar), IP e browser do lead; valor e moeda.
- Para testar: preencha o Test Event Code, use **Enviar evento de teste** e veja em Gestor de Eventos → Testar
  eventos. Apague o código no fim, senão os eventos do servidor não contam para as campanhas.

## Entrega do produto

- **PDF:** o botão “Descarregar PDF” da página do pedido chama `/pedido/<token>/download`, que confirma o pagamento,
  gera um link assinado de **60 segundos** para o ficheiro actual (bucket privado) e regista o download com a versão.
- **Link:** o botão chama `/pedido/<token>/acesso`, que confirma o pagamento, regista o clique e redirecciona. O URL de
  acesso nunca aparece no HTML.
- Trocar o PDF ou o link no painel aplica-se de imediato a quem já comprou (versão nova; o ficheiro antigo é apagado).

## Auditoria por extrato

Painel → **Auditoria**: carregar o extrato (CSV, Excel .xlsx ou PDF), confirmar as colunas (data, valor, descrição) e
importar. Cada entrada de dinheiro é cruzada com os pedidos pagos pelo valor exato (ao cêntimo) e pela data (até 3 dias de
diferença; o n.º da transação do comprovativo, se aparecer na descrição, tem prioridade):

- **Confirmados** — pagamento encontrado;
- **Pagos sem entrada** — suspeitos: “Fraude” retira o acesso e bloqueia o número; “Encontrei” confirma à mão;
- **Entradas sem pedido** — dinheiro sem pedido pago (sugere pedidos pendentes com o mesmo valor).

Funciona melhor com **“Valor único por pedido”** ativo nas Configurações.

## Dashboard

`/admin`: checkouts iniciados, pedidos, vendas, conversão, aprovação automática, exceções, faturação por dia,
por produto e por campanha (UTM). Calculado pela função SQL `admin_dashboard` (migração 0004).

## Deploy (Render + Supabase)

1. **Supabase:** aplicar as migrações `0001`→`0004` (já aplicadas no projeto `hfkgbizyrdpjtyzbgxzt`).
   - Authentication → Sign In / Providers: desligar **Allow new users to sign up**.
   - Authentication → Attack Protection: ligar **Leaked password protection** (se o plano o permitir).
   - Authentication → URL Configuration: **Site URL** = o domínio final.
2. **Render:** New → Blueprint → escolher o repositório. O `render.yaml` cria o serviço web e o cron; o Render pede
   só os valores marcados `sync: false` (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`). Notas:
   - `NEXT_PUBLIC_SITE_URL` = `https://o-seu-dominio` (é o link enviado aos clientes);
   - `META_TOKEN_ENCRYPTION_KEY` = **a mesma** de desenvolvimento se quiser manter os tokens já guardados;
   - `CRON_SECRET` novo (`openssl rand -hex 32`);
   - provedores de mensagens (`SMS_PROVIDER`, `WHATSAPP_PROVIDER`, `EMAIL_PROVIDER` e credenciais). Não usar `log` em produção.
3. **Região:** Frankfurt, a mais próxima do Supabase (`eu-central-1`, Frankfurt).
4. **Cron:** no plano grátis do Render não há cron. Chame `/api/cron` a cada 5 minutos com um serviço externo, usando o `CRON_SECRET` do serviço web (`scripts/cron.mjs` mostra como).
5. **Domínio:** em Settings → Custom Domains do serviço `kiandapay` (e atualizar `NEXT_PUBLIC_SITE_URL` e `CRON_URL`). Os anúncios apontam para `https://o-seu-dominio/<slug-do-produto>`.

### Antes de abrir ao público

- [x] Apagar os dados de teste (feito a 16/10/2026; o próximo pedido é o #1001).
- [ ] Criar os modelos reais em **Modelos** (pelo menos Multicaixa Express e as apps dos bancos mais usados).
- [ ] Configurar o Meta em cada produto e validar com o Test Event Code; depois **apagar o Test Event Code**.
- [ ] Preencher Configurações (nome da loja, suporte, notificações) e as páginas de Privacidade e Termos.
- [ ] Fazer uma compra real de ponta a ponta com um valor pequeno.

## Testes

```bash
npm test
```

130 testes (Vitest) em `tests/`: leitura de valores, datas e campos dos comprovativos; todas as regras de decisão e
verificações de autenticidade; análise de PDFs gerados (original, valor tapado, gravação acrescentada) até à decisão;
leitura de extratos (CSV, Excel, PDF) e cruzamento com os pedidos. O GitHub Actions (`.github/workflows/ci.yml`) corre
lint, testes e build em cada push.

## Scripts

- `scripts/analisar-comprovativo.mts` — corre a análise da app sobre um PDF local:
  `npx tsx --conditions=react-server scripts/analisar-comprovativo.mts caminho.pdf`
- `scripts/criar-modelo.mts` — cria ou alarga um modelo a partir de um PDF verdadeiro:
  `npx tsx --conditions=react-server scripts/criar-modelo.mts ficheiro.pdf mcx_express express "Multicaixa Express" "MULTICAIXA Express"`
- `scripts/gerar-comprovativo-teste.mjs` — gera comprovativos falsos do formato fictício “BancoTeste”.
