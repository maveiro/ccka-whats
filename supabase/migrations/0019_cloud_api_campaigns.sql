-- ============================================================
-- Migration: 0019_cloud_api_campaigns.sql
-- Lançador de campanhas via WhatsApp Cloud API (oficial) — módulo novo,
-- aditivo. Não altera nenhuma tabela do pipeline Evolution (wa_sessions,
-- messages, chats, contacts, media_files). Compartilha só tenants/operators/
-- events_log com o resto do produto.
-- ============================================================

-- ============================================================
-- CREDENCIAIS DO CLOUD API (por tenant)
-- Tabela dedicada com RLS deny-all — token permanente com poder de
-- disparo é vetor de abuso/gasto, não só de leitura, então merece
-- isolamento maior que o `integrations.config` genérico (Monday/OpenAI).
-- Único leitor pretendido: código server-side com service-role client.
-- Mesmo padrão de apps/meta-ads/ad_account_tokens (ver CLAUDE.md desse app).
-- app_secret / webhook_verify_token NÃO ficam aqui: no modelo Cloud API o
-- Meta App dono da assinatura de webhook é único por plataforma, não por
-- tenant/WABA — ficam em env var (META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN).
-- ============================================================
create table whatsapp_cloud_credentials (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  waba_id               text not null,
  phone_number_id       text not null,
  display_phone_number  text,
  access_token          text not null,   -- token permanente (System User), sensível
  active                boolean default true,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (tenant_id, phone_number_id)
);

alter table whatsapp_cloud_credentials enable row level security;
create policy "deny_all" on whatsapp_cloud_credentials
  for all using (false) with check (false);

-- ============================================================
-- OPT-OUTS (compliance mínimo, não adiável)
-- Checado antes de incluir um destinatário numa campanha MARKETING.
-- ============================================================
create table whatsapp_opt_outs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  phone_e164    text not null,
  reason        text,
  created_at    timestamptz default now(),
  unique (tenant_id, phone_e164)
);

alter table whatsapp_opt_outs enable row level security;
create policy "admin_only" on whatsapp_opt_outs
  for all using (tenant_id = my_tenant_id() and my_role() = 'admin');

-- ============================================================
-- CAMPANHAS
-- ============================================================
create table campaigns (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  credential_id         uuid not null references whatsapp_cloud_credentials(id),
  created_by            uuid references operators(id) on delete set null,
  name                  text not null,
  template_name         text not null,
  template_language     text not null,
  template_category     text,             -- MARKETING|UTILITY|AUTHENTICATION (da listMessageTemplates)
  template_components   jsonb,
  status                text not null default 'draft',
    -- draft|validating|ready|sending|paused|completed|failed
  total_recipients      int default 0,
  sent_count            int default 0,
  delivered_count       int default 0,
  read_count            int default 0,
  failed_count          int default 0,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

alter table campaigns enable row level security;
create policy "admin_only" on campaigns
  for all using (tenant_id = my_tenant_id() and my_role() = 'admin');

create index idx_campaigns_tenant on campaigns(tenant_id);
create index idx_campaigns_status on campaigns(status);

-- ============================================================
-- DESTINATÁRIOS DA CAMPANHA
-- wamid tem unique de verdade (não só índice) para permitir
-- ON CONFLICT (wamid) no webhook de status de entrega.
-- claimed_at é o campo do claim atômico do campaign-sender (ver função
-- claim_campaign_recipients abaixo) — evita double-send entre invocações
-- sobrepostas (cron tick + retry manual).
-- ============================================================
create table campaign_recipients (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  tenant_id     uuid not null references tenants(id) on delete cascade,
  phone_e164    text not null,
  variables     jsonb default '{}',
  status        text not null default 'pending',
    -- pending|sending|sent|delivered|read|failed
  wamid         text,
  error         text,
  attempts      int default 0,
  claimed_at    timestamptz,
  sent_at       timestamptz,
  delivered_at  timestamptz,
  read_at       timestamptz,
  failed_at     timestamptz,
  created_at    timestamptz default now(),
  unique (campaign_id, phone_e164),
  unique (wamid)
);

alter table campaign_recipients enable row level security;
create policy "admin_only" on campaign_recipients
  for all using (tenant_id = my_tenant_id() and my_role() = 'admin');

create index idx_campaign_recipients_status on campaign_recipients(campaign_id, status);

-- ============================================================
-- CLAIM ATÔMICO DE LOTE (usado pela Edge Function campaign-sender)
-- SELECT ... FOR UPDATE SKIP LOCKED garante que duas invocações
-- sobrepostas (pg_cron + retry manual) nunca pegam a mesma linha —
-- é isso que torna seguro reinvocar a function periodicamente sem
-- risco de disparo duplicado. security definer + search_path fixo
-- (mesmo padrão de my_tenant_id()/my_role()), mas só é chamada pela
-- Edge Function com service-role, nunca exposta a client.
-- ============================================================
create or replace function claim_campaign_recipients(p_campaign_id uuid, p_batch_size int default 50)
returns setof campaign_recipients
language sql
security definer
set search_path = public
as $$
  update campaign_recipients
  set status = 'sending', claimed_at = now()
  where id in (
    select id from campaign_recipients
    where campaign_id = p_campaign_id and status = 'pending'
    order by created_at
    limit p_batch_size
    for update skip locked
  )
  returning *;
$$;

-- Reclaim de destinatários presos em 'sending' há mais de 5min sem resposta
-- da Graph API (crash da function no meio do lote) — retry até attempts<3,
-- depois falha definitiva.
create or replace function reclaim_stuck_campaign_recipients(p_campaign_id uuid, p_stuck_minutes int default 5)
returns void
language sql
security definer
set search_path = public
as $$
  update campaign_recipients
  set status = case when attempts + 1 >= 3 then 'failed' else 'pending' end,
      attempts = attempts + 1,
      failed_at = case when attempts + 1 >= 3 then now() else failed_at end,
      error = case when attempts + 1 >= 3 then coalesce(error, 'timeout: sem resposta da Graph API após 3 tentativas') else error end
  where campaign_id = p_campaign_id
    and status = 'sending'
    and claimed_at < now() - (p_stuck_minutes || ' minutes')::interval;
$$;

-- ============================================================
-- RECÁLCULO DE CONTADORES (nunca incrementar por evento — webhook
-- redelivery do Meta é esperada e não pode inflar contadores)
-- ============================================================
create or replace function recompute_campaign_counters(p_campaign_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update campaigns c set
    sent_count = (select count(*) from campaign_recipients where campaign_id = p_campaign_id and status in ('sent','delivered','read')),
    delivered_count = (select count(*) from campaign_recipients where campaign_id = p_campaign_id and status in ('delivered','read')),
    read_count = (select count(*) from campaign_recipients where campaign_id = p_campaign_id and status = 'read'),
    failed_count = (select count(*) from campaign_recipients where campaign_id = p_campaign_id and status = 'failed'),
    updated_at = now()
  where c.id = p_campaign_id;
$$;
