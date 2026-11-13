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
| `META_GRAPH_VERSION` | só servidor | Versão da Graph API (por omissão `v27.0`) |

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

O lead carrega o ficheiro na página do pedido (bucket privado `payment-proofs`). Daí em diante o caminho depende
de ser um PDF ou uma imagem, porque a prova que cada um dá é diferente.

### PDF

1. O servidor lê o PDF (pdfjs): metadados, fontes, tamanho da página, nº de gravações (`%%EOF`), texto com posições,
   texto sobreposto/escondido e QR code (renderização com `@napi-rs/canvas` + `jsqr`).
2. Extrai valor, data/hora (hora de Luanda), entidade, referência, nº da transação e ordenante.
3. Compara com o **modelo de referência** do banco/app (Painel → Modelos). Sem modelo → Exceções, nunca aprovação.
4. Decide: aprovado / rejeitado (com motivo) / Exceções. Regras em `src/lib/proofs/decide.ts`.

### Imagem (captura de ecrã ou fotografia)

Uma imagem não prova de onde veio, por isso a decisão assenta no que ela diz e em cruzar isso com o pedido.
O texto é lido com OCR (`tesseract.js`) até três vezes, com contrastes diferentes, porque o OCR troca caracteres:
**um dado só conta quando duas leituras o dizem igual** (`src/lib/proofs/ocr.ts`, `receipt-text.ts`).

Só se aprova sozinha quando **tudo** isto se confirma (`src/lib/proofs/receipt-checks.ts`):

| Verificação | O que exige |
| --- | --- |
| Modelo | Um dos ecrãs conhecidos: Multicaixa Express (pagamento realizado, detalhe do pagamento, comprovativo digital) ou BAI Directo |
| Operação | O comprovativo diz que foi concluída com sucesso |
| Dados lidos | Entidade, referência e valor lidos em leituras iguais e, nos modelos que os repetem (o campo e o texto do recibo da entidade), iguais nos dois sítios. O “detalhe do pagamento” só os mostra uma vez |
| Entidade e referência | As do pedido, ou as de um pedido anterior do mesmo cliente ainda por pagar |
| Valor | Exactamente o do pedido (a mais vai para Exceções, a menos é recusado) |
| Data | Dentro do prazo do pedido e nunca posterior ao envio |
| Repetição | Nenhum outro pedido com um comprovativo do mesmo pagamento |
| Captura | O ecrã foi fotografado depois do pagamento, e não por um programa de edição |

Qualquer dúvida deixa o comprovativo em **Exceções**. Uma imagem nunca rejeita sozinha: um erro de leitura não pode
recusar quem pagou. Quem rejeita é a regra do ficheiro repetido (mesmo `sha256`) e, no caso dos PDF, as regras de
`decide.ts`.

**Ecrãs sem a data do pagamento.** Muitos clientes cortam o topo do ecrã do Multicaixa, onde está a data. Por
omissão esses comprovativos vão todos para Exceções, e é a opção segura: num ecrã sem data, tudo o resto que o
comprovativo mostra — entidade, referência e valor — está escrito na página do pedido, à vista do cliente, por isso
nada ali prende aquele ecrã àquele pagamento. *Aceitar ecrãs sem a data do pagamento* (Configurações) aprova-os pela
hora a que o telemóvel fez a captura (EXIF) e impede que a mesma captura sirva dois pedidos; mas a hora da captura
está no ficheiro, pode ser alterada, e renova-se tirando o ecrã outra vez — com a opção ligada, o mesmo pagamento
pode acabar aprovado em mais do que um pedido. Só com a auditoria do extrato em dia.

**Quem pagou antes de abrir o pedido.** É comum pagar e só depois criar o pedido, ou pagar um pedido que entretanto
expirou. Por isso o comprovativo também é aceite contra pedidos anteriores do mesmo cliente, do mesmo valor e ainda
dentro do prazo de envio — em vez de ser recusado por “pagamento anterior à criação do pedido”.

Para começar: em **Modelos**, carregue 2–3 comprovativos verdadeiros de cada banco/app que os seus clientes usam
(o PDF original, sem reenviar por WhatsApp). Ou aprove o primeiro comprovativo de cada formato nas **Exceções**
com “Guardar como modelo”.

`scripts/gerar-comprovativo-teste.mjs` gera comprovativos falsos do formato fictício "BancoTeste" para testar.

**Limite conhecido.** Num PDF o que prova a origem é a assinatura digital do banco (Multicaixa Express) ou a
comparação com o modelo de referência; a verificação apanha edições comuns (editores de PDF, Word/Canva, texto
tapado, gravações posteriores), mas um falsificador que reproduza exactamente o PDF do banco pode passar.

Numa imagem não há nada disso. As três leituras com contrastes diferentes servem para o OCR não trocar
caracteres — **não provam que a imagem é verdadeira**. Um ecrã desenhado de raiz, com a entidade, a referência, o
valor e uma data dentro do prazo, é lido como verdadeiro, e todos esses dados estão na página do pedido. O que
protege de facto é:

- a **data e hora impressas**, que ligam a imagem a um pagamento concreto e impedem que o mesmo sirva dois pedidos;
- o **valor único por pedido** (Configurações), que dá a cada pedido um valor seu — ligue-o;
- a **auditoria do extrato**, que é o único sítio onde se vê o dinheiro entrar mesmo.

Cruze o extrato com regularidade: é ele, e só ele, que prova que o dinheiro entrou.

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

1. **Supabase:** aplicar as migrações por ordem (`supabase/migrations/`). No projeto `hfkgbizyrdpjtyzbgxzt` estão aplicadas até à `0013`; a `0014` acrescenta a aprovação automática das imagens.
   - Authentication → Sign In / Providers: desligar **Allow new users to sign up**.
   - Authentication → Attack Protection: ligar **Leaked password protection** (se o plano o permitir).
   - Authentication → URL Configuration: **Site URL** = o domínio final.
2. **Render:** New → Blueprint → escolher o repositório. O `render.yaml` cria o serviço web e o cron; o Render pede
   só os valores marcados `sync: false` (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`). Notas:
   - `NEXT_PUBLIC_SITE_URL` = `https://o-seu-dominio` (é o link enviado aos clientes);
   - `META_TOKEN_ENCRYPTION_KEY` = **a mesma** de sempre. É ela que abre os tokens da API de Conversões e da
     UTMify já guardados na base de dados; com uma chave diferente esses tokens ficam ilegíveis e as vendas deixam
     de chegar ao Meta **sem nada falhar à vista** — só uma linha `[meta] token ilegível` no registo. Guarde-a num
     sítio seguro. Se a perder, não há como a recuperar: volte a colar os tokens no painel (Integrações, e nos
     produtos que tenham Pixel próprio), que ficam cifrados com a nova;
   - `CRON_SECRET` novo (`openssl rand -hex 32`);
   - provedores de mensagens (`SMS_PROVIDER`, `WHATSAPP_PROVIDER`, `EMAIL_PROVIDER` e credenciais). Não usar `log` em produção.
3. **Região:** Frankfurt, a mais próxima do Supabase (`eu-central-1`, Frankfurt).
4. **Cron:** no plano grátis do Render não há cron. A migração `0012_cron.sql` agenda no Supabase (`pg_cron` + `pg_net`) uma chamada a `/api/cron` a cada 5 minutos, com um segredo gerado no Vault. Noutro domínio, ajuste o URL nessa migração.
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

250 testes (Vitest) em `tests/`: leitura de valores, datas e campos dos comprovativos (PDF e imagem, com texto real de OCR); todas as regras de decisão e
verificações de autenticidade; análise de PDFs gerados (original, valor tapado, gravação acrescentada) até à decisão;
leitura de extratos (CSV, Excel, PDF) e cruzamento com os pedidos. O GitHub Actions (`.github/workflows/ci.yml`) corre
lint, testes e build em cada push.

## Scripts

- `scripts/analisar-comprovativo.mts` — corre a análise da app sobre um PDF local:
  `npx tsx --conditions=react-server scripts/analisar-comprovativo.mts caminho.pdf`
- `scripts/criar-modelo.mts` — cria ou alarga um modelo a partir de um PDF verdadeiro:
  `npx tsx --conditions=react-server scripts/criar-modelo.mts ficheiro.pdf mcx_express express "Multicaixa Express" "MULTICAIXA Express"`
- `scripts/gerar-comprovativo-teste.mjs` — gera comprovativos falsos do formato fictício “BancoTeste”.
