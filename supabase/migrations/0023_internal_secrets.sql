-- ============================================================
-- Migration: 0023_internal_secrets.sql
-- Corrige campaign-sender-tick (0020) ficando 401 UNAUTHORIZED_NO_AUTH_HEADER
-- desde o deploy: `alter database postgres set app.settings.service_role_key`
-- exige privilégio que a role de conexão normal (via CLI/dashboard REST)
-- não tem — só funciona rodado manualmente pelo SQL Editor com a role
-- postgres plena. Solução mais robusta: guardar o secret numa tabela
-- deny-all (mesmo padrão de whatsapp_cloud_credentials.access_token) em vez
-- de um GUC de banco — INSERT normal, sem precisar de privilégio elevado.
-- ============================================================

create table internal_secrets (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz default now()
);

alter table internal_secrets enable row level security;
create policy "deny_all" on internal_secrets
  for all using (false) with check (false);

create or replace function invoke_campaign_sender_for_active()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  campaign_row record;
  service_key text;
begin
  select value into service_key from internal_secrets where key = 'service_role_key';
  if service_key is null then
    return; -- sem secret configurado, não tenta chamar (evita 401 em loop)
  end if;

  for campaign_row in
    select distinct c.id
    from campaigns c
    join campaign_recipients r on r.campaign_id = c.id
    where c.status = 'sending'
      and r.status in ('pending', 'sending')
  loop
    perform net.http_post(
      url     := 'https://byuggqcnvezendgrcysb.supabase.co/functions/v1/campaign-sender',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object('campaignId', campaign_row.id)
    );
  end loop;
end;
$$;
