# Edge Functions — Supabase

## Visão geral

Três Edge Functions compõem a camada de ingestão:

```
Evolution API ──► whatsapp-webhook ──► messages (insert)
                                  └──► media-downloader (trigger)
                                  └──► events_log (audit)

Cron (5min) ──► session-health-check ──► wa_sessions (update status)
```

## whatsapp-webhook

**Responsabilidade:** receber e persistir todos os eventos do Evolution.

**Fluxo:**
1. Validar `Authorization: Bearer {WEBHOOK_SECRET}`
2. Parsear `event` e `data` do payload
3. Para `messages.upsert`: upsert de contact → chat → message
4. Para `connection.update`: atualizar `wa_sessions.status`
5. Para `qrcode.updated`: atualizar `wa_sessions.qr_code`
6. Para mensagens com mídia: chamar `media-downloader` de forma assíncrona
7. Registrar em `events_log`
8. Retornar 200 imediatamente (não bloquear o Evolution esperando processamento)

**Importante:** retornar 200 o mais rápido possível.
Processing pesado (mídia, embeddings) deve ser assíncrono.

## media-downloader

**Responsabilidade:** baixar arquivos de mídia antes que os links expirem.

**Fluxo:**
1. Receber `message_id` e `download_url` do WhatsApp
2. Fazer fetch do arquivo binário
3. Upload para Supabase Storage: `{tenant_id}/{session_id}/{message_id}.{ext}`
4. Atualizar `media_files.storage_path` e `download_status = 'done'`
5. Em caso de falha: `download_status = 'failed'`, registrar em `events_log`
6. Retry automático: até 3 tentativas com backoff exponencial

**Tipos de mídia suportados:**
`image/jpeg`, `image/png`, `audio/ogg`, `audio/mp4`, `video/mp4`,
`application/pdf`, `image/webp` (stickers)

## session-health-check

**Responsabilidade:** manter `wa_sessions.status` sincronizado com a realidade.

**Fluxo:**
1. Buscar todas as `wa_sessions` com `status != 'banned'`
2. Para cada sessão: GET `/instance/connectionState/{instance_name}` no Evolution
3. Comparar com status atual no banco
4. Se diferente: atualizar `wa_sessions.status` e `last_seen_at`
5. Se Evolution retornar 404: instância não existe mais → `status = 'disconnected'`
6. Registrar mudanças em `events_log`

**Configuração de Cron no Supabase:**
```sql
select cron.schedule(
  'session-health-check',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://SEU_PROJETO.supabase.co/functions/v1/session-health-check',
      headers := '{"Authorization": "Bearer SEU_SERVICE_KEY"}'::jsonb
    );
  $$
);
```

## Variáveis de ambiente (todas as functions)

Injetadas automaticamente pelo Supabase:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Configuradas via `supabase secrets set`:
- `WEBHOOK_SECRET` — validação de origem do Evolution
- `EVOLUTION_API_URL` — URL do VPS
- `EVOLUTION_API_KEY` — autenticação no Evolution
- `OPENAI_API_KEY` — Whisper + embeddings (fase 2, pode ficar vazio agora)
