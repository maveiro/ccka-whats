# CLAUDE.md — WhatsApp Intelligence Platform

Este arquivo é o briefing principal para o Claude Code.
Leia completamente antes de qualquer implementação.

---

## O que é este projeto

Uma plataforma de **governança e inteligência de comunicação corporativa via WhatsApp**.

Captura mensagens de números corporativos, armazena com estrutura multi-tenant,
e evolui para busca semântica, alertas e integrações com ferramentas de negócio.

**Não é:** chatbot, automação de marketing, ou ferramenta de atendimento.
**É:** infraestrutura de dados de comunicação — visibilidade, histórico, inteligência.

> **Decisão de posicionamento (Jun 2026):** após avaliar uma expansão para
> plataforma de atendimento omnichannel estilo ChatPro, optou-se por **recuar
> desse rumo**. O mercado de atendimento é saturado (ChatPro, Take Blip, Zenvia,
> Octadesk, Chatwoot open-source) e commoditiza o produto. O wedge defensável é
> **inteligência e governança de comunicação** (busca semântica, alertas
> inteligentes, compliance/LGPD, resumos para gestão). Features de operação do
> inbox (status/atribuição de conversa) só entram como apoio menor a esse
> posicionamento — nunca como caminho para "virar atendimento". Não reabrir o
> rumo atendimento sem uma decisão de negócio explícita.
>
> **Reabertura parcial e consciente (06/08/2026):** o módulo de **campanhas
> via WhatsApp Cloud API** (`app/dashboard/admin/campaigns`, ver seção
> "Módulo de campanhas" abaixo) é, tecnicamente, automação de disparo/
> marketing — o que a decisão acima excluiu. Foi uma decisão de negócio
> explícita do fundador, não uma contradição silenciosa: usa exclusivamente
> a **API oficial** (Cloud API/WABA, nunca Baileys/Evolution — a base de
> captura de mensagens não muda em nada), é aditivo (nenhuma tabela/rota do
> pipeline Evolution foi alterada), e não é "virar atendimento" (sem inbox
> de resposta, sem status/atribuição de conversa — é broadcast admin-only
> de template pré-aprovado). Não usar este precedente para justificar
> reabrir o resto do escopo de atendimento sem uma decisão explícita própria.
>
> **Segunda reabertura parcial e consciente (04/09/2026):** a **automação de
> resposta por Flow** (`keyword_automation` + `agenda_shows`, ver PRD em
> `docs/prd/prd-automacao-flows-whatsapp.md`) responde automaticamente a
> mensagens recebidas — o que, lido ao pé da letra, se aproxima do rumo
> atendimento que a decisão acima excluiu. Como no módulo de campanhas, é uma
> decisão de negócio explícita do fundador (Marcelo), não uma contradição
> silenciosa: usa exclusivamente a **Cloud API oficial** já em uso pelo módulo
> de campanhas (nunca Baileys/Evolution — a base de captura de mensagens não
> muda em nada), é aditiva (nenhuma tabela/rota do pipeline Evolution é
> alterada; os Flows são escopados a `whatsapp_cloud_credentials`, não a
> sessões Evolution), e **não é "virar atendimento"**: é resposta automática
> por regra fixa (keyword → texto/link, e um Flow nativo que lê uma agenda de
> shows) mais coleta de dados de contato para a base de clientes — sem inbox
> de atendimento com status/atribuição de conversa, e sem IA gerando texto
> livre (decisão explícita: nada de Meta Business Agent ou equivalente).
> Vale aqui o mesmo limite do parágrafo anterior: não usar este precedente
> para reabrir o resto do escopo de atendimento sem uma decisão explícita
> própria — e todo ajuste de escopo da automação atualiza esta nota **antes**
> do PR, não depois.

---

## Fases do produto

```
FASE 1 (concluída)  → 1 número pessoal, lab, captura + busca simples
FASE 2 (agora)      → N números corporativos, governança, backup histórico
FASE 3 (futuro)     → SaaS multi-tenant, integrações, agentes com contexto
```

A arquitetura já é a da Fase 3 — apenas com 1 tenant ativo.
**Nunca tome decisões que exijam refatoramento entre fases.**

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| WhatsApp (captura) | Evolution API (VPS Hostinger) — não-oficial (Baileys) |
| WhatsApp (campanhas) | WhatsApp Cloud API oficial, Graph API v23.0 — módulo separado, ver "Módulo de campanhas" |
| Ingestão | Supabase Edge Functions (Deno) |
| Banco | Supabase PostgreSQL + pgvector |
| Storage | Supabase Storage |
| Auth | Supabase Auth + RLS multi-tenant |
| Realtime | Supabase Realtime |
| Frontend | **Next.js 16.2.9** (App Router) + Tailwind |
| Deploy web | Vercel |
| Deploy VPS | Docker Compose (Hostinger) |

### Atenção: Next.js 16

Next.js 16 tem breaking changes. **Leia `apps/web/AGENTS.md` antes de tocar no
frontend** — lá estão, além do Next 16, as convenções do web app: linha de base
do lint, busca de dados com `use()`+`Suspense` (nunca `useEffect`+`setState`),
quando usar `createAdminClient()` e as regras das rotas públicas.
- **`proxy.ts`** no lugar de `middleware.ts` — ambos não podem coexistir
- `proxy.ts` exporta `proxy()`, não `middleware()`
- `params` em Route Handlers é `Promise<{...}>` — sempre `await params`

---

## Estrutura do monorepo

```
wa-intelligence/
├── CLAUDE.md                     ← este arquivo
├── package.json                  ← workspace root
├── turbo.json                    ← Turborepo
│
├── apps/
│   └── web/                      ← Next.js 16 (dashboard)
│       ├── proxy.ts              ← middleware de auth (Next.js 16)
│       ├── app/
│       │   ├── login/
│       │   ├── register/
│       │   ├── forgot-password/
│       │   ├── reset-password/
│       │   ├── dashboard/
│       │   │   ├── admin/sessions/
│       │   │   ├── admin/operators/
│       │   │   ├── admin/alerts/
│       │   │   ├── admin/campaigns/  ← módulo de campanhas (Cloud API), ver seção própria
│       │   │   ├── admin/integrations/
│       │   │   ├── admin/history/
│       │   │   ├── admin/flows/         ← automações e Flows publicados
│       │   │   ├── admin/numbers/       ← cadastro self-service de número Cloud API
│       │   │   ├── admin/agenda/        ← shows da central
│       │   │   ├── admin/faq/           ← perguntas da central
│       │   │   ├── admin/clientes/      ← busca, LGPD e números de teste
│       │   │   ├── admin/formularios/   ← cria formulário + embed da landing
│       │   │   ├── admin/paginas/       ← páginas públicas do artista (substitui Linktree)
│       │   │   ├── admin/saude/         ← erros do events_log agrupados por assinatura
│       │   │   ├── admin/aprendizados/   ← registro de aprendizados do time
│       │   │   ├── admin/saude/         ← erros do events_log agrupados por assinatura
│       │   │   ├── analytics/
│       │   │   ├── settings/
│       │   │   └── chat/[id]/           ← inbox (grupo de rotas `(inbox)`)
│       │   └── api/
│       │       ├── sessions/         ← CRUD de sessões
│       │       │   ├── create/
│       │       │   ├── connect/
│       │       │   ├── disconnect/
│       │       │   └── [id]/         ← DELETE, status, qr, rotate-secret
│       │       ├── alerts/
│       │       ├── chats/
│       │       ├── messages/
│       │       ├── search/
│       │       ├── analytics/
│       │       ├── operators/
│       │       ├── history-sync/         ← dispara sync + GET status via events_log
│       │       │   └── status/
│       │       ├── chats/
│       │       │   └── [id]/sync-name/   ← resolve JID → nome real via Evolution API
│       │       ├── integrations/
│       │       ├── campaigns/            ← módulo de campanhas (Cloud API), ver seção própria
│       │       │   ├── credentials/
│       │       │   ├── templates/
│       │       │   └── [id]/fire, [id]/status
│       │       ├── flows/                ← automação: CRUD + keywords + fallbacks
│       │       ├── agenda/, faq/         ← conteúdo da central
│       │       ├── agenda/filtros/       ← agendas sincronizadas do Monday (via painel-shows)
│       │       ├── agenda/opcoes, sync, conexao
│       │       ├── clientes/             ← busca por telefone + exclusão LGPD
│       │       ├── numeros-teste/        ← lista que autoriza o "/reset"
│       │       ├── formularios/          ← formulários de cadastro (painel)
│       │       ├── public/cadastro/[slug]← recebe o formulário público (sem auth)
│       │       ├── paginas/             ← CRUD de página, blocos, upload de imagem
│       │       ├── saude/               ← resumo de erros + reconhecer
│       │       ├── alert-events/, learnings/
│       │       └── clientes/cadastrar/  ← cadastro pelo painel (porta única, regra 24)
│       │       └── register/
│       ├── lib/whatsapp-cloud/       ← graphClient.ts, getCloudCredential.ts (módulo de campanhas)
│       └── components/
│           ├── chat-list.tsx         ← filtro Todos/Grupos/Contatos
│           ├── chat-view.tsx
│           ├── session-card.tsx      ← QR, status, delete com confirmação
│           ├── sidebar.tsx           ← dot de status das sessões
│           └── ...
│
├── scripts/
│   ├── republicar-flow.ts        ← Flow publicado é imutável: cria o novo, valida e publica
│   └── lint-baseline.mjs         ← trava o NONO erro de lint (ver .eslint-baseline.json)
│
├── .github/workflows/
│   ├── ci.yml                    ← PR e main: tipos, lint, build, migrations do zero e suíte
│   └── deploy.yml                ← main: deploy das 12 Edge Functions (o web vai pela Vercel)
│
├── packages/
│   └── types/                    ← tipos compartilhados
│
├── supabase/
│   ├── migrations/               ← SQL versionado (0001–0040; novas usam timestamp)
│   ├── tests/                    ← suíte SQL + e2e (`npm run test:db`)
│   └── functions/
│       ├── whatsapp-webhook/     ← recebe eventos do Evolution (JWT off)
│       ├── media-downloader/     ← baixa mídias antes de expirar (JWT off)
│       ├── history-sync/         ← sincroniza histórico via Evolution API
│       ├── generate-embeddings/  ← embeddings OpenAI para busca semântica
│       ├── session-health-check/ ← monitora sessões periodicamente (JWT off)
│       ├── webhook-delivery/     ← entrega webhooks para integrações
│       ├── campaign-sender/         ← envia lotes de campanha via Cloud API (JWT on)
│       ├── whatsapp-cloud-webhook/  ← status de entrega Cloud API (JWT off, assinatura própria)
│       ├── flow-engine/             ← responde mensagem recebida: gate, keyword, abrir Flow (JWT on)
│       └── flow-endpoint/           ← data endpoint do Flow, chamado pela Meta (JWT off, cripto própria)
│
└── infra/
    └── evolution/                ← docker-compose + .env.example do VPS
```

---

## Como rodar, testar e publicar

```bash
npm install                      # workspaces (apps/* e packages/*)
supabase start                   # Postgres + PostgREST locais, em Docker
supabase db reset --local        # aplica TODAS as migrations do zero
npm run test:db                  # suíte: SQL (psql, begin/rollback) + e2e (Deno)
```

**A suíte tem ~320 asserções** em dois formatos:

| Arquivo | O que cobre |
|---|---|
| `0025`–`0035_*.sql` | RLS, motor do Flow, credenciais multi-número, `registrar_cliente`, formulários |
| `campanhas_clique_rastreado.sql`, `custos_cloud_api.sql`, `campanha_abre_flow.sql` | clique, ledger de custo, botão de Flow em campanha |
| `agenda_do_painel_shows.sql`, `paginas_publicas.sql`, `vigilancia_events_log.sql` | sync da agenda, página pública e retenção, vigilância de erros |
| `flow_engine.e2e.ts`, `flow_endpoint.e2e.ts`, `agenda_sync.e2e.ts`, `cloud_webhook.e2e.ts`, `custos_webhook.e2e.ts`, `painel_consultas.e2e.ts` | Edge Functions com a API externa stubada — nada sai da máquina |
| `show_card.e2e.ts`, `imagem_dimensoes.e2e.ts` | regra do botão do card e leitura de dimensão de imagem (puros, sem banco) |

**O banco local é UM SÓ para todos os worktrees** — antes de `db reset --local`
ou `npm run test:db`, use o lock descrito em "Trabalho em paralelo".

**CI** (`.github/workflows/ci.yml`, em PR e em push na main): job `web` (tipos,
lint por linha de base, build) e job `banco` (`supabase start` → `db reset` →
suíte). ~5 min. O `deploy.yml` publica as Edge Functions em push na main; o web
vai pela integração Vercel↔GitHub.

**Publicar Edge Function na mão:** `supabase functions deploy <nome>`. Migration
**sempre antes** do código que a usa (regra 10).

## Regras inegociáveis de arquitetura

1. **`tenant_id` em toda tabela** — RLS filtra por tenant em tudo. A única
   exceção admitida é **tabela de referência global**, cujo conteúdo é igual
   para todos os tenants e não é dado de ninguém: hoje só `whatsapp_rates`
   (rate card publicado pela Meta, migration `custos_cloud_api`), com RLS de
   leitura para qualquer autenticado. Um `tenant_id` ali seria fachada —
   duplicaria a mesma tarifa por tenant e criaria a chance de divergirem.
   Qualquer nova tabela sem `tenant_id` precisa se justificar **aqui**, nesta
   lista, antes de existir.
2. **`raw_payload jsonb`** em `messages` — nunca descartar o payload original do Evolution.
3. **Mídia não é opcional** — a Edge Function `media-downloader` deve ser acionada
   imediatamente após salvar a mensagem. Links do WhatsApp expiram em minutos.
4. **Idempotência** — todo insert usa `upsert` com conflict na chave natural.
5. **Nunca expor `SUPABASE_SERVICE_ROLE_KEY` no cliente** — apenas em Route Handlers
   server-side ou Edge Functions. Use `createAdminClient()` para ops privilegiadas.
6. **`events_log` em toda operação crítica** — webhook recebido, mídia baixada,
   erro de sessão. Sem isso, debug em produção é impossível.
7. **Schema preparado para fase 3** — coluna `embedding vector(1536)` já existe,
   tabela `integrations` já existe. Não remover "porque não usa ainda".
8. **Nomes de grupos nunca sobrescritos por `pushName`** — `pushName` em mensagens
   de grupo é o remetente, não o grupo. Usar padrão dois passos: upsert com
   `ignoreDuplicates: true` + update sem tocar no `name` do grupo.
9. **Edge Functions `whatsapp-webhook`, `media-downloader`, `session-health-check`
   devem ter `verify_jwt: false`** — são chamadas pelo Evolution API / cron, sem JWT.
10. **Migration antes do deploy** — nunca deployar código que usa uma coluna nova sem
    antes aplicar a migration no banco de produção. Uma migration não aplicada causa
    falha silenciosa: o upsert do Supabase retorna `{ data: null, error }` e se o
    código não checar `error`, a mensagem é descartada sem log. Sempre destruturar
    `{ data, error }` e logar o error.
11. **`history-sync` tem limite de 150s** — o status HTTP 546 do Supabase significa
    timeout de Edge Function. Processar chats sequencialmente com await dentro de loop
    causa timeout para volumes > ~100 chats. Usar lotes paralelos (`Promise.allSettled`
    em batches de 5) e bulk upsert por página, não um DB call por mensagem.
12. **`events_log` usa sempre `event_type` / `payload` / `error`** — nunca `type` ou
    `status`. Campos corretos: `{ tenant_id, session_id, event_type, payload, error }`.
    Usar campos errados gera insert silenciosamente inválido no Postgres.
13. **Embeddings são `number[]`, não string** — ao gravar no campo `embedding vector(1536)`,
    passar o array diretamente (ex: `.update({ embedding: arr })`). Nunca `JSON.stringify`
    — o Postgres recebe uma string e o update falha silenciosamente.
14. **`MessageType` inclui todos os tipos reais** — além de `text/image/audio/video/document/
    sticker/reaction/unknown`, existem: `contact`, `interactive`, `location`, `poll`, `system`.
    Todos derivados de `normalizeMessageType()` no whatsapp-webhook. Nunca comparar com
    subconjunto incompleto.
15. **Isolamento multi-tenant via RLS, não via filtro de app** — as Route Handlers usam o
    cliente Supabase autenticado do usuário; RLS filtra automaticamente por tenant. Não é
    necessário (nem correto) adicionar `.eq("tenant_id", ...)` em queries do web app —
    isso seria redundância que dificulta manutenção. A autoridade é o Supabase RLS.
16. **`media_files.message_id` é FK para `messages.id` (UUID interno)** — não confundir com
    `messages.message_id` (ID do WhatsApp, string). O campo `media_files.message_id` sempre
    referencia o UUID primário da tabela `messages`.
17. **Requests via PostgREST/RPC (client Supabase, `admin.rpc(...)`) têm teto de ~8s** —
    quem estabelece a conexão física é o role `authenticator` (não `service_role`, mesmo
    autenticando com a service role key), e `authenticator` tem `statement_timeout` fixado
    via `ALTER ROLE` (hoje 60s neste projeto, era 8s até 21/07/2026). **`SET LOCAL
    statement_timeout` dentro de uma função `security definer` chamada via RPC NÃO
    sobrescreve esse limite** — confirmado empiricamente (um `pg_sleep(9)` isolado, sem
    nenhum I/O de tabela, foi cancelado no teto do `authenticator` mesmo com `SET LOCAL
    statement_timeout = '120s'` como primeira linha da função). Não perder tempo tentando
    essa rota de novo. Para qualquer operação potencialmente longa (cascades grandes,
    batch jobs) chamada via client Supabase: (a) rodar numa Edge Function fazendo múltiplos
    requests HTTP pequenos em vez de 1 statement grande (cada request é seu próprio teto),
    como em `delete-session` e `history-sync`; ou (b) se precisar mesmo de 1 statement
    longo, subir o timeout do role `authenticator` via `ALTER ROLE authenticator SET
    statement_timeout = 'Xs'` — mas isso afeta **todo** o tráfego da Data API (anon,
    authenticated, service_role), não só a operação em questão.
18. **Exclusão de sessão com histórico grande usa a Edge Function `delete-session`**
    (não um DELETE direto em `wa_sessions` via client) — apaga `messages` em lotes de 500
    (`.delete().eq("session_id", ...).limit(500).select("id")`, sem `.order()`: ordenar
    antes do limit força sort e não ajuda em nada aqui) até zerar, depois `chats`, depois a
    sessão. Ver regra 17 para o motivo. `DELETE /api/sessions/[id]` tem
    `export const maxDuration = 90` por causa disso. Depois de apagar a sessão, também
    limpa `storage/media/{tenant_id}/{session_id}/` em lotes via `.storage.from("media")
    .list()` + `.remove()` — o cascade de FK apaga a linha `media_files` (que tinha o
    `storage_path`) mas não o objeto físico no bucket; sem esse passo os arquivos ficam
    órfãos no Storage para sempre (achado em produção em 22/07/2026 — código corrigido no
    mesmo dia; ~960MB/1.839 arquivos pré-existentes de 3 sessões já excluídas antes do fix
    foram limpos manualmente em 23/07/2026, ver "Estado atual" e regra 6 sobre o log em
    `events_log`).
19. **Login via Google (domínios em `GOOGLE_ONLY_DOMAINS`, hoje só `plauz.com.br`) nunca
    autocadastra** — `apps/web/app/auth/callback/route.ts` exige (a) email termina em um
    domínio de `GOOGLE_ONLY_DOMAINS` (`lib/google-only-domains.ts`) e (b) já existe uma
    linha em `operators` com esse `id` (checada via `createAdminClient()`, exceção à regra 15 —
    mesmo padrão do `integrations`). Falhando qualquer um dos dois: `signOut()` +
    redirect `/login?error=...`. Continua exigindo convite do admin como única porta de
    entrada — Google só troca a credencial de quem já existe, não cria operador/tenant novo.
    `/auth` está em `publicPaths` no `proxy.ts` (roda antes do middleware considerar a
    sessão "oficial"). **`POST /api/operators/invite` verifica o mesmo domínio** — pra
    e-mail Google-only usa `admin.createUser({ email_confirm: true })` sem senha (sem
    e-mail de convite, a pessoa já entra direto por "Entrar com Google"); pra qualquer
    outro domínio, mantém `inviteUserByEmail` (fluxo de definir senha por e-mail). Nunca
    usar `inviteUserByEmail` pra um e-mail Google-only — manda um convite de senha que
    nunca deveria existir, e deixa uma credencial de senha válida por engano num domínio
    que devia ser Google-only (achado em produção em 22/07/2026: dois convites reais
    foram feitos antes desse fix existir — corrigidos manualmente invalidando a senha).
20. **Acesso por número (`operator_session_access`) é aplicado via RLS, não filtro de app** —
    `admin` sempre vê todas as sessões do tenant; `operator` vê tudo (`session_scope='all'`)
    ou só as sessões concedidas (`session_scope='restricted'` + linhas em
    `operator_session_access`). Default da coluna é `'restricted'` desde 22/07/2026
    (migration 0017) — antes disso era `'all'`; operadores convidados antes dessa data
    ficaram com `'all'` explícito na própria linha (não retroagiu, ninguém perdeu acesso).
    A função `has_session_access(session_id)` (security definer, mesmo padrão de
    `my_tenant_id()`/`my_role()`) decide isso e é usada nas policies de `wa_sessions`,
    `chats`, `messages` e `media_files` — substituíram `tenant_isolation` (não somaram: a
    tentativa antiga de RLS por sessão, `operator_own_session` em `messages`, nunca
    funcionou por causa do OR entre policies permissivas — não repetir esse erro). Gerência
    em `/dashboard/admin/operators` (só aparece pra `role='operator'` — admin não precisa,
    sempre vê tudo), grava via `PUT /api/operators/[id]/session-access`.
21. **Operador pode criar/conectar/desconectar sessão (não só admin)** — `POST
    /api/sessions/create`, `/api/sessions/connect` e `/api/sessions/disconnect` aceitam
    `role IN (admin, operator)`. Excluir sessão e ver/rotacionar webhook secret continuam
    **admin-only**, mesmo pra sessão que o próprio operador conectou (`SessionCard` recebe
    `isAdmin` e esconde "Zona de perigo" + "Configuração do Webhook" pra operador —
    `webhook_secret` nem é passado como prop pro client dele em
    `dashboard/admin/sessions/page.tsx`, não é só esconder na UI). Quando um `operator`
    cria uma sessão, ganha grant automático em `operator_session_access` pra ela (o
    admin, dado o default `restricted` da regra 20, não precisa fazer nada — o número que
    o operador acabou de criar já é o único que ele vê, a não ser que já tivesse outros
    liberados antes).
22. **Nome/avatar de contato e grupo vêm de `POST /chat/findContacts/{instance}`, não de
    `GET /contact/fetchContacts/{instance}`** — o segundo é um endpoint que não existe
    nesta versão do Evolution API (sempre retornava 404; achado em produção em 22/07/2026
    testando a resposta real do endpoint). Era o único caminho de resolução de nome pra
    contatos/`@lid` sem `pushName` no payload do webhook (a resolução em tempo real via
    webhook cobre a maioria dos casos — só falha quando a msg é `fromMe`-only ou o
    WhatsApp omite `pushName`), então o bug deixava esses chats presos com o JID bruto
    como nome pra sempre. `/chat/findContacts` retorna array com `remoteJid` (campo pra
    casar com `chats.jid` — **não** `id`, que ali é um id interno do Evolution, não o
    JID), `pushName` e `profilePicUrl`, cobrindo contatos **e** grupos numa única
    chamada. Nome de grupo continua resolvido preferencialmente via `subject` de
    `/group/fetchAllGroups` (mais confiável/atualizado que o `pushName` do
    findContacts) — `findContacts` supre o avatar do grupo e o nome+avatar de contato.
    Usado em `sync-name` (botão manual) e `session-health-check` (`fetchContactsBulk`,
    uma chamada por sessão conectada, reaproveitada tanto pra nome de contato quanto
    avatar de contato/grupo). Coluna `chats.avatar_url text` (migration
    `0018_chats_avatar_url.sql`) guarda a URL do CDN da Meta diretamente — sem baixar
    pra Storage: ao contrário de mídia de mensagem (regra 3), o link de foto de perfil
    não expira em minutos, e o health-check já roda a cada 5 min re-sincronizando/
    corrigindo caso mude.
23. **`chats.name` nunca é `null` quando não resolvido — é o próprio JID** (ver
    `whatsapp-webhook`, insert/update de `chats.name`). `chat.name === chat.jid` é o
    sinal de "nome não resolvido", não `!chat.name`. `displayChatName(name, jid)` em
    `apps/web/lib/chat-display.ts` centraliza esse fallback: se não resolvido, mostra
    telefone formatado (pra `@s.whatsapp.net`) ou "Contato/Grupo sem nome" (pra `@lid`
    e grupos sem subject) em vez do JID bruto — usado em `chat-list.tsx`, `chat-view.tsx`,
    `search-bar.tsx` e `/api/analytics`. `@lid` (ID de vínculo do WhatsApp, esconde o
    número real) não tem telefone pra formatar, daí o fallback textual.

---

## Módulo de campanhas (WhatsApp Cloud API, oficial) — 06/08/2026

Aditivo, isolado do pipeline Evolution/Baileys acima — compartilha só
`tenants`/`operators`/`events_log`. Fluxo: admin cadastra credencial do
WABA (`whatsapp_cloud_credentials`, RLS deny-all — mesmo padrão de
`meta_ads.ad_account_tokens` no monorepo `plauz-core`) → escolhe um
template aprovado (`listMessageTemplates`) → sobe CSV de destinatários
(`phone` + colunas de variável posicionais `{{1}}`, `{{2}}`...) → dispara
→ acompanha progresso.

**Migrations:** `0019_cloud_api_campaigns.sql` (schema + `claim_campaign_recipients`/
`reclaim_stuck_campaign_recipients`/`recompute_campaign_counters`),
`0020_campaign_sender_cron.sql` (pg_cron a cada minuto).

**Por que não é uma única request/RPC (regra 17/11 acima):** disparo em
massa não cabe no teto de `statement_timeout`/Edge Function timeout — é
Edge Function (`campaign-sender`) processando em lotes de 50, reinvocada
por `pg_cron` a cada minuto para toda campanha `sending` com destinatário
pendente. **Claim atômico** via `claim_campaign_recipients()`
(`FOR UPDATE SKIP LOCKED`) garante que invocações sobrepostas (cron tick +
retry manual) nunca processam a mesma linha — zero risco de double-send.

**Teto de tier de mensageria:** a Cloud API rejeita com 4xx de
elegibilidade de negócio (códigos 130472/131048/131056), não 429, quando o
número bate no limite de mensagens/24h. `campaign-sender` trata isso como
**pausar a campanha** (`status='paused'`, destinatários voltam a
`pending`), nunca como falha definitiva dos restantes.

**Compliance mínimo embutido (não é débito futuro):** `whatsapp_opt_outs`
é checado antes de aceitar um destinatário numa campanha; `template_category`
é armazenado por campanha.

**Cada tentativa de envio grava `events_log`** (`campaign_send_attempt`,
sucesso ou rejeição) além do início/fim da campanha — é o que atende
"logar todo o movimento" além do status de entrega vindo do webhook.

**Credenciais nunca em env var** — `META_APP_SECRET`/`META_WEBHOOK_VERIFY_TOKEN`
são os únicos valores globais (verificação de assinatura do webhook, um
único Meta App para todos os tenants); `waba_id`/`phone_number_id`/
`access_token` são sempre por-tenant, em `whatsapp_cloud_credentials`.

---

## Módulo de automação por Flow + Central de shows (Cloud API) — 04/09 a 10/09/2026

Segunda frente aditiva sobre a Cloud API, irmã do módulo de campanhas e igualmente
isolada do pipeline Evolution/Baileys. Responde automaticamente a quem escreve
para um número oficial e mantém uma **central de shows por artista** (Flow nativo
com agenda, FAQ e cadastro). PRDs: `docs/prd/prd-automacao-flows-whatsapp.md` e
`docs/prd/prd-central-de-shows.md`. Ver a nota de posicionamento no topo deste
arquivo — é reabertura consciente, não deriva para atendimento.

**Duas Edge Functions, papéis distintos:**

- **`flow-engine`** (`verify_jwt = true`) — invocado pelo `whatsapp-cloud-webhook`
  a cada mensagem recebida. Decide: idempotência → `/reset` → opt-out → cliente →
  gate de cadastro → palavra-chave → resposta (texto, link ou abrir Flow).
- **`flow-endpoint`** (`verify_jwt = false`) — o *data endpoint* que a **Meta**
  chama enquanto a pessoa navega dentro do Flow. Tráfego criptografado
  (RSA-OAEP/SHA-256 + AES-128-GCM com IV invertido); a chave privada por número
  vive em `internal_secrets` sob `flow_private_key:{phone_number_id}`, nunca em
  env var.

**Tabelas:** `whatsapp_flows`, `flow_palavras_chave`, `clientes`,
`flow_contato_estado`, `flow_sessoes`, `flow_mensagens_processadas`,
`agenda_shows_sync`, `faq_itens`, `formularios_cadastro`, `formulario_envios`,
`numeros_de_teste`. Migrations `0025`–`0040` e `campanha_abre_flow` (Sprint C4,
campanha que abre a central).

### Regras próprias deste módulo

24. **`registrar_cliente()` é a ÚNICA porta de cadastro** (migration 0033).
    Gate por chat, Flow, formulário público, painel e campanha chamam essa
    função — ninguém escreve em `clientes` por conta própria. Mora no banco
    porque Edge Functions (Deno) e painel (Next) **não compartilham módulo**; o
    banco é a única camada que os dois enxergam. A regra nasceu de um cliente
    real gravado **sem consentimento** pelo gate em 09/09/2026.

25. **Identidade de cliente é `chave_telefone()`, não `telefone`** (migration
    0037). `55 + DDD + 8 últimos dígitos`: o WhatsApp identifica umas contas com
    o nono dígito e outras sem, e não existe forma canônica única. `telefone`
    guarda o que cada canal informou; a **chave** (coluna gerada
    `clientes.telefone_chave`, com o índice único) é o que deduplica. Buscar por
    `telefone` cru cria um segundo cadastro para quem veio da landing.

26. **Consentimento é versionado e só é carimbado quando a VERSÃO muda**
    (migration 0039). Reforço do mesmo texto não é aceite novo — o gate informa a
    mesma versão ao pedir nome e ao pedir e-mail, e recarimbar faria o registro
    apontar a última resposta em vez do momento do aceite. Trocar o texto legal
    **exige** versão nova (o `PATCH /api/formularios/[id]` recusa sem ela):
    mudar o texto sem mudar a versão tornaria falso todo consentimento anterior.

27. **Texto legal vem do banco, nunca do Flow JSON publicado.** Flow publicado na
    Meta é imutável; texto de consentimento congelado numa versão publicada é o
    oposto do que a LGPD pede. Fica em `whatsapp_flows.texto_consentimento` /
    `versao_consentimento` e em `formularios_cadastro`.

28. **A Meta NUNCA manda o telefone para o `flow-endpoint`** — quem é a pessoa
    vem de `flow_sessoes`, gravada no momento em que o Flow é oferecido, e
    encontrada pelo `flow_token`. Token é UUID aleatório: telefone dentro do
    token seria dado pessoal trafegando pelo aparelho. Sem sessão, todo mundo
    cai no cadastro — é o ponto de falha mais provável do desenho.

29. **`/reset` tem a autorização no BANCO, não no motor** (migration 0038).
    `resetar_cadastro_teste()` só age sobre números listados em
    `numeros_de_teste` e devolve `false` para o resto, então um bug no
    `flow-engine` não consegue apagar dado de cliente real. Quem não está na
    lista digita o comando e recebe a resposta normal do flow — sem efeito e sem
    descobrir que ele existe. Gerência em `/dashboard/admin/clientes`.

30. **Gate por chat e cadastro no Flow coexistem** (decisão do fundador,
    10/09/2026 — ver `prd-central-de-shows.md`). O gate atende quem escreve para
    o número; a tela `CADASTRO` do Flow atende quem chega à central por fora do
    chat (campanha, link), onde não houve conversa. O custo aceito é ter duas
    portas — o que impede divergência é as duas passarem por `registrar_cliente`.
    O texto de consentimento, porém, vive em dois lugares: constante
    `VERSAO_CONSENTIMENTO_GATE` em `gate.ts` (código, exige deploy — hoje
    `gate-v2-2026-09`) e banco, no Flow (`central-v1-2026-09`). Revisar
    redação legal significa mexer nos dois, e as versões andam separadas de
    propósito: são dois aceites distintos, em dois momentos distintos.

31. **`whatsapp_flows.nome` é rótulo interno; o fã lê `mensagem_convite`**
    (migration 0039). O balão que oferece um Flow usava o `nome` como corpo e
    chegava ao fã com o nome que o admin deu para se organizar no painel. O nome
    ficou como último recurso, só para o balão não ir vazio.

37. **Template com botão de Flow disparado sem `flow_token` NÃO dá erro**
    (migration `campanha_abre_flow`). A Graph API aceita, entrega, e todo
    destinatário abre a central como desconhecido — numa base já cadastrada,
    o pior resultado possível, e invisível nos contadores. Por isso a
    campanha guarda `flow_id` (qual central o botão abre), o destinatário
    nasce com `campaign_recipients.flow_token` vindo do default do banco
    (mesma razão do `click_token`, regra 35), e a validação é em três
    camadas: trigger `valida_campanha_flow` (mesmo número, tipo abrível,
    ativo — espelha a `0031`), `POST /api/campaigns` (mensagem de erro para
    quem monta) e `campaign-sender` (última porta, pega template editado na
    Meta depois da criação). O índice do botão **nunca** é fixo em 0: é a
    posição entre todos os botões, definida no editor da Meta, e reordenar
    lá mandaria o token para o botão errado.

38. **A agenda da central vem do Monday pela ponte com o `painel-shows`, nunca
    do Monday direto** (migration `agenda_do_painel_shows`, PRD
    `docs/prd/prd-agenda-via-painel-shows.md`). O `painel-shows` (repo
    `plauz-core`, outro projeto Supabase) é dono da integração; a ADR 0006 de
    lá pré-decidiu a forma (registro de fonte + API interna, sincroniza-e-serve)
    e **proíbe** copiar credencial de um app para outro ou cruzar schema com
    `service_role`. Quatro coisas que não podem se perder:
    (a) **o filtro de cada agenda é guardado por RÓTULO** (`IB`, `Vendendo`) e
    aplicado sobre a cópia local — a API do Monday exige o **índice** do rótulo
    em `query_params` (texto devolve zero itens **sem erro**), e índice depende
    da ordem de criação dos rótulos no board;
    (b) **o board é agenda de produção, não de fã** — em 15/09/2026, 123 dos 200
    itens futuros eram bloqueio/corporativo/pauta/cancelado, então a allowlist
    de status é obrigatória, e show que sai dela tem que **sair da tabela** (a
    lista do Flow filtra só data futura e artista, não status);
    (c) **o nome do artista na central sai de `whatsapp_cloud_credentials.artista`**,
    nunca digitado na agenda — é o mesmo valor que o endpoint do Flow usa para
    filtrar, e número sem artista faz o Flow servir a agenda inteira do tenant,
    por isso `sincronizar_agenda_shows()` recusa;
    (d) **falha de rede nunca vira "nenhum show"** — lista vazia apaga a agenda
    daquele filtro (correto para artista sem datas, desastroso para um timeout),
    então o `agenda-sync` aborta o tenant quando a API interna falha e deixa a
    agenda anterior no ar.
    Linha digitada à mão (`show_id_origem is null`) nunca é tocada pelo sync —
    é para isso que o índice único de origem da `0025` é parcial.

### Armadilhas já pagas

- **Um Flow ativo por credencial e por tipo** (`central`, `agenda_shows`):
  há índice único. Criar o segundo falha — e, em teste, derruba o cenário
  seguinte se o anterior não limpou o dele.
- **Apagar um Flow que é destino de palavra-chave falha em silêncio** (FK). A
  keyword sai primeiro, o Flow depois.
- **Palavra-chave só existe em Flow `keyword_automation`** (migration 0032).
- **Flow JSON**: `version` fora das suportadas é recusado na publicação; não há
  negação em expressão; `visible` não vale em `Form`; referência de campo é
  `${form.campo}`, não `${nome_do_form.campo}`; e o `INIT` **precisa** devolver a
  tela de entrada, não uma tela interna. A chave `_comentario` do arquivo de
  referência é **recusada** pela Graph API (`INVALID_PROPERTY_KEY`) — publicar
  significa subir o JSON sem as chaves `_*`.
- **Flow publicado NÃO pode ser atualizado** (doc da Meta: "This Flow cannot be
  deleted or updated afterwards"). Mudar uma tela significa **criar um Flow
  novo**, publicar, apontar `whatsapp_flows.meta_flow_id` para ele e
  descontinuar o antigo (`POST /{id}/deprecate`, irreversível e bloqueia abrir
  os balões já enviados). Feito em 17/09/2026 para levar arte e sinopse à tela
  `DETALHE`: `2031915787497246` → `1600957048078093`. As palavras-chave não
  precisaram de nada — apontam para a linha de `whatsapp_flows`, não para o id
  da Meta. **Consequência para o C4:** o botão de FLOW de um template carrega o
  `flow_id` **congelado**, então republicar a central invalida qualquer template
  já aprovado que aponte para o id antigo — é exatamente o que a checagem de
  `flowButton.flow_id !== flow.meta_flow_id` no `campaign-sender` pega antes de
  disparar para a base.
- **`PGRST201` ao embutir `flow_palavras_chave`**: há dois FKs para
  `whatsapp_flows` (o dono e o destino) — nomear o FK no embed é obrigatório.

---

## Página pública do artista (substitui o Linktree) — 17/09/2026

Pedido do fundador olhando `linktr.ee/indiobehn`, onde ~25 botões de show eram
mantidos **à mão**. Esses shows já estavam em `agenda_shows_sync`, vindos do
board do Monday: o bloco de agenda desta página é **gerado**, e "Esgotou!" sai
de `status_venda` em vez de alguém editar o rótulo.

`/a/{slug}` (público, fora do `/dashboard`, em `publicPaths` do `proxy.ts`,
`revalidate = 60`), `/l/{bloco}` (redirect rastreado), painel em
`/dashboard/admin/paginas`. Tabelas `paginas_publicas`, `pagina_blocos`,
`pagina_cliques` + `registrar_clique_pagina()`.

Quatro tipos de bloco cobrem o Linktree inteiro: `texto`, `link`, `imagem` e
`agenda` (com filtro opcional por espetáculo — é o que reproduz os grupos
"NOVO SHOW!" e "ESPECIAL DE NATAL"). Regras próprias:

39. **A curadoria é UMA, não duas.** A página mostra o mesmo recorte da
    central: `publicado = true`, do artista, e só o futuro. Show despublicado
    para de redirecionar mesmo por link já copiado — `registrar_clique_pagina`
    confere `publicado` antes de devolver destino.
40. **`/l/{bloco}` nunca devolve erro** — bloco inexistente, RPC falhando,
    destino vazio: tudo cai em redirect para a página. Mesma regra 34 do
    `/c/{token}`, e o mesmo filtro conservador de user-agent. A diferença é
    que aqui o preview **acontece** (o link vai em story e em bio), então sem
    o filtro a contagem viraria número de previews.
41. **`pagina_cliques` não guarda nada pessoal** — sem IP, sem user-agent, sem
    identificador de visitante. Só "qual botão, quando", e `show_id` quando foi
    numa data. Numa página pública, mais que isso é coleta que ninguém
    consentiu. Há teste que falha se alguém adicionar coluna desse tipo.
42. **`slug` é único GLOBALMENTE, não por tenant** (é URL pública), com `check`
    de formato no banco: minúsculo, sem espaço, sem acento. Slug com maiúscula
    gera link que funciona num app e quebra em outro.
43. **Tema é por página** (`paginas_publicas.tema` jsonb — personalização pedida
    "por linktree") e **validado na LEITURA** (`lib/pagina-tema.ts`): cor
    inválida no banco não pode virar CSS quebrado numa página que qualquer
    pessoa abre. O painel avisa quando o contraste fica abaixo de 4,5:1 —
    avisa, não proíbe: é a página do artista.
44. **Visualização de página é contada por BEACON do navegador**, não no
    servidor (migration `pagina_metricas`): a página tem `revalidate = 60`, e
    contar no componente contaria uma vez por minuto, não uma por pessoa. De
    graça, o beacon exclui robô — buscador de preview não roda JavaScript, e é
    em preview que esse link mais circula. O número é de **aberturas**, não de
    visitantes únicos: único exigiria identificador, que é o que a regra 41
    recusa. Uma vez por aba via `sessionStorage` (o valor nunca sai do
    navegador). `metricas_pagina()` agrega **no banco** — trazer dezenas de
    milhares de cliques para o Node é o erro que o Analytics de mensagens já
    paga com scan paginado — e confere `my_tenant_id()` internamente, porque
    `security definer` não pode confiar no id recebido.
45. **O card de show segue o formato de agenda de ticketeira** (referência do
    fundador, 17/09/2026): data à esquerda (mês/dia/dia-da-semana), cidade,
    hora·teatro, chips de selo e ação à direita. A regra de **qual ação** vive
    em `lib/show-card.ts`, pura e testada, porque é negócio e não formatação:
    `esgotado` ganha de tudo (mandar alguém para página de compra sem ingresso
    é pior que não ter botão); `Confirmado` — ou qualquer show sem link — vira
    **"Lista de espera"**, e só se o bloco tiver `url_lista_espera`, senão
    **nenhum botão**; o resto é "Ver ingressos". Card sem ação não é `<a>`:
    não finge ser clicável.
46. **Período é DERIVADO da data, não lido do board.** "Amanhã" e "Neste fim
    de semana" existem como dropdown no Monday (`Label Período`), mas rótulo
    que descreve a data e é mantido à mão envelhece — um show ficaria "Amanhã"
    para sempre. A página deriva, e o rótulo do board só entra se disser
    outra coisa (comparado sem acento e sem caixa, para não duplicar o chip).
    Já **`Label Ingressos`** ("Em Alta", "Quase Esgotado") é editorial de
    verdade e vem do board.
47. **`Confirmado` entra na agenda** (allowlist das três agendas, 17/09/2026):
    é show que existe e ainda não vende. Consequência prática vista na
    primeira sincronização: show confirmado costuma **não ter teatro ligado**
    no board, logo não tem cidade — e card sem cidade não serve ao fã. Quem
    segura isso é a curadoria (`publicado = false` por padrão), não a página.
### Orçamento de tempo da ponte (medido em 17/09/2026)

O espelho pedia **todas as colunas de todos os 1.022 itens** do board: **57s**,
no teto exato dos 60s da rota do `painel-shows`. Do lado de cá isso apareceu
como `agenda_espelho_nao_atualizado: Signal timed out` e, quando a rota morria
devolvendo HTML, como **"erro de JSON"** na tela de quem clicou em sincronizar
(`res.json()` engasgando no `<`).

Números reais, para não refazer a medição: 100 itens com todas as colunas =
665KB/7s; com as 10 colunas do espelho = 153KB/3,5s; página de 500 **não**
acelera sozinha (24s, porque a resposta cresce igual). O que resolveu foi
**pedir menos**: 10 colunas + recorte de data (30 dias para trás) = 376 itens,
uma página, **8,6s**; a cadeia inteira do `agenda-sync` (refresh + leitura +
temas + 3 agendas) caiu para **24s**.

Três consequências que ficam:

- o espelho **não guarda histórico** do board (a reconciliação limpa o que sai
  da janela) — ele serve a agenda do público, e show do ano passado não serve;
- item **sem data** fica fora do recorte (`greater_than` não casa vazio), o
  que é indiferente para agenda;
- o refresh do `agenda-sync` tem teto de **35s**, menor que os 60s da rota que
  o chama pelo painel — se o refresh comer o orçamento inteiro, a rota morre e
  o erro chega ao usuário como JSON inválido. A tela também passou a tratar
  resposta não-JSON com mensagem legível.

49. **Resolução de coluna por tipo precisa de fallback por título.** A arte do
    espetáculo era achada só pelo TIPO (`file`), e os tipos vêm de uma chamada
    separada cujo erro estava num `catch {}` vazio. Quando ela falhou (limite
    do monday, depois de a consulta ficar maior), **a arte desapareceu e a
    sinopse continuou vindo** — porque só a sinopse tinha fallback. Nada em log
    nenhum. Hoje as duas caem para a pista de título e o erro dos tipos entra
    em `erros` do resultado.
50. **Emoji no rótulo do Monday atravessa tudo** — `🔥 Quase Esgotado` chega
    intacto no chip do card (verificado ponta a ponta em 17/09/2026). É texto,
    e nenhuma camada normaliza.
51. **Buckets `paginas` e `temas` são PÚBLICOS** (arte de divulgação servida por
    CDN), ao contrário de `media` (conversa de WhatsApp, privado por natureza).
    O upload passa pelo servidor para validar tipo e tamanho antes de o arquivo
    existir.

## Módulo de cliques e custos de disparo (Cloud API) — 10/09/2026

Duas frentes que entraram juntas sobre o módulo de campanhas, mantendo o mesmo
isolamento do pipeline Evolution. PRD: `docs/prd/prd-cliques-e-followup-campanhas.md`.
Migrations `20260910172923_campanhas_clique_rastreado` e
`20260910173238_custos_cloud_api`.

**Rastreio de clique.** Clique em botão de URL **não gera webhook nenhum** na
Cloud API (ao contrário do quick-reply, coberto pela `0022`) — a Meta expõe só
contagem agregada por template/dia, que nunca identifica quem clicou. Para saber
QUEM clicou, o botão do template aponta para `/c/{{1}}` no nosso domínio, com um
`click_token` por destinatário, e de lá redirecionamos ao destino real
(`campaigns.click_target_url`).

**Custo por disparo.** A Meta manda um objeto `pricing` junto do **primeiro**
status de cada mensagem (normalmente o `sent`), uma vez só: categoria e se é
cobrada, nunca o valor. O valor sai de `whatsapp_rates` e é **congelado** na
linha do ledger `whatsapp_message_costs`, para reajuste futuro não reescrever
histórico.

### Regras próprias deste módulo

32. **A Graph API ANEXA o valor da variável ao fim da URL do botão**, em vez de
    substituir um placeholder no meio. Por isso a URL do template precisa
    terminar em `/c/{{1}}` — `https://…/c/{{1}}/checkout` é rejeitado — e por
    isso a Meta só aceita uma variável, e só na ponta. O botão também precisa
    ser de **URL dinâmica**; com URL estática o `campaign-sender` não anexa nada
    (e não dá erro: simplesmente não rastreia).

33. **`clicked_count` da campanha conta PESSOAS; `click_count` do destinatário
    conta ABERTURAS.** `clicked_at` guarda o **primeiro** clique e nunca é
    sobrescrito — reabrir o link não pode empurrar para frente um follow-up
    disparado a partir dele. O contador da campanha é recalculado por `count(*)`,
    nunca incrementado (mesma regra da `0019`).

34. **`/c/{token}` nunca devolve erro.** Token inexistente, RPC falhando, destino
    ausente: tudo cai em redirect para a home. Quem está do outro lado é um
    comprador, e clique perdido é um dado; comprador vendo erro é uma venda.
    Buscadores de preview são filtrados por user-agent (lista conservadora: um
    falso positivo descarta a compra de alguém real).

35. **DEFAULT de coluna não pode depender de `search_path`.** `click_token` usa
    `gen_random_uuid()` (pg_catalog) e **não** `gen_random_bytes()` (pgcrypto, no
    schema `extensions`). Descoberto aplicando em produção (SQLSTATE 42883): o
    `extensions` está no search_path local mas não no do papel que aplica
    migration. E o problema maior nem é esse — default é avaliado **depois, por
    quem insere**: um default dependente de search_path quebraria todo INSERT
    vindo do PostgREST, que conecta com outro papel, longe da migration.

36. **O custo é gravado ANTES do corte por campanha.** Resposta automática de
    Flow, envio manual do painel e disparo feito por **outra ferramenta** não têm
    linha em `campaign_recipients` e cairiam no `return` — justamente o que passa
    a ser cobrado em 01/10/2026. Ledger é idempotente por `wamid` (unique +
    `ignoreDuplicates`): só o primeiro status conta, os seguintes repetem o mesmo
    `pricing` e não podem duplicar nem reescrever o valor congelado.

### O que NÃO dá para saber de outro app na mesma WABA (verificado, não suponha)

Vários apps podem estar inscritos na mesma WABA e **todos recebem os eventos**
— foi assim que o custo dos disparos feitos por outra ferramenta passou a ser
contabilizado aqui sem configuração nenhuma (comprovado em produção em
10-11/09/2026, com quatro números da Plauz numa WABA só).

O que chega desses disparos: que saiu, para quem, quando, a categoria cobrada e
o custo. **O que não chega, e não há como fazer chegar:**

- **conteúdo e nome do template** — o campo de eco da Meta chama-se
  `smb_message_echoes` e cobre **apenas** mensagens digitadas no app WhatsApp
  Business ou dispositivo vinculado, explicitamente **não** envios via Cloud API;
  e mesmo nesses casos o payload não identifica template nenhum;
- **agrupamento por campanha** — não existe no protocolo, e reconstruir por
  janela de tempo não funciona: em produção, dois disparos simultâneos e envios
  um-a-um se fundem num bloco só;
- **clique em botão de URL** — o link é da outra ferramenta e não passa pelo
  nosso `/c/`.

Quick-reply, por outro lado, **chega** (vira mensagem recebida), mas sem
destinatário a que atribuir. Conclusão prática: atribuição por campanha é
consequência de disparar daqui, não de instrumentar melhor o webhook. Não gastar
tempo procurando um jeito — não existe.

---

## Convenções de código

- TypeScript estrito (`strict: true`) em todo o projeto
- Variáveis de ambiente tipadas via `@t3-oss/env-nextjs` em `apps/web/lib/env.ts`
- Nomes de tabelas: `snake_case` plural (ex: `wa_sessions`, `media_files`)
- Nomes de Edge Functions: `kebab-case` (ex: `whatsapp-webhook`)
- Imports absolutos com `@/` no web app
- Sem `any` — use `unknown` e narrowing explícito
- Route Handlers: sempre `await params` (Next.js 16 — `params` é Promise)
- **Migrations novas usam timestamp, não sequencial**: `20260910143000_nome.sql`
  (ver "Trabalho em paralelo" abaixo). As `00NN` existentes ficam como estão —
  ordenam antes de qualquer timestamp, então as duas convenções convivem.

---

## Trabalho em paralelo (mais de um agente no mesmo repo)

Vale sempre que houver mais de uma sessão trabalhando ao mesmo tempo — e é o
padrão desde 10/09/2026, com trilhas separadas de central de shows, rastreio de
clique e custos de disparo.

**O que dá para isolar e o que não dá.** Worktree resolve arquivo e git.
**Não** resolve banco: o Supabase de produção é um só para todas as sessões, e
é ali que o estrago acontece.

1. **Um `git worktree` por trilha, nunca duas sessões na mesma pasta.**
   `git worktree add ../whats-<trilha> -b feat/<trilha>`. Sem isso, uma sessão
   commita o arquivo pela metade da outra e ninguém percebe até quebrar.

2. **`git add -A` é proibido.** Sempre `git add <caminho>` explícito. Numa
   árvore compartilhada, `-A` varre o trabalho não commitado das outras trilhas
   para dentro do seu commit.

3. **Reescrever histórico (`--amend`, `rebase`, `reset --hard`) é tão perigoso
   quanto `git add -A`.** Entre você commitar e dar o `--amend`, outra trilha
   pode ter commitado — e o amend reescreve o commit **dela**. Aconteceu em
   10/09/2026: um amend engoliu o commit de CLAUDE.md de outra sessão (nada se
   perdeu, o conteúdo era idêntico, mas foi sorte). Regra: `--amend` só no seu
   próprio worktree e só no commit que você acabou de fazer, depois de
   conferir com `git log -1` que o topo é seu. `reset --hard` numa árvore
   compartilhada apaga trabalho não commitado dos outros — use `--mixed`.

4. **Migration nova nasce com timestamp** (`date +%Y%m%d%H%M%S`). Numeração
   sequencial exige "pegar o próximo número", e duas sessões pegam o mesmo.
   Aconteceu em 10/09/2026: duas `0040` diferentes, uma aplicada e outra não —
   e como o Supabase registra pelo **número**, a segunda seria **pulada em
   silêncio** num `db push`, deixando o código sem o schema de que depende
   (mesma família da regra 10).

5. **Só a sessão que estiver integrando aplica migration em produção.** As
   demais validam localmente (ver o item 6). Duas sessões dando `db push` no
   mesmo projeto é como o número 0040 foi queimado.

6. **O Postgres local também é UM SÓ — `db reset --local` é destrutivo para
   todas as trilhas.** Não existe "meu banco local": os worktrees compartilham
   o mesmo stack Docker do `supabase start`. Aconteceu em 10/09/2026 — uma
   trilha rodou `db reset` enquanto a outra estava no meio do `npm run
   test:db`; o reset dropou o banco por baixo da suíte e morreu em
   `0001_initial.sql` com `relation "tenants" already exists`, deixando as
   duas com estado inconsistente. Verificar que o banco está vazio **não é
   suficiente**: a janela entre a checagem e o reset é exatamente onde a outra
   trilha sobe tudo. Protocolo, enquanto houver mais de uma trilha:

   ```bash
   # antes de qualquer db reset --local ou npm run test:db
   LOCK="$(git rev-parse --git-common-dir)/db-local-lock"
   cat "$LOCK" 2>/dev/null && echo "OCUPADO — esperar" && exit 1
   echo "$(git branch --show-current) $(date +%H:%M)" > "$LOCK"
   # ... rodar ...
   rm "$LOCK"
   ```

   O lock mora no **git-common-dir** (o `.git/` da árvore principal), não na
   raiz do worktree: um arquivo na sua pasta é invisível para as outras
   trilhas, que estão em outra pasta — o lock não travaria nada. Dentro do
   `.git/` ele é compartilhado por todos os worktrees e nunca entra num commit,
   sem precisar de `.gitignore`. Lock esquecido: quem chegar depois confere o
   horário e avisa o Marcelo em vez de apagar por conta própria.

7. **Arquivo compartilhado tem dono.** `proxy.ts`, `lib/utils.ts`,
   `lib/whatsapp-cloud/graphClient.ts`, `CLAUDE.md` e as Edge Functions de
   campanha são tocados por mais de uma trilha. Precisar mexer fora da sua área
   significa avisar o Marcelo e combinar quem edita — não editar e torcer.

8. **`main` publica sozinho.** Push em `main` dispara o deploy de produção na
   Vercel (ver "Notas operacionais"). Trabalho pela metade vive em branch de
   trilha; `main` só recebe o que pode ir ao ar.

9. **Antes de começar qualquer coisa**, `git fetch && git status` e leia o que
   já mudou. Commits pequenos e frequentes; não deixe pilha grande de arquivo
   não commitado — é o que torna impossível para as outras trilhas saberem o
   que é seu.

---

## Variáveis de ambiente

### apps/web (.env.local / Vercel)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_LINK_BASE_URL=         # domínio público (link.plauz.com.br); sem ele, cai no host da requisição
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # só server-side (Route Handlers)
EVOLUTION_API_URL=                # URL do VPS com Evolution API
EVOLUTION_API_KEY=                # API key global do Evolution
OPENAI_API_KEY=                   # chave de PLATAFORMA (IA embutida); fallback do BYOK
META_APP_SECRET=                  # módulo de campanhas — verificação de assinatura do webhook Cloud API
META_WEBHOOK_VERIFY_TOKEN=        # módulo de campanhas — handshake de registro do webhook
```

### Modelo de IA: embutida + BYOK opcional
A chave OpenAI é resolvida **por tenant** (`apps/web/lib/ai.ts` → `getTenantOpenAIKey`):
1. **BYOK** — override do tenant em `integrations` (`type='openai'`, `config.api_key`); ou
2. **Plataforma** — `OPENAI_API_KEY` do env (chave embutida, base do tier pago).

Regras:
- O helper **deriva o `tenant_id` do operador autenticado**, nunca do client (IDOR-safe).
- Leitura de `integrations` usa `createAdminClient()` (tabela é admin-only RLS) → o
  `.eq("tenant_id", ...)` é **obrigatório** (exceção legítima à regra 15).
- A chave **nunca** vai ao client (só `mask()` dos últimos 4) nem ao `events_log`.
- Edge Functions resolvem a chave inline (sem `_shared`) via service role.
- Admin configura/testa/remove em `/dashboard/settings` (rotas `/api/tenant/ai`).
- **Dívida datada:** mover `config.api_key` para Supabase Vault antes do 2º tenant pagante.

### supabase/functions (secrets do projeto)
```
SUPABASE_URL=                     # injetado automaticamente
SUPABASE_SERVICE_ROLE_KEY=        # injetado automaticamente
EVOLUTION_API_URL=                # URL do VPS
EVOLUTION_API_KEY=                # API key global do Evolution
OPENAI_API_KEY=                   # para Whisper e embeddings
META_APP_SECRET=                  # whatsapp-cloud-webhook — mesmo valor do apps/web
META_WEBHOOK_VERIFY_TOKEN=        # whatsapp-cloud-webhook — mesmo valor do apps/web
```

### infra/evolution (.env)
```
EVOLUTION_API_KEY=
WEBHOOK_URL=                      # URL da Edge Function whatsapp-webhook
REDIS_URL=
```

---

## Estado atual do produto (Jun 2026)

### Implementado e em produção
- Auth completo: login, registro, esqueci senha, reset de senha
- Multi-sessão: criar, conectar (QR code), desconectar, excluir sessões WhatsApp
- Captura de mensagens em tempo real via webhook Evolution → Supabase
- Download automático de mídia (imagem, áudio, vídeo, documento)
- Sincronização de histórico via `history-sync` Edge Function (processamento paralelo, lotes de 5)
- Feedback em tempo real do sync: spinner com contagem + resultado final via polling de `events_log`
- Chat list com filtro Todos / Grupos / Contatos + filtro por sessão (número)
- Reações: agrupadas como badges emoji na bolha da mensagem-alvo (coluna `reaction_to`)
- Resolução de nomes: botão por conversa + health-check periódico (a cada 5 min via pg_cron)
- Avatar de contato/grupo (`chats.avatar_url`, ver regra 22) + fallback de nome amigável
  em vez do JID bruto (regra 23) — mesmo caminho de sincronização acima
- Merge automático de chats duplicados `@lid` ↔ `@s.whatsapp.net` (session-health-check)
- Busca full-text de mensagens (`search_vector` + FTS websearch em português)
- Busca semântica via embedding (`/api/search?mode=semantic`) — código funcionando,
  threshold de similaridade 0.3, mas **a base de embeddings está vazia em produção
  (verificado 04/09/2026: 6 embeddings em 13.313 mensagens)**. O backfill de ~14,7k
  msgs registrado aqui antes existiu de fato, mas vivia nas sessões excluídas desde
  então (incluindo a "Marcelo Pessoal") — o cascade levou as mensagens e, com elas,
  os embeddings. Some-se a isso que `OPENAI_API_KEY` **não está nos secrets das Edge
  Functions**: `generate-embeddings` resolve a chave do tenant (BYOK → plataforma),
  não acha nenhuma (o único BYOK cadastrado é de outro tenant) e devolve
  `Skipped: no OpenAI key for tenant` com **HTTP 200, sem gravar erro** — por isso
  nada aparece em `events_log`. Ou seja: mensagem nova também não gera embedding, em
  nenhum dos dois canais. Consequência de roadmap: **alertas semânticos (próximo item)
  não têm base pra rodar hoje** — antes deles é preciso configurar a chave e refazer
  backfill do histórico atual.
- Envio de mensagens pelo dashboard: texto, mídia (imagem/vídeo/áudio/documento), quote (`MessageComposer`)
  - Optimistic update: mensagem aparece imediatamente; substituída pelo dado real quando webhook chega
- Mídia: signed URLs e download de transcrição usam `createAdminClient()` (bucket `media` é
  privado; o client autenticado não tem policy de storage p/ assinar). chat-view re-busca o
  signed URL até o download concluir (media_files atualiza fora da tabela `messages`)
- Transcrição de áudio via Whisper (`/api/messages/[id]/transcribe`) — usa a chave por tenant
- Resumo de conversa para gestão (`/api/chats/[id]/summarize`, gpt-4o-mini): seletor de período
  (últimas 50 / hoje / 7d / 30d / tudo) + campo de **foco por assunto** opcional; botão no header
  do chat-view; log de governança `summary_generated`
- Sistema de alertas por palavra-chave + notificações em tempo real (badge no sidebar + toast `sonner`)
- Histórico paginado de `alert_events` com marcação automática de vistos (`/dashboard/admin/alerts/history`)
- Alertas: clicar num evento leva à mensagem (`/dashboard/chat/[id]?msg=`) e a destaca
- Analytics: agregados corretos (scan paginado — corrige cap de 1000 linhas do PostgREST),
  atividade por `timestamp`, **filtro por número/instância** e **separação Grupos × Contatos**
- Gestão de operadores: convidar, alterar role (admin/operator), ativar/desativar, excluir
- Configurações de perfil: editar nome de exibição + trocar senha (com verificação da senha atual)
- IA embutida + BYOK por tenant: admin configura/testa/remove a chave OpenAI em Configurações
  (chave da plataforma como padrão; override BYOK opcional via `integrations`).
  `validateOpenAIKey` usa uma chamada real de embeddings (não `/v1/models`) p/ detectar
  `insufficient_quota` — chave sem crédito é reprovada com mensagem clara
- Menu lateral colapsável (completo ↔ só ícones), estado persistido em localStorage
- Integrações (webhook delivery com log em `events_log`)
- Realtime: atualizações de status de sessão e novas mensagens via Supabase Realtime
- Admin: `POST /api/admin/retry-media` — re-dispara downloads de mídia com falha
- Exclusão de sessão corrigida (21/07/2026): sessões com histórico grande (30k+ mensagens)
  não excluíam — DELETE cascade via PostgREST/RPC estourava o teto de 8s do role
  `authenticator`. Agora roda na Edge Function `delete-session` (lotes) + timeout do
  `authenticator` subido pra 60s; UI mostra erro via toast em vez de falhar em silêncio
  (ver regras 17/18)
- Limpeza de Storage na exclusão de sessão corrigida (22/07/2026): `delete-session` apagava
  `messages`/`chats`/`wa_sessions` (e `media_files` em cascade) mas nunca os objetos no
  bucket `media` — ficavam órfãos para sempre. Achado investigando suspeita do usuário após
  excluir a sessão "Marcelo Pessoal" (~960MB confirmados órfãos em 3 pastas de sessão do
  tenant Welcome Trips). Agora `delete-session` também limpa `storage/media/{tenant_id}/
  {session_id}/` (ver regra 18). Os ~960MB (1.839 arquivos) pré-existentes órfãos foram
  removidos manualmente em 23/07/2026 (log em `events_log`, `event_type=storage_orphan_cleanup`).
- **Auditoria completa Jun 2026** — 4 rodadas, 20+ fixes, codebase limpo
- Tenants "Plauz" e "Plauz Produções LTDA" unificados (22/07/2026) — eram dois tenants
  duplicados com o mesmo número de WhatsApp (+5541984408713) conectado duas vezes em
  instâncias Evolution diferentes. Sobreviveu `Plauz Produções LTDA`
  (`d4f8fff3-b176-4c53-bb97-69bc7ce01e5b`); a sessão duplicada com menos histórico
  (`comercial-plauz`) foi excluída via `delete-session`, `contacts`/`operators` do
  tenant absorvido foram reatribuídos, e o tenant vazio removido. Ambos os admins
  (`marcelo@plauz.com.br`, `mayara@plauz.com.br`) agora coexistem no mesmo tenant.
- Login via Google em andamento (22/07/2026) — código pronto (`/auth/callback`, botão
  no login, ver regra 19) mas **ainda não ativado**: falta habilitar o provider Google
  no Supabase Auth com Client ID/Secret do Google Cloud Console (passo manual, fora do
  alcance do CLI). Até lá, `@plauz.com.br` continua logando por senha normalmente.

### Armadilha conhecida: porta da Evolution API
A `EVOLUTION_API_URL` deve usar a porta **32769** (não 32768).
Deve estar correta em **dois lugares**:
1. Vercel → Settings → Environment Variables
2. Supabase → Edge Functions → Secrets

Se imagens/áudios não carregarem e `media-downloader` falhar com timeout,
verificar essa variável em ambos os lugares. Usar `POST /api/admin/retry-media`
para re-disparar downloads após corrigir.

### Módulo de campanhas — em produção (06/08/2026), validado com campanha real (1.889 destinatários)

Migrations `0019`–`0023` aplicadas, `META_APP_SECRET`/`META_WEBHOOK_VERIFY_TOKEN` configurados
(Vercel + secrets das Edge Functions), webhook registrado no Meta App (campo `messages`), respostas
de campanha caem na caixa de entrada compartilhada (ver "Módulo de campanhas" mais acima), clique em
qualquer botão de template é rastreado (`campaign_recipients.button_reply`), opt-out automático por
texto de botão, relatório CSV por campanha, retomada de campanha pausada por teto de tier.

**Armadilhas reais encontradas validando em produção:**

- **Segredo pro `pg_cron` autenticar numa Edge Function `verify_jwt=true`: nunca usar
  `alter database postgres set app.settings.xxx`.** Essa é a forma "óbvia" (documentada em vários
  exemplos da comunidade Supabase), mas exige privilégio que a role de conexão normal (CLI `db
  query`, dashboard REST) não tem — só funciona rodado manualmente pelo SQL Editor com a role
  `postgres` plena, um passo manual fácil de esquecer/nunca confirmar. **Achado em produção
  (06/08/2026): esse passo nunca foi feito, e toda invocação do `campaign-sender-tick` voltava 401
  `UNAUTHORIZED_NO_AUTH_HEADER` silenciosamente** — `pg_cron` marcava `succeeded` porque
  `net.http_post` é fire-and-forget (o erro só existe em `net._http_response`, não em
  `cron.job_run_details`), e toda campanha ficava travada em ~50 destinatários pra sempre (só o
  primeiro lote, disparado direto pelo botão "Disparar" com a service role key real do env,
  funcionava — mascarando o bug por completo). Padrão correto, sem privilégio elevado: tabela
  dedicada RLS deny-all (`internal_secrets`, migration `0023_internal_secrets.sql`, mesmo desenho
  de `whatsapp_cloud_credentials`), lida via `SELECT` dentro da função `security definer` do cron.
  **Ao inserir o valor nessa tabela via `psql`/CLI, cuidado com aspas literais em `.env.local`**
  (`VAR="valor"` — um `cut -d= -f2-` ingênuo captura as aspas junto, corrompendo o JWT; usar
  `sed -e 's/^"//' -e 's/"$//'` ou equivalente pra tirar).
- **Upsert em lote com `ON CONFLICT DO UPDATE` falha se o próprio lote tiver chave duplicada**
  (não é sobre já existir no banco — é a mesma `phone_e164` aparecendo duas vezes no array do
  INSERT). Erro: `ON CONFLICT DO UPDATE command cannot affect row a second time`. Achado com uma
  base real de 1.910 linhas com telefone repetido. Sempre dedupear a lista em memória (`Map` por
  chave de conflito) antes do upsert — `POST /api/campaigns` faz isso agora.
- Consequência do bug acima: como a campanha (`status='draft'`) é criada **antes** do upsert de
  destinatários, um upsert que falhava deixava um rascunho órfão sem nenhum destinatário — por
  isso `campaigns-list.tsx` tem botão "Excluir" (só pra `draft`/`ready`, preserva histórico de
  campanha que já disparou).

### Módulo de automação + central — em produção (10/09/2026), validado ponta a ponta

Migrations `0025`–`0040` aplicadas. Um número (`+55 41 8440-8675`, Índio Behn /
Dra. Rosângela) com automação `FAQ 2026` ativa, Flow `Central de shows`
publicado, agenda e FAQ com conteúdo inicial, formulário público `/f/teste`
apontando de volta para a conversa. Suíte: `npm run test:db` (SQL + e2e do
engine, do endpoint e do painel; ~200 asserções).

O que roda hoje: mensagem recebida → gate de nome/e-mail com consentimento
versionado → palavra-chave responde texto/link ou abre a central → dentro do
Flow, agenda e FAQ vindos do banco. Landing pública cadastra e devolve a pessoa
para a conversa por click-to-WhatsApp. `/reset` devolve um número de teste à
condição de desconhecido.

**Deployment Protection da Vercel foi desligada em 10/09/2026** para o
formulário público funcionar — antes disso, `/f/{slug}` e
`/api/public/cadastro/{slug}` caíam no SSO da Vercel. O `/dashboard` segue
protegido pelo auth do próprio app (Supabase + `proxy.ts`), que agora é a
**única** camada: não há mais rede de segurança da plataforma por baixo.

### Cliques e custos — em produção (10/09/2026)

Migrations aplicadas, `whatsapp-cloud-webhook` deployado. Rastreio de clique
testado ponta a ponta pela URL pública (clique conta, segunda abertura não
duplica a pessoa, preview do WhatsApp não conta, token inválido não dá erro); o
único elo não testado é a Meta anexar o token ao botão, que depende de template
aprovado. Ledger de custo capturando ao vivo, inclusive disparo feito por outra
ferramenta na mesma WABA — em 11/09/2026, ~2,4 mil mensagens e R$ 658 num
período de 40 minutos, todas com tenant e sessão resolvidos.

Rate card BRL de jul/2026 semeado; a linha de mensagem de serviço a partir de
01/10/2026 está marcada `estimated` até a Meta publicar o valor final (é um
update numa linha, e o rótulo "estimativa" some sozinho da tela). Só BR está
cadastrado: disparo para outro DDI entra com custo zero e é contado à parte.

### Agenda do Monday — em produção e validada (16/09/2026)

Ponte completa e rodando: o board **26 | SHOWS PLAUZ** alimenta a agenda da
central. Primeira sincronização real trouxe **22 shows do IB**, todos com
cidade, teatro, horário e link — nenhum campo vazio. As duas linhas manuais
de teste de 09/09 ficaram intactas, como o índice único parcial prevê.

**Publicação é escolha nossa, não do board, e é CURADORIA** (migrations
`agenda_publicado` e `agenda_chega_despublicado`, 17/09/2026):
`agenda_shows_sync.publicado` decide o que o fã vê, e **show novo do board
nasce `false`** — nada vai ao ar sem aprovação no painel (decisão do fundador;
o default da coluna nasceu `true` no mesmo dia e foi invertido horas depois,
sem reescrever as 68 linhas já publicadas).

Três coisas que sustentam isso e não podem se perder:

- **`publicado` fica fora do `do update set`** de `sincronizar_agenda_shows()`,
  nos dois sentidos: se entrasse, a aprovação sumiria no tick seguinte do cron
  (e a despublicação também voltaria), sem ninguém saber por quê. Regra para
  qualquer coluna nova ali: o que vem do board é sobrescrito, o que é decisão
  nossa fica fora.
- **O `flow-endpoint` filtra `publicado` na lista E no detalhe.** Flow aberto
  há dez minutos tem a lista antiga na tela, e o clique não pode abrir o que
  não está no ar — cai na lista, mesmo desfecho de show removido.
- **A fila tem que ser visível.** Chegar despublicado significa que uma rodada
  pode esconder dez datas novas; a tela mostra "N aguardando publicação" com
  "Publicar todos" (`POST /api/agenda/publicar`), e o resumo de cada rodada
  carrega `aguardando_publicacao`. Sem isso o recurso viraria agenda que não
  atualiza e ninguém entende por quê.

Despublicado não é arquivado: show que deixa de ser elegível no board sai da
tabela como qualquer outro.

**Arte e sinopse do espetáculo na tela do show** (migration `agenda_temas` +
board "Espetáculos" no Monday, 17/09/2026). Hierarquia:
`Artista > Espetáculo > Show > Cidade > Teatro` — o show diz QUAL é o
espetáculo, o espetáculo carrega a arte e o texto. Cinco coisas que custaram
verificação e não devem ser redescobertas:

- **O componente `Image` do Flow aceita SÓ base64** — URL não funciona. Teto
  recomendado de 300KB por imagem, 3 por tela, 1MB de payload do endpoint.
  Por isso `agenda_temas.imagem_base64` guarda o resultado pronto: converter
  a cada abertura de detalhe gastaria o orçamento de latência por clique.
- **A redução é feita pelo Storage** (`transform: { width, quality }`), que
  evita biblioteca de imagem na Edge Function. **Não** pedir `format=jpeg`
  (responde erro) e **não** deixar `Accept` pedir webp — o Flow não aceita
  webp. Arte que continue acima de 300KB depois da redução é **recusada com
  motivo** em `imagem_erro`, e a tela mostra o motivo: "sem arte" e "arte
  recusada" são coisas diferentes.
- **A arte sai do `value` da coluna de arquivo, nunca de `item.assets`** —
  assets traz todo arquivo do item (contrato, planilha). O `isImage` vem do
  Monday; com duas artes anexadas vale a última.
- **A tabela guarda o `arte_asset_id`, não a URL.** A `public_url` do Monday é
  assinada e muda a cada request: comparar URL faria baixar tudo de hora em
  hora, para sempre. É o asset id que diz se a arte mudou.
- **A ligação show → espetáculo é por NOME** (decisão do fundador: sem coluna
  de conexão no board de shows). `chave_texto()` normaliza os dois lados
  (minúsculo, sem acento) e é coluna gerada com o índice único, mesmo padrão
  de `chave_telefone()` (regra 25). O preço é que rename desfaz o casamento,
  então a tela **lista os espetáculos de shows que não acharam tema** e o
  `flow_endpoint_tela` registra `temaEncontrado` — sem isso, arte que
  desaparece não tem explicação visível.

**A agenda é espelho: não há mais cadastro manual de show** (decisão do
fundador, 16/09/2026 — `POST /api/agenda` removido). Linha sincronizada não é
editável na tela de propósito: a rodada seguinte do sync desfaria a edição, e
campo que volta ao valor antigo sozinho é pior que campo que não deixa editar.
`PATCH`/`DELETE` de `/api/agenda/[id]` continuam existindo só para limpar o
que sobrou da época do cadastro à mão, e a tela marca essas linhas como "fora
do board".

O filtro de cada agenda é editável em `/dashboard/admin/agenda`; os chips
mostram a **união** das opções do board com o que está gravado, para que um
rótulo renomeado no board apareça marcado como "fora do board" em vez de
desaparecer da tela continuando gravado.

**Dependências que ficaram no lado do `plauz-core`** (repo `plauz-core`, ADR
0009): `painel_shows.shows_do_board` (espelho fiel do board),
`app/api/interno/agenda` (bearer `AGENDA_API_TOKEN`) e o cron diário como
piso — a cadência real é deste lado, de hora em hora. Achado no caminho e
corrigido lá: **o `proxy.ts` do painel-shows bloqueava toda rota de máquina**
com `307 → /login`, incluindo os dois crons dele e o webhook do monday, que
nunca tinham executado.

### Página pública do artista — em produção (17/09/2026)

`/a/{slug}` com perfil, blocos editoriais e blocos de agenda **gerados** da
agenda sincronizada; `/l/{bloco}` contando clique; métricas com aberturas,
cliques, taxa, série de 30 dias, ranking por botão e **datas mais clicadas**.
Duas páginas no ar (`drarosangela`, `diogoalmeida`), com tema por página.

Card de show no formato de agenda de ticketeira, com selos vindos do board
(`🔥 Quase Esgotado` chega intacto — emoji atravessa tudo) e período
**derivado da data**. `Confirmado` vira "Lista de espera".

### Vigilância, CI, arte e retenção — 18/09/2026

Resposta às quatro frentes aprovadas na revisão de 17/09.

52. **`events_log` passou a ser LIDO** (migration `vigilancia_events_log`).
    `assinatura_erro()` troca número e **palavra com dígito** por `#` — é o que
    faz 57 timeouts com id diferente virarem uma linha; trocar todo token
    hexadecimal estragaria palavras como "face" e "dead", por isso a regra é
    "palavra que contém dígito". `/dashboard/admin/saude` mostra o agrupado com
    **reconhecer** (que não apaga: ocorrência nova depois do ack volta a
    contar). Um `pg_cron` no minuto 12 avisa **assinatura nova** (nunca vista
    em 30 dias) ou **volume > 20 no dia**, no máximo **uma vez por dia por
    assinatura** — alerta repetido de hora em hora vira ruído, e ruído é o que
    faz alerta ser ignorado. A entrega reusa o `webhook-delivery` e as
    integrações do tenant: **sem webhook ativo, o aviso não sai** (a tela diz
    isso). A SELEÇÃO (`erros_para_avisar()`) é função separada do ENVIO, para
    ter teste sem disparar HTTP.
53. **CI que pega regressão** (`.github/workflows/ci.yml`): job `web`
    (tipos + lint + build) e job `banco` (`supabase start` → `db reset` →
    `npm run test:db`, ~5 min). O lint roda por **linha de base**
    (`.eslint-baseline.json`, hoje 8): o CI trava o **nono** erro, sem obrigar
    a refatorar componentes em produção. A base só desce — o script avisa
    quando alguém corrige algo e o número pode cair.
54. **Arte do espetáculo na página**: aparece **uma vez, no topo do grupo** —
    a arte é do espetáculo, não da data, e repeti-la em 12 cards seria ruído.
    Servida pela transformação do Storage (CDN), não em base64: base64 é
    exigência do Flow, não da web. `agenda_temas.imagem_path` guarda o caminho
    porque adivinhar a extensão erraria quando a arte for PNG.
55. **Retenção de 13 meses** para `pagina_cliques`/`pagina_visitas`
    (`pg_cron` mensal): **consolida antes de apagar** em
    `pagina_metricas_mensais`, senão o expurgo levaria a série histórica junto
    e alguém descobriria só ao comparar com o ano anterior. 13 e não 12 para
    permitir essa comparação. **Ainda sem retenção:** `events_log` e
    `messages`/`media_files` — a segunda é dado pessoal de cliente e o prazo é
    decisão de negócio.

63. **Variável de template tem DOIS lugares, e o cabeçalho é um deles**
    (18/09/2026). O disparador mandava toda coluna do CSV como parâmetro de
    **corpo**; um template com a variável no **cabeçalho** ("Olá, {{1}}")
    fazia a Meta recusar **100%** dos envios com `(#132000) Number of
    parameters does not match the expected number of params`. Cabeçalho e
    corpo numeram placeholders **independentemente** — os dois começam em
    `{{1}}` —, então o número não diz o destino: quem diz é o componente em
    que o placeholder está (`campaign-sender/variaveis.ts`). A convenção do
    CSV é **cabeçalho primeiro, corpo depois**, e a tela passou a dizer isso.
    Três guardas novas, porque o erro só aparecia depois, no `error` de cada
    destinatário: a contagem da tela agora soma cabeçalho + corpo (contava só
    o corpo, e por isso o template aparecia como "0 variáveis"); `POST
    /api/campaigns` **recusa** a campanha quando o CSV traz número diferente
    do esperado; e template com cabeçalho de **mídia** (IMAGE/VIDEO/DOCUMENT)
    é recusado com o motivo — ainda não montamos esse parâmetro, e sem a
    guarda ele falharia igual, 100%, só que em silêncio.

62. **A pausa por qualidade é por TAXA, não na primeira recusa** (migration
    `pausa_por_taxa`, 18/09/2026). O erro **131049** ("healthy ecosystem
    engagement") tem dois significados que o webhook não distingue: a parede
    de qualidade do número — o caso de 07/08/2026, com 76-92% de falha depois
    do primeiro sinal — e o **teto individual de marketing**, que a Meta aplica
    a UMA pessoa e é rotina. Parar na primeira ocorrência tratava os dois
    igual: em 18/09 uma campanha de 631 foi pausada **16 segundos** depois do
    disparo, com 4 falhas em 100 processados e 92% de entrega, deixando 531
    pessoas paradas. Agora a pausa exige **≥10 falhas E ≥20% nos últimos 50
    processados** (`taxa_de_falha_recente`) — os dois critérios juntos porque
    só a proporção dispara com 2 de 3 no começo, e só o número absoluto deixa
    passar 10 em 5.000; o caso de agosto cruza os dois em segundos. Recusa
    isolada agora vira `campaign_qualidade_ignorada` no log: sem esse registro,
    "a Meta recusou um número" e "está tudo bem" ficam indistinguíveis. E o
    motivo passou a viver em `campaigns.pause_reason`, **na tela** — campanha
    que para sozinha sem dizer por quê chega a quem disparou como "deu um
    erro", que foi exatamente como chegou.

61. **A lista de shows do Flow PAGINA — 20 é teto do componente** (18/09/2026).
    `RadioButtonsGroup` aceita no máximo 20 opções (doc da Meta); com 26 datas
    publicadas, o fã via até a vigésima (Maceió) e **nada** dizia que havia
    mais seis. Subir o número não mostra mais shows: quebra a tela. A saída foi
    gastar uma das 20 vagas com um item de navegação (`pagina:<offset>` — uuid
    não tem `:`, então nunca se confunde com um show) e devolver a **própria
    tela AGENDA** com o lote seguinte. Funciona porque **quem escolhe a tela da
    resposta é o endpoint, não o JSON publicado** — paginar não exigiu Flow
    novo, nem descontinuar o atual, nem invalidar template aprovado. A agenda
    inteira é relida a cada página (uma consulta por toque) em vez de guardar
    estado de paginação: o Flow só devolve o item escolhido, e inventar sessão
    de página seria estado novo para sincronizar.

    **Flow paralelo de avaliação** (`AGENDA_LONGA`/`DETALHE_LONGO`, Dropdown de
    até 200): convive no mesmo número e no mesmo endpoint, aberto pela palavra
    `agenda2`. Duas coisas que ele obrigou a resolver e valem para qualquer
    segundo Flow: **id de tela não aceita dígito** (`AGENDA_V2` é recusado com
    `PATTERN_MISMATCH` — só letras e underscore), e **no `INIT` a Meta não diz
    qual Flow foi aberto**; quem diz é a sessão (`flow_sessoes.flow_id`) lida
    pelo `flow_token`, e a coluna `whatsapp_flows.tela_inicial` declara por
    onde aquele Flow começa. Sem isso, abrir o paralelo devolvia a
    apresentação da central — sem erro, só a tela errada.

60. **O gate CONFIRMA que terminou** (18/09/2026). Quem mandava o e-mail
    recebia, como próxima mensagem, o **fallback** — texto escrito para quem
    perguntou algo que não entendemos ("Da próxima vez, é só escrever *menu*"),
    lido como correção de um erro que o fã não cometeu. Duas causas somadas:
    o e-mail é o último campo, então não sobra pergunta onde embutir um
    "Anotado!" (o do nome vive dentro de `pedirEmail`); e a pergunta guardada
    em `mensagem_pendente` costuma ser um "olá", que não bate palavra-chave
    nenhuma e cai no fallback. O motor já tinha o lugar certo —
    `mensagem_boas_vindas` é enviada antes de keyword/fallback, uma vez por
    contato ([`flow-engine/index.ts:564`]) — e estava **vazia**. É dado, não
    código: entrou sem deploy e sem republicar Flow. O texto vale também para
    quem já era cadastrado e escreve pela primeira vez, porque a mesma
    mensagem serve aos dois.

59. **Campanha tem CANCELAR, e cancelar não apaga** (migration
    `cancelar_campanha`, 18/09/2026). Uma campanha pausada por teto de tier só
    tinha "Retomar" — quem decidia não continuar ficava sem saída, e os
    destinatários restantes ficavam `pending` para sempre (achado com uma
    campanha real: 400 de 5.174 processados). Cancelar marca quem ainda não
    recebeu como `cancelled`, e isso importa por dois motivos:
    `claim_campaign_recipients` só reivindica `pending`, então nem o cron nem
    um "Retomar" acidental disparam o resto; e o relatório passa a mostrar
    quantos nunca foram enviados. **O que já saiu permanece** — é o histórico
    que explica a fatura, e para apagar não existe caminho (o "Excluir" é só
    para rascunho). Campanha concluída ou falha **não** pode ser cancelada:
    seria reescrever história.

58. **O assistente de campanha escolhe DE QUAL número disparar.** Até
    18/09/2026 ele usava sempre `credentials[0]` e o botão "Trocar número"
    abria o cadastro de uma credencial NOVA — com quatro números cadastrados,
    não havia como escolher (achado pelo fundador). A rota
    `/api/campaigns/templates` já aceitava `?credentialId=` desde a
    multi-número; **faltava só a tela**, e o comentário no código dizia que o
    seletor "entra na Sprint A2" — entrou agora. Detalhes que a UI passou a
    dizer: o template é aprovado na **conta (WABA)**, então números da mesma
    WABA oferecem a mesma lista (os quatro da Plauz estão na mesma), e o que
    muda é **quem aparece para quem recebe** — mais o limite e a nota de
    qualidade daquele número. Trocar o número **limpa o template escolhido**, e
    cadastrar um número novo passa a selecioná-lo na hora.

57. **O fallback pode abrir a central** (migration `fallback_abre_central`,
    18/09/2026): `whatsapp_flows.fallback_flow_destino_id` faz a resposta
    padrão mandar o texto **e** o balão, atendendo "responder qualquer coisa
    sem depender de palavra-chave". Três coisas que não mudaram, de propósito:
    **palavra-chave continua tendo prioridade** (quem escreve "ingresso" recebe
    a resposta específica); o **texto vem antes do balão** (balão solto parece
    resposta errada); e a **pausa por 3 fallbacks consecutivos continua
    valendo** — oferecer a central indefinidamente a quem está tentando falar
    com uma pessoa é exatamente a repetição que a pausa existe para impedir, e
    balão interativo incomoda mais que texto. O destino é validado como o de
    palavra-chave (tipo abrível, ativo, mesmo número) e não pode ser o próprio
    Flow.

    **Conta que muda em 01/10/2026:** responder a tudo é mensagem de serviço, e
    `whatsapp_rates` registra serviço a **R$ 0,00 até 30/09** e **R$ 0,035
    (estimado) a partir de 01/10**. Hoje é grátis; com a base do Linktree
    chegando ao WhatsApp, "responder qualquer coisa" passa a ter preço por
    conversa.

56. **Os selos do board também chegam ao Flow — sem republicar.** `title` do
    item de lista tem **30 caracteres** e `description` tem 300 (doc da Meta);
    `metadata` (20) e `color` existem a partir da versão 5.0 e a nossa é 7.2,
    **mas usá-los exigiria declarar propriedade nova na tela**, ou seja Flow
    novo + descontinuar + invalidar template aprovado (ver o item de
    republicação acima). Então os selos entram na **descrição**, que já existe
    no contrato publicado: `data · teatro · status · período · ingressos`. No
    detalhe, o mesmo — juntos no campo `status`.

    **E o limite de 30 não era respeitado:** `cidade · teatro` passava de 30 em
    **17 dos 26** shows do IB (achado em 18/09/2026), então o fã via nome
    cortado no meio — *"Foz do Iguaçu/PR · Rafain Pala…"*. Hoje `title` é só a
    cidade (o pior caso real, "São José dos Campos/SP", tem 22) e o teatro
    desceu para a descrição. Os dois campos são cortados no limite por
    garantia. **Regra:** ao mexer na lista do Flow, conferir contra os dados
    REAIS, não contra o exemplo do JSON — o `__example__` sempre cabe.

**Aviso ativo em standby (decisão do fundador, 18/09/2026).** A vigilância
está completa, mas **nenhum destino foi escolhido** — nem webhook, nem e-mail,
nem WhatsApp. A leitura é pela tela de Saúde, e a tela diz isso em texto
neutro (não em alerta: é escolha, não defeito). Quando for reavaliado, o que
já está levantado: e-mail via provedor (Resend, sem fila, chave de API) sai no
mesmo dia; **WhatsApp exige template novo aprovado** — mesmo sendo o próprio
número do admin, a Meta só permite texto livre dentro de 24h após ELE
escrever, e os três templates UTILITY aprovados hoje são de RSVP do Diogo, que
não servem; Slack e Discord recusam o corpo que o `webhook-delivery` envia
(`{event, payload, timestamp}`) com 400 e precisariam de um campo de formato;
n8n e Make funcionam só cadastrando a URL.

**Renomear artista é VARREDURA, não lista de tabelas** (18/09/2026). A
primeira correção listou as quatro tabelas que eu lembrava e deixou duas —
`faq_itens.artista` e `formularios_cadastro.artista` também casam por nome.
Com a credencial já corrigida e os itens não, **a tela de dúvidas da central
respondeu vazia por 15 minutos**, sem erro nenhum: o `flow-endpoint` filtra a
FAQ por `artista.eq.<credencial> or artista.is.null`, e ninguém erra — some.
A correção certa varre `information_schema.columns` por **toda** coluna
`artista` e usa `replace()` nos textos livres (o balão de convite trazia o
nome no meio da frase, e igualdade não pegaria). Vale para qualquer troca de
nome de artista daqui para frente, inclusive na replicação.

**O nome do artista é CHAVE DE JUNÇÃO, não rótulo** (corrigido em
18/09/2026: era "Rosangêla", é **Rosângela**). O `flow-endpoint` acha os shows
comparando `whatsapp_cloud_credentials.artista` com `agenda_shows_sync.artista`
por igualdade literal (regra 38c), e `whatsapp_flows.artista` e
`paginas_publicas.artista` carregam a mesma string. Corrigir a grafia em um
lado só faz a central servir agenda **vazia**, sem erro nenhum — por isso a
correção foi uma migration, com as quatro tabelas na mesma transação, e não
três edições pelo painel. O `slug` da página (`drarosangela`) **não** muda:
é URL pública já divulgada, e slug é minúsculo sem acento de propósito
(regra 42).

**Armadilha que se repete a cada coluna nova:** quando `imagem_path` entrou, a
arte não havia mudado, então o processamento era pulado e a coluna ficaria
vazia para sempre, esperando backfill manual. A condição do sync passou a
incluir `|| !atual?.imagem_path` — **coluna nova precisa de um caminho de
autocorreção**, não de alguém lembrar.

### Pendente / próximos passos
- **Central de shows — Sprint C4: código pronto (15/09/2026), falta a Meta.**
  `campaign-sender` preenche o botão de Flow com o `flow_token` de cada
  destinatário e cria as sessões em lote; a UI de campanha escolhe qual central
  abrir; validação em três camadas (ver regra 37). Suíte local cobre o trigger,
  o token e o `on delete restrict`. **O que falta é externo:** aprovar na Meta
  um template com botão de Flow (tem fila) — até lá nada disso roda ponta a
  ponta, exatamente como o rastreio de clique ficou esperando template
  aprovado. Depois, C5: piloto com um artista, um número, uma campanha.
- **Conteúdo da central (parcial, 15/09/2026):** `mensagem_convite` da central
  e os textos do gate já são copy de verdade, na voz do espetáculo (decisão do
  fundador) — o gate subiu para `VERSAO_CONSENTIMENTO_GATE = "gate-v2-2026-09"`
  porque o trecho legal mudou (regra 26), e a apresentação nomeia o artista
  **daquele número** (`whatsapp_flows.artista` interpolado; texto neutro quando
  não há artista — nome fixo no motor saudaria o fã do próximo tenant com o
  artista errado). **Falta dado de negócio:** os dois shows da agenda ainda têm
  link de BUSCA DO GOOGLE como `link_compra` e data de teste (24/12/2026
  23:59) — resto da validação de 09/09. Mantidos de propósito em 15/09/2026
  (decisão do fundador: nenhum fã chega à central ainda, o template de Flow não
  está aprovado e a keyword só responde no número de teste), mas **é bloqueio
  do piloto C5**: quem tocar em "Abrir página de ingressos" hoje cai numa busca
  do Google. FAQ tem 3 itens genéricos, plausíveis mas não revisados pelo
  artista.
- **Domínio próprio `link.plauz.com.br` — NO AR (21/09/2026).** Falta só
  submeter o template com botão rastreado à Meta.**
- **Dois hosts, dois papéis (22/09/2026).** `link.plauz.com.br` é o que o fã
  abre; `whats.plauz.com.br` é o painel. Cookie é por host, e sessão de admin
  não precisa existir no endereço que milhares de desconhecidos abrem — com os
  dois separados, uma falha futura numa página pública não tem sessão de admin
  ao alcance. Só o caminho de ENTRADA redireciona (`proxy.ts`: `/login` e
  `/dashboard` abertos pelo host público mandam para
  `NEXT_PUBLIC_PANEL_BASE_URL`); o contrário — link de página pública já
  copiado, aberto pelo host do painel — continua servindo normalmente, porque
  quebrar isso seria pior que servir a mesma página por dois endereços.
  `/auth/` fica fora da regra de propósito: é o retorno do OAuth, amarrado ao
  host que iniciou o fluxo. Cookie novo por host: primeiro acesso a
  `whats.plauz.com.br` pede login de novo, mesmo para quem já estava logado em
  `link.` ou no `.vercel.app`. Bloqueia o template com botão rastreado: URL crua da Vercel num
  botão de marketing lê como phishing, derruba clique e chama atenção na
  revisão da Meta; e como a URL fica **congelada no template aprovado**,
  trocar depois é outro ciclo de aprovação. Também resolve a landing e a
  página do artista, que hoje vivem em `web-ten-gray-14.vercel.app`.
  **O bloqueio registrado em 11/09 ("sem acesso ao DNS") estava vencido:** o
  `plauz.com.br` está no Cloudflare e já tinha três subdomínios apontando para
  projetos Vercel (`artistas.`, `ads.`, `hahaha.`), todos CNAME em DNS-only —
  o caminho estava trilhado e testado. `CNAME link →
  5c63d1eabac4e23a.vercel-dns-017.com` (DNS-only: com o proxy do Cloudflare
  ligado, a Vercel não emite nem renova o certificado), domínio anexado ao
  projeto, `NEXT_PUBLIC_LINK_BASE_URL` em produção. Verificado no ar:
  `/a/{slug}`, `/f/{slug}`, `/login`, e o fallback de `/c/` e `/l/`.
  **Falta submeter à Meta** um template com botão de URL **dinâmica**
  terminando em `https://link.plauz.com.br/c/{{1}}` (regra 32) — é o único elo
  do rastreio de clique que nunca rodou.
- **Dívidas menores, revistas em 17/09/2026** (ver
  `docs/revisao-17-09-2026.md`): o ESLint tem **8 erros**, não um — seis são o
  mesmo `react-hooks/set-state-in-effect` (`chat-view` ×2, `search-bar`,
  `session-card`, `sidebar`, `reset-password`, `costs-dashboard`) mais um
  `react-hooks/immutability`. Com oito presentes, `npx eslint` deixou de servir
  como sinal. Seguem abertos: `handleReport` engole falha em silêncio; status
  de entrega de mensagem fora de campanha não é guardado; custo por template
  (já dá com `campaigns.template_name`). E **respondido**: os apps inscritos na
  WABA são três — `Business Agent` (da Meta, inscrito e recebendo tudo),
  `Plauz - Disparo Interno` e `Plauz Disparo`; a documentação ainda não diz
  qual é o nosso.
- **Nada vigia o `events_log`** — o gap sistêmico apontado na revisão. Em
  12–14/09 houve um surto de 86 `Gateway Timeout` no caminho do webhook de
  custo/status (pico de 71 erros em 13/09) que passou sozinho e **ninguém
  soube**. E 33 eventos de custo do número do DA foram descartados entre 11 e
  14/09, antes de a credencial existir aqui — sem recuperação retroativa,
  porque a Meta manda o `pricing` uma vez só.
- **A ponte está completa só para o IB — e isso é deliberado.** O DA tem 43
  shows publicados e página no ar sem central no WhatsApp; a CD tem agenda
  sincronizando e 0 de 7 shows publicados; o número `+55 12 3199-2996` está sem
  artista. **Decisão do fundador (18/09/2026): o sistema está sendo construído
  como um todo, e a replicação para os demais artistas acontece UMA VEZ,
  quando o conjunto for considerado pronto.** Portanto: não tratar essas
  lacunas como pendência a resolver artista a artista, e sim como o estado
  esperado até o momento da replicação. O que elas exigem é que o caminho de
  replicação seja barato e repetível (Flow + palavras-chave + agenda + página),
  não que alguém saia configurando artista por artista agora.
- **A suíte (300+ asserções) roda só localmente.** O CI só deploya — e até
  17/09 deployava 11 das 12 Edge Functions, sem o `agenda-sync`.
- **Roadmap de inteligência** (wedge defensável, reordenável) — próximo é alertas semânticos:
  - Alertas semânticos (evoluir os alertas por palavra-chave para detecção de risco por
    significado). Colunas em `alerts` (`type` keyword|semantic, `semantic_query`,
    `query_embedding vector(1536)`, `threshold`) — migration `0012_semantic_alerts.sql`
    **já aplicada em produção** (21/07/2026). **Falta implementar** a checagem semântica
    dentro da `generate-embeddings` (onde o embedding da mensagem já existe), comparando com o
    embedding da consulta do alerta.
  - Compliance/LGPD: retenção, trilha de auditoria, exportação
  - Operação mínima do inbox (status/quick-replies) — só se/quando ≥2 operadores reais
- Áudio transcrito não gera embedding (busca semântica não cobre áudios) — limitação conhecida
- Medição de uso/quota de IA por tenant — pré-requisito para cobrar o tier embutido

### Notas operacionais desta fase (Jun–Jul 2026)
- **Aplicação de migrations/secrets:** um Personal Access Token da Supabase com escopo de owner
  (gerado em supabase.com/dashboard/account/tokens) resolve o 403 visto anteriormente — com ele
  `supabase link --project-ref byuggqcnvezendgrcysb` + `supabase db push` funcionam normalmente.
  Um token de escopo mais restrito ainda pode dar 403; nesse caso, rodar o SQL no **SQL Editor do
  dashboard** do Supabase como alternativa. O deploy do web (Vercel CLI) sempre funcionou normalmente.
- **Histórico de migrations fora de sincronia:** como migrations passadas foram aplicadas via SQL
  Editor (sem passar pelo CLI), a tabela `supabase_migrations.schema_migrations` remota não as
  registrava — `supabase migration list` mostrava tudo como não aplicado e `db push` tentava
  reaplicar desde a 0001, falhando com "relation already exists". Corrigido em 21/07/2026 com
  `supabase migration repair --status applied 0001 ... 0011`. Novas migrations devem seguir sendo
  aplicadas via `supabase db push` a partir de agora para não reabrir esse desalinhamento.
- **Acesso Vercel/Supabase neste ambiente:** projeto Vercel `wa-intelligence` (org
  `marcelos-projects-017e3fe7`) linkado em `apps/web/`; projeto Supabase `byuggqcnvezendgrcysb`
  (`ccka_whats`) linkado na raiz. **Deploy do web é pelo git**: push em `main` dispara o deploy de
  produção sozinho. Não rodar `vercel --prod` na mão — de `apps/web/` o build falha com
  "The specified Root Directory \"apps/web\" does not exist" (o projeto já tem `apps/web` como
  Root Directory, e subir de dentro dela duplica o caminho) e da raiz o CLI cria um projeto
  Vercel NOVO em vez de usar o `wa-intelligence` (aconteceu em 10/09/2026). Tokens não ficam
  salvos no repo nem em memória — se precisar religar em uma sessão nova, pedir novos tokens (Vercel: vercel.com/account/tokens; Supabase:
  supabase.com/dashboard/account/tokens) e rodar `vercel link` / `vercel env pull apps/web/.env.local`
  e `supabase link --project-ref byuggqcnvezendgrcysb`.
- **BYOK:** `config.api_key` em `integrations` está em texto plano — mover para Supabase Vault
  antes do 2º tenant pagante (dívida datada).
- **Escala do Analytics:** faz scan paginado de todas as mensagens (teto de 200k). Acima disso,
  migrar para uma função SQL com `GROUP BY`.
- Medição de uso/quota por tenant — pré-requisito para cobrar o tier de IA embutida
- Webhook secret visível na página de Integrações (copiar token sem acessar o banco)

---

## Debugging em produção

### Edge Functions — códigos de status relevantes
| Status | Significado |
|--------|-------------|
| 401 | JWT inválido — verificar `verify_jwt: false` no `config.toml` e flag `--no-verify-jwt` no CI |
| 546 | **Timeout** — Edge Function excedeu 150s. Causa comum: loop sequencial com await em muitos itens |
| 500 | Erro interno. Ver aba Logs no Dashboard ou `events_log` |

### Como investigar via events_log
```bash
# Últimos erros (usar via REST com service role key):
GET /rest/v1/events_log?event_type=eq.error&order=created_at.desc&limit=20

# Verificar se sync rodou:
GET /rest/v1/events_log?event_type=eq.webhook_received&payload->>type=eq.history_sync_completed&order=created_at.desc&limit=5

# Ver entregas de webhook:
GET /rest/v1/events_log?event_type=eq.webhook_delivery&order=created_at.desc&limit=20

# Ver health-checks:
GET /rest/v1/events_log?event_type=eq.health_check_ran&order=created_at.desc&limit=10

# Nomes sincronizados:
GET /rest/v1/events_log?event_type=eq.names_synced&order=created_at.desc&limit=10
```

### Armadilha: insert em LOTE não usa o default da coluna
Num insert com array de objetos, o PostgREST monta a lista de colunas pela **união das chaves**
e manda `NULL` onde a chave falta — o `DEFAULT` da coluna **não** entra. Se a coluna for
`not null default <x>`, o lote inteiro falha com `null value in column "..." violates not-null
constraint`, mesmo que a linha "certa" tenha o valor. Achado em 09/09/2026 escrevendo fixtures
de `faq_itens` (`ativo`) e `flow_sessoes` (`expira_em`), duas vezes seguidas. Regra prática:
em insert de lote, **todas as linhas informam as mesmas chaves** — ou usar inserts separados.
Mesma família da armadilha de `ON CONFLICT` com chave duplicada no próprio lote (ver "Módulo
de campanhas").

### Armadilha: falha silenciosa em upsert
O Supabase JS client retorna `{ data: null, error }` quando um upsert falha (ex: coluna inexistente).
Se o código só destructura `{ data }` e ignora `error`, a mensagem é descartada sem nenhum log.
**Sempre** checar e logar `error` em operações críticas de DB.

### Operações secundárias (update de campos de estado)
Atualizações de campos como `delivery_status`, `deleted_at`, `edited_at`, `last_seen_at`,
`last_message_body` e nomes de chat usam `console.error` em falha (não `events_log`).
São operações de baixo impacto: a mensagem já foi salva; apenas um campo de estado fica
desatualizado até o próximo evento ou health-check corrigir.
