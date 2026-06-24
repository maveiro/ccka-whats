# Arquitetura — WhatsApp Intelligence Platform

## Visão geral

```
WhatsApp ──► Evolution API (VPS) ──► Edge Function ──► PostgreSQL
                                           └──────────► Storage (mídia)
                                           └──────────► events_log (auditoria)

Next.js (Vercel) ──► Supabase Auth + RLS ──► PostgreSQL
                 ──► Supabase Realtime    ──► wa_sessions (status ao vivo)
```

## Camadas

### 1. Captura (Evolution API no VPS)
- Gerencia N instâncias WhatsApp simultaneamente
- Cada instância = 1 número = 1 `wa_session` no banco
- Dispara webhook para Edge Function a cada evento
- Suporta retry automático em falhas de entrega
- Reconnect automático quando sessão cai

### 2. Ingestão (Supabase Edge Functions)

**`whatsapp-webhook`**
- Recebe POST do Evolution
- Valida `WEBHOOK_SECRET` no header
- Normaliza payload → insere em `contacts`, `chats`, `messages`
- Para mensagens com mídia: enfileira download via `media-downloader`
- Registra em `events_log`

**`media-downloader`**
- Chamada imediatamente após salvar mensagem com mídia
- Baixa arquivo do link temporário do WhatsApp
- Salva em Supabase Storage: `{tenant_id}/{session_id}/{message_id}`
- Atualiza `media_files.download_status` e `storage_path`
- Se falhar: registra erro, tenta novamente (max 3x)

**`session-health-check`**
- Roda a cada 5 minutos via Supabase Cron
- Consulta Evolution API: status de cada instância ativa
- Atualiza `wa_sessions.status` e `last_seen_at`
- Se sessão caiu: atualiza status para `disconnected`

### 3. Dados (Supabase PostgreSQL)
- Multi-tenant: `tenant_id` em toda tabela
- RLS filtra automaticamente por tenant
- `raw_payload jsonb` preserva dados originais do Evolution
- `embedding vector(1536)` pronto para busca semântica (fase 2)

### 4. Apresentação (Next.js no Vercel)
- SSR com `@supabase/ssr` — auth via cookies, segura
- Middleware protege rotas antes de renderizar
- Realtime via Supabase para status de sessões ao vivo
- Route Handlers para operações que precisam de `SERVICE_ROLE_KEY`

## Princípio de evolução sem refatoramento

A tabela `tenants` existe desde o início. Na fase 1, há apenas 1 tenant.
Na fase 3, há N tenants — nenhuma migration necessária.

O mesmo vale para:
- `integrations`: vazia na fase 1, preenchida na fase 2+
- `embedding`: null na fase 1, preenchida quando Whisper + embeddings forem ativados
- `events_log`: ativa desde o início para debug e auditoria futura
