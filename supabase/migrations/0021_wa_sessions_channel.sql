-- ============================================================
-- Migration: 0021_wa_sessions_channel.sql
-- Permite que wa_sessions represente também um número conectado via
-- WhatsApp Cloud API (oficial), não só Evolution/Baileys — necessário
-- pra respostas de campanha caírem na mesma caixa de entrada
-- compartilhada (chats/messages). channel é explícito (não inferir de
-- evolution_instance_name is null) porque messages/send/route.ts
-- precisa decidir Evolution vs. Graph API sem ambiguidade.
-- ============================================================

alter table wa_sessions
  add column channel text not null default 'evolution'
    check (channel in ('evolution', 'cloud_api')),
  add column cloud_credential_id uuid references whatsapp_cloud_credentials(id) on delete set null;

-- 1 sessão por credencial — usado pelo upsert de auto-provisão em
-- campaigns/credentials/route.ts (onConflict: cloud_credential_id).
create unique index wa_sessions_cloud_credential_id_key
  on wa_sessions (cloud_credential_id) where cloud_credential_id is not null;

-- Caminho de resolução do webhook inbound: phone_number_id (do payload
-- do Meta) -> whatsapp_cloud_credentials -> wa_sessions.cloud_credential_id.
create index whatsapp_cloud_credentials_phone_number_id_idx
  on whatsapp_cloud_credentials (phone_number_id);
