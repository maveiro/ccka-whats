# WhatsApp Intelligence Platform

Plataforma de governança e inteligência de comunicação corporativa via WhatsApp.

## Documentação

| Documento | Descrição |
|-----------|-----------|
| [CLAUDE.md](./CLAUDE.md) | Briefing completo para o Claude Code |
| [docs/architecture.md](./docs/architecture.md) | Arquitetura e decisões técnicas |
| [docs/schema.md](./docs/schema.md) | Schema do banco de dados |
| [docs/evolution-api.md](./docs/evolution-api.md) | Configuração do Evolution API |
| [docs/edge-functions.md](./docs/edge-functions.md) | Edge Functions Supabase |
| [docs/web-app.md](./docs/web-app.md) | Dashboard Next.js |
| [docs/product.md](./docs/product.md) | Contexto de produto |

## Estrutura

```
wa-intelligence/
├── apps/web/               → Next.js 15 dashboard (Vercel)
├── packages/
│   ├── database/           → tipos TypeScript do schema
│   ├── types/              → tipos compartilhados
│   └── utils/              → funções utilitárias
├── supabase/
│   ├── migrations/         → SQL versionado
│   └── functions/          → Edge Functions
└── infra/evolution/        → Docker Compose para o VPS
```

## Início rápido

```bash
# 1. Clonar e instalar dependências
git clone https://github.com/SEU_USER/wa-intelligence.git
cd wa-intelligence
npm install

# 2. Configurar Supabase
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push

# 3. Configurar VPS
cp infra/evolution/.env.example infra/evolution/.env
# editar infra/evolution/.env com suas chaves
# ssh para o VPS e rodar docker compose up -d

# 4. Deploy Edge Functions
supabase functions deploy whatsapp-webhook --no-verify-jwt
supabase functions deploy media-downloader
supabase functions deploy session-health-check

# 5. Rodar web app localmente
cp apps/web/.env.example apps/web/.env.local
# editar .env.local
npm run dev
```

## Stack

- **WhatsApp:** Evolution API (VPS Hostinger)
- **Ingestão:** Supabase Edge Functions
- **Banco:** Supabase PostgreSQL + pgvector
- **Auth:** Supabase Auth + RLS
- **Frontend:** Next.js 15 + Tailwind CSS
- **Deploy:** Vercel (web) + Docker (VPS)
