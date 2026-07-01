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
| WhatsApp | Evolution API (VPS Hostinger) |
| Ingestão | Supabase Edge Functions (Deno) |
| Banco | Supabase PostgreSQL + pgvector |
| Storage | Supabase Storage |
| Auth | Supabase Auth + RLS multi-tenant |
| Realtime | Supabase Realtime |
| Frontend | **Next.js 16.2.9** (App Router) + Tailwind |
| Deploy web | Vercel |
| Deploy VPS | Docker Compose (Hostinger) |

### Atenção: Next.js 16

Next.js 16 tem breaking changes. Leia `apps/web/AGENTS.md` antes de tocar no frontend.
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
│       │   │   ├── admin/integrations/
│       │   │   ├── admin/history/
│       │   │   ├── analytics/
│       │   │   ├── settings/
│       │   │   └── chat/[id]/
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
│       │       └── register/
│       └── components/
│           ├── chat-list.tsx         ← filtro Todos/Grupos/Contatos
│           ├── chat-view.tsx
│           ├── session-card.tsx      ← QR, status, delete com confirmação
│           ├── sidebar.tsx           ← dot de status das sessões
│           └── ...
│
├── packages/
│   └── types/                    ← tipos compartilhados
│
├── supabase/
│   ├── migrations/               ← SQL versionado (0001–0011)
│   └── functions/
│       ├── whatsapp-webhook/     ← recebe eventos do Evolution (JWT off)
│       ├── media-downloader/     ← baixa mídias antes de expirar (JWT off)
│       ├── history-sync/         ← sincroniza histórico via Evolution API
│       ├── generate-embeddings/  ← embeddings OpenAI para busca semântica
│       ├── session-health-check/ ← monitora sessões periodicamente (JWT off)
│       └── webhook-delivery/     ← entrega webhooks para integrações
│
└── infra/
    └── evolution/                ← docker-compose + .env.example do VPS
```

---

## Regras inegociáveis de arquitetura

1. **`tenant_id` em toda tabela** — sem exceção. RLS filtra por tenant em tudo.
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

---

## Convenções de código

- TypeScript estrito (`strict: true`) em todo o projeto
- Variáveis de ambiente tipadas via `@t3-oss/env-nextjs` em `apps/web/lib/env.ts`
- Nomes de tabelas: `snake_case` plural (ex: `wa_sessions`, `media_files`)
- Nomes de Edge Functions: `kebab-case` (ex: `whatsapp-webhook`)
- Imports absolutos com `@/` no web app
- Sem `any` — use `unknown` e narrowing explícito
- Route Handlers: sempre `await params` (Next.js 16 — `params` é Promise)

---

## Variáveis de ambiente

### apps/web (.env.local / Vercel)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # só server-side (Route Handlers)
EVOLUTION_API_URL=                # URL do VPS com Evolution API
EVOLUTION_API_KEY=                # API key global do Evolution
OPENAI_API_KEY=                   # chave de PLATAFORMA (IA embutida); fallback do BYOK
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
- Merge automático de chats duplicados `@lid` ↔ `@s.whatsapp.net` (session-health-check)
- Busca full-text de mensagens (`search_vector` + FTS websearch em português)
- Busca semântica via embedding (`/api/search?mode=semantic`) — embeddings do histórico
  já backfilled (~14,7k msgs); threshold de similaridade 0.3
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
- **Auditoria completa Jun 2026** — 4 rodadas, 20+ fixes, codebase limpo

### Armadilha conhecida: porta da Evolution API
A `EVOLUTION_API_URL` deve usar a porta **32769** (não 32768).
Deve estar correta em **dois lugares**:
1. Vercel → Settings → Environment Variables
2. Supabase → Edge Functions → Secrets

Se imagens/áudios não carregarem e `media-downloader` falhar com timeout,
verificar essa variável em ambos os lugares. Usar `POST /api/admin/retry-media`
para re-disparar downloads após corrigir.

### Pendente / próximos passos
- **Roadmap de inteligência** (wedge defensável, reordenável) — próximo é alertas semânticos:
  - Alertas semânticos (evoluir os alertas por palavra-chave para detecção de risco por
    significado). Design previsto: colunas novas em `alerts` (`type` keyword|semantic,
    `semantic_query`, `query_embedding vector(1536)`, `threshold`); a checagem semântica roda
    dentro da `generate-embeddings` (onde o embedding da mensagem já existe), comparando com o
    embedding da consulta do alerta. **Precisa de migration** (ver nota de DDL abaixo).
  - Compliance/LGPD: retenção, trilha de auditoria, exportação
  - Operação mínima do inbox (status/quick-replies) — só se/quando ≥2 operadores reais
- Áudio transcrito não gera embedding (busca semântica não cobre áudios) — limitação conhecida
- Medição de uso/quota de IA por tenant — pré-requisito para cobrar o tier embutido

### Notas operacionais desta fase (Jun–Jul 2026)
- **Aplicação de migrations/secrets:** o token Supabase disponível via CLI dá **403** para
  operações privilegiadas (deploy de Edge Function, set de secrets, provavelmente DDL). Deploys
  de Edge Function e migrations DDL precisam de um token com privilégio de owner, ou rodar o SQL
  no **SQL Editor do dashboard** do Supabase. O deploy do web (Vercel CLI) funciona normalmente.
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

### Armadilha: falha silenciosa em upsert
O Supabase JS client retorna `{ data: null, error }` quando um upsert falha (ex: coluna inexistente).
Se o código só destructura `{ data }` e ignora `error`, a mensagem é descartada sem nenhum log.
**Sempre** checar e logar `error` em operações críticas de DB.

### Operações secundárias (update de campos de estado)
Atualizações de campos como `delivery_status`, `deleted_at`, `edited_at`, `last_seen_at`,
`last_message_body` e nomes de chat usam `console.error` em falha (não `events_log`).
São operações de baixo impacto: a mensagem já foi salva; apenas um campo de estado fica
desatualizado até o próximo evento ou health-check corrigir.
