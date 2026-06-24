-- ============================================================
-- Migration: 0001_initial.sql
-- WhatsApp Intelligence Platform — Schema completo
-- ============================================================

-- EXTENSÕES
create extension if not exists vector;
create extension if not exists "uuid-ossp";
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============================================================
-- TENANTS
-- Fase 1: 1 tenant (você). Fase 3: N empresas clientes.
-- ============================================================
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  plan        text default 'personal',   -- personal | business | enterprise
  active      boolean default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================================
-- OPERATORS (colaboradores por tenant)
-- ============================================================
create table operators (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text,
  email       text,
  role        text default 'operator',   -- admin | operator | viewer
  active      boolean default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================================
-- SESSÕES WHATSAPP
-- ============================================================
create table wa_sessions (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id) on delete cascade,
  operator_id             uuid references operators(id) on delete set null,
  phone_number            text not null,
  label                   text,
  status                  text default 'disconnected',  -- connected|disconnected|connecting|banned
  qr_code                 text,
  evolution_instance_name text,                         -- ex: welcome-trips-5541999887766
  last_seen_at            timestamptz,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now(),
  unique (tenant_id, phone_number)
);

-- ============================================================
-- CONTATOS EXTERNOS
-- ============================================================
create table contacts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  jid          text not null,            -- ex: 5541999887766@s.whatsapp.net
  name         text,
  push_name    text,
  phone_number text,
  is_group     boolean default false,
  metadata     jsonb default '{}',       -- CRM id, Monday id, etc.
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (tenant_id, jid)
);

-- ============================================================
-- CHATS (conversas)
-- ============================================================
create table chats (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  session_id      uuid not null references wa_sessions(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete set null,
  jid             text not null,
  name            text,
  last_message_at timestamptz,
  unread_count    int default 0,
  is_archived     boolean default false,
  created_at      timestamptz default now(),
  unique (session_id, jid)
);

-- ============================================================
-- MENSAGENS
-- ============================================================
create table messages (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  session_id        uuid not null references wa_sessions(id) on delete cascade,
  chat_id           uuid references chats(id) on delete set null,
  contact_id        uuid references contacts(id) on delete set null,
  message_id        text not null,       -- ID original WhatsApp
  from_me           boolean not null,
  type              text not null,       -- text|image|audio|video|document|sticker|reaction|unknown
  body              text,                -- texto ou transcrição de áudio (fase 2)
  caption           text,               -- legenda de mídia
  quoted_message_id text,               -- ID da mensagem citada
  is_forwarded      boolean default false,
  duration_secs     int,                -- apenas áudios
  timestamp         timestamptz not null,
  delivered_at      timestamptz,
  read_at           timestamptz,
  raw_payload       jsonb,              -- payload Evolution completo — nunca descartar
  embedding         vector(1536),       -- busca semântica — null até fase 2
  created_at        timestamptz default now(),
  unique (session_id, message_id)
);

-- ============================================================
-- ARQUIVOS DE MÍDIA
-- ============================================================
create table media_files (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  message_id      uuid references messages(id) on delete cascade,
  storage_path    text,                 -- path no Supabase Storage
  mime_type       text,
  file_size       bigint,
  duration_secs   int,
  transcription   text,                 -- resultado Whisper (fase 2)
  transcribed_at  timestamptz,
  download_status text default 'pending', -- pending|done|failed
  download_attempts int default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================
-- INTEGRAÇÕES EXTERNAS
-- ============================================================
create table integrations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  type        text not null,            -- monday|hubspot|activecamp|webhook|hermes
  label       text,
  config      jsonb default '{}',       -- API keys, board IDs (encriptar em produção)
  active      boolean default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================================
-- LOG DE EVENTOS (auditoria e debug)
-- ============================================================
create table events_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenants(id) on delete set null,
  session_id  uuid references wa_sessions(id) on delete set null,
  event_type  text not null,            -- webhook_received|media_downloaded|session_status_changed|error
  payload     jsonb,
  error       text,
  created_at  timestamptz default now()
);

-- ============================================================
-- ÍNDICES
-- ============================================================
create index idx_operators_tenant         on operators(tenant_id);
create index idx_wa_sessions_tenant       on wa_sessions(tenant_id);
create index idx_wa_sessions_operator     on wa_sessions(operator_id);
create index idx_contacts_tenant          on contacts(tenant_id);
create index idx_contacts_jid             on contacts(jid);
create index idx_chats_session            on chats(session_id);
create index idx_chats_last_message       on chats(last_message_at desc nulls last);
create index idx_messages_tenant          on messages(tenant_id);
create index idx_messages_session         on messages(session_id);
create index idx_messages_chat            on messages(chat_id);
create index idx_messages_timestamp       on messages(timestamp desc);
create index idx_messages_type            on messages(type);
create index idx_messages_from_me         on messages(from_me);
create index idx_media_files_message      on media_files(message_id);
create index idx_media_files_status       on media_files(download_status);
create index idx_events_log_tenant        on events_log(tenant_id);
create index idx_events_log_created       on events_log(created_at desc);

-- Índice vetorial para busca semântica (fase 2)
-- Criado agora para evitar migration pesada depois
create index idx_messages_embedding on messages
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ============================================================
-- RLS — ISOLAMENTO MULTI-TENANT
-- ============================================================
alter table tenants      enable row level security;
alter table operators    enable row level security;
alter table wa_sessions  enable row level security;
alter table contacts     enable row level security;
alter table chats        enable row level security;
alter table messages     enable row level security;
alter table media_files  enable row level security;
alter table integrations enable row level security;
alter table events_log   enable row level security;

-- Funções auxiliares
create or replace function my_tenant_id()
returns uuid language sql stable security definer as $$
  select tenant_id from operators where id = auth.uid()
$$;

create or replace function my_role()
returns text language sql stable security definer as $$
  select role from operators where id = auth.uid()
$$;

-- Políticas: tenants
create policy "operators_own_tenant" on tenants
  for select using (id = my_tenant_id());

-- Políticas: operators
create policy "tenant_isolation" on operators
  for all using (tenant_id = my_tenant_id());

-- Políticas: wa_sessions
create policy "tenant_isolation" on wa_sessions
  for all using (tenant_id = my_tenant_id());

-- Políticas: contacts
create policy "tenant_isolation" on contacts
  for all using (tenant_id = my_tenant_id());

-- Políticas: chats
create policy "tenant_isolation" on chats
  for all using (tenant_id = my_tenant_id());

-- Políticas: messages — admin vê tudo, operator vê só o próprio session
create policy "tenant_isolation" on messages
  for all using (tenant_id = my_tenant_id());

create policy "operator_own_session" on messages
  for select using (
    my_role() = 'admin'
    or session_id in (
      select id from wa_sessions
      where operator_id = auth.uid()
      and tenant_id = my_tenant_id()
    )
  );

-- Políticas: media_files
create policy "tenant_isolation" on media_files
  for all using (tenant_id = my_tenant_id());

-- Políticas: integrations
create policy "admin_only" on integrations
  for all using (
    tenant_id = my_tenant_id()
    and my_role() = 'admin'
  );

-- Políticas: events_log
create policy "admin_only" on events_log
  for select using (
    tenant_id = my_tenant_id()
    and my_role() = 'admin'
  );

-- ============================================================
-- REALTIME
-- ============================================================
alter publication supabase_realtime add table wa_sessions;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table chats;

-- ============================================================
-- CRON: session-health-check a cada 5 minutos
-- Preencher a URL após deploy da Edge Function
-- ============================================================
-- select cron.schedule(
--   'session-health-check',
--   '*/5 * * * *',
--   $$
--     select net.http_post(
--       url := 'https://SEU_PROJETO.supabase.co/functions/v1/session-health-check',
--       headers := '{"Authorization": "Bearer SEU_SERVICE_KEY"}'::jsonb
--     );
--   $$
-- );
