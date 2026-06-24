# Schema — WhatsApp Intelligence Platform

O schema completo está em `supabase/migrations/0001_initial.sql`.
Este documento explica as decisões de design.

## Tabelas e responsabilidades

| Tabela | Responsabilidade |
|--------|-----------------|
| `tenants` | Empresas/usuários da plataforma (multi-tenant) |
| `operators` | Colaboradores por tenant, com role |
| `wa_sessions` | Números WhatsApp conectados por tenant |
| `contacts` | Contatos externos capturados |
| `chats` | Conversas (1:1 ou grupos) |
| `messages` | Mensagens individuais com todo metadado |
| `media_files` | Arquivos de mídia (separado de messages) |
| `integrations` | Conexões externas (Monday, CRM, webhooks) |
| `events_log` | Auditoria e debug de operações |

## Decisões importantes

### `raw_payload jsonb` em messages
Armazena o payload completo recebido do Evolution.
Isso garante que se o parser evoluir ou um campo novo surgir,
os dados históricos não se perdem — sempre é possível re-processar.

### `media_files` separado de `messages`
Permite processar downloads de forma assíncrona sem bloquear
o insert de mensagens. Uma mensagem existe imediatamente;
o arquivo de mídia chega depois via `media-downloader`.

### `embedding vector(1536)` em messages
Pronto para pgvector. Fica `null` até a fase 2 ser ativada.
O índice `ivfflat` já está criado — não haverá migration pesada depois.

### `integrations` como tabela
Adicionar Monday, ActiveCampaign, webhooks customizados, Hermes —
tudo vira um registro nessa tabela com `config jsonb`.
Nenhuma alteração de schema para novas integrações.

### `events_log` desde o início
Em produção, quando algo quebrar silenciosamente,
essa tabela é a única fonte de verdade.
Registrar: webhook recebido, mídia baixada, erro de sessão, reconexão.

## RLS — Isolamento por tenant

Toda tabela tem RLS ativo. A função `my_tenant_id()` retorna
o `tenant_id` do operador logado via `auth.uid()`.

Operadores com `role = 'admin'` dentro do tenant veem tudo do tenant.
Operadores com `role = 'operator'` veem apenas seu próprio `session_id`.

**Importante:** RLS não substitui validação na aplicação.
Route Handlers e Edge Functions devem sempre validar tenant_id explicitamente
antes de operações de escrita.

## Índices críticos

- `idx_messages_timestamp desc` — queries de timeline (mais usada)
- `idx_messages_session` — filtro por número
- `idx_messages_embedding ivfflat` — busca semântica (fase 2)
- `idx_chats_last_message desc` — lista de conversas ordenada
