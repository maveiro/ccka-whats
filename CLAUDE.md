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

---

## Fases do produto

```
FASE 1 (agora)     → 1 número pessoal, lab, captura + busca simples
FASE 2 (próximo)   → N números corporativos, governança, backup histórico
FASE 3 (futuro)    → SaaS multi-tenant, integrações, agentes com contexto
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
| Frontend | Next.js 15 (App Router) + Tailwind |
| Deploy web | Vercel |
| Deploy VPS | Docker Compose (Hostinger) |

---

## Estrutura do monorepo

```
wa-intelligence/
├── CLAUDE.md                     ← este arquivo
├── README.md
├── package.json                  ← workspace root
├── turbo.json                    ← Turborepo
│
├── apps/
│   └── web/                      ← Next.js 15 (dashboard)
│
├── packages/
│   ├── database/                 ← tipos TypeScript do schema
│   ├── types/                    ← tipos compartilhados
│   └── utils/                    ← funções utilitárias
│
├── supabase/
│   ├── migrations/               ← SQL versionado
│   └── functions/
│       ├── whatsapp-webhook/     ← recebe eventos do Evolution
│       ├── media-downloader/     ← baixa mídias antes de expirar
│       └── session-health-check/ ← monitora sessões periodicamente
│
└── infra/
    └── evolution/                ← docker-compose + .env.example do VPS
```

---

## Documentos de referência

Antes de implementar qualquer módulo, leia o documento correspondente em `docs/`:

| Documento | Quando ler |
|-----------|------------|
| `docs/architecture.md` | Antes de qualquer coisa |
| `docs/schema.md` | Antes de tocar no banco |
| `docs/evolution-api.md` | Antes de configurar o VPS |
| `docs/edge-functions.md` | Antes de implementar Edge Functions |
| `docs/web-app.md` | Antes de implementar o Next.js |
| `docs/product.md` | Para entender decisões de produto |

---

## Regras inegociáveis de arquitetura

1. **`tenant_id` em toda tabela** — sem exceção. RLS filtra por tenant em tudo.
2. **`raw_payload jsonb`** em `messages` — nunca descartar o payload original do Evolution.
3. **Mídia não é opcional** — a Edge Function `media-downloader` deve ser acionada
   imediatamente após salvar a mensagem. Links do WhatsApp expiram em minutos.
4. **Idempotência** — todo insert usa `upsert` com conflict na chave natural.
5. **Nunca expor `SUPABASE_SERVICE_ROLE_KEY` no cliente** — apenas em Route Handlers
   server-side ou Edge Functions.
6. **`events_log` em toda operação crítica** — webhook recebido, mídia baixada,
   erro de sessão. Sem isso, debug em produção é impossível.
7. **Schema preparado para fase 3** — coluna `embedding vector(1536)` já existe,
   tabela `integrations` já existe. Não remover "porque não usa ainda".

---

## Convenções de código

- TypeScript estrito (`strict: true`) em todo o projeto
- Variáveis de ambiente sempre tipadas via `@t3-oss/env-nextjs` no web app
- Nomes de tabelas: `snake_case` plural (ex: `wa_sessions`, `media_files`)
- Nomes de Edge Functions: `kebab-case` (ex: `whatsapp-webhook`)
- Imports absolutos com `@/` no web app
- Sem `any` — use `unknown` e narrowing explícito

---

## Ordem de implementação recomendada

```
1. supabase/migrations/          ← schema completo com RLS
2. infra/evolution/              ← docker-compose do VPS
3. supabase/functions/whatsapp-webhook/
4. supabase/functions/media-downloader/
5. supabase/functions/session-health-check/
6. packages/types/               ← tipos compartilhados
7. apps/web/                     ← dashboard Next.js
```

Não pule etapas. Cada camada depende da anterior.

---

## Variáveis de ambiente

### apps/web (.env.local)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # só server-side
BAILEYS_API_URL=                  # URL do VPS
BAILEYS_API_KEY=                  # API key do Evolution
```

### supabase/functions (.env)
```
SUPABASE_URL=                     # injetado automaticamente
SUPABASE_SERVICE_ROLE_KEY=        # injetado automaticamente
WEBHOOK_SECRET=                   # mesmo do Evolution
OPENAI_API_KEY=                   # para Whisper e embeddings (fase 2)
```

### infra/evolution (.env)
```
EVOLUTION_API_KEY=
WEBHOOK_URL=                      # URL da Edge Function
WEBHOOK_SECRET=
REDIS_URL=
```
