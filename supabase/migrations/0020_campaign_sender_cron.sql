-- Reinvoca campaign-sender a cada minuto para toda campanha 'sending' com
-- destinatário pendente/preso — é o mecanismo de retomada do pipeline de
-- disparo (ver plano: regra 17/11 do CLAUDE.md impede um único
-- request/RPC de processar uma campanha inteira). Seguro contra
-- concorrência porque claim_campaign_recipients() usa FOR UPDATE SKIP
-- LOCKED (migration 0019) — duas invocações sobrepostas nunca processam a
-- mesma linha.

create or replace function invoke_campaign_sender_for_active()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  campaign_row record;
begin
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
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body    := jsonb_build_object('campaignId', campaign_row.id)
    );
  end loop;
end;
$$;

-- current_setting('app.settings.service_role_key') precisa ser configurado
-- via `alter database postgres set app.settings.service_role_key = '...'`
-- (uma vez, fora de migration versionada — é um segredo). Sem isso, o
-- Authorization vem vazio e a Edge Function (verify_jwt=true) rejeita a
-- chamada com 401 — ver notas operacionais do CLAUDE.md sobre aplicar
-- este passo manual após o deploy desta migration.

select cron.schedule(
  'campaign-sender-tick',
  '* * * * *',
  $$ select invoke_campaign_sender_for_active(); $$
);
