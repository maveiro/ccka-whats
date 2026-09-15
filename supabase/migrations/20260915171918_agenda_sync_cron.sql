-- ============================================================
-- Migration: agenda_sync_cron.sql
-- pg_cron de hora em hora para o agenda-sync (Fase 3 do PRD
-- docs/prd/prd-agenda-via-painel-shows.md).
--
-- De hora em hora, não de minuto em minuto como o campaign-sender: agenda de
-- show muda algumas vezes por semana, e cada tick é uma chamada à API interna
-- do painel-shows. O endpoint do Flow lê a cópia local, então atraso de até
-- uma hora nunca é sentido pelo fã dentro da conversa.
--
-- O segredo sai de internal_secrets (migration 0023) e NÃO de
-- `alter database ... set app.settings.*`: essa rota exige privilégio que a
-- role de conexão normal não tem, falha em silêncio (net.http_post é
-- fire-and-forget, o 401 só aparece em net._http_response) e já travou toda
-- campanha por um mês em 2026 — ver CLAUDE.md, "Módulo de campanhas".
-- ============================================================

create or replace function invoke_agenda_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
begin
  select value into service_key from internal_secrets where key = 'service_role_key';
  if service_key is null then
    return; -- sem secret configurado, não tenta chamar (evita 401 em loop)
  end if;

  -- Nada a fazer se ninguém configurou a ponte: a função sairia na primeira
  -- query de qualquer forma, mas um tick que não faz request nenhum é mais
  -- barato e não polui net._http_response.
  if not exists (
    select 1
      from agenda_conexoes cx
      join agenda_filtros f on f.tenant_id = cx.tenant_id and f.ativo
     where cx.ativo
  ) then
    return;
  end if;

  perform net.http_post(
    url     := 'https://byuggqcnvezendgrcysb.supabase.co/functions/v1/agenda-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body    := '{}'::jsonb
  );
end;
$$;

-- Minuto 7 e não 0: não competir com o topo da hora, onde os crons de todo
-- mundo se acumulam.
select cron.schedule(
  'agenda-sync-tick',
  '7 * * * *',
  $$ select invoke_agenda_sync(); $$
);
