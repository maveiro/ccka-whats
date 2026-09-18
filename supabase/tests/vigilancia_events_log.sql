-- ============================================================
-- Vigilância do events_log (migration vigilancia_events_log).
--
-- O que estes testes protegem é a utilidade do alerta: agrupar 57 timeouts
-- numa linha, avisar do que é NOVO, e não repetir aviso de hora em hora — um
-- alerta ruidoso é ignorado, e alerta ignorado é igual a não ter alerta.
--
-- COMO RODAR: banco LOCAL, `npm run test:db`. Tudo em begin/rollback.
-- ============================================================

begin;

create temporary table _ids (chave text primary key, valor uuid) on commit drop;

create or replace function pg_temp.assert(p_condicao boolean, p_mensagem text)
returns void language plpgsql as $$
begin
  if p_condicao is not true then raise exception 'FALHOU: %', p_mensagem; end if;
end;
$$;

insert into tenants (name, slug) values ('Tenant saude','tenant-saude');
insert into _ids select 'tenant', id from tenants where slug='tenant-saude';

-- ============================================================
-- 1. Assinatura agrupa o mesmo problema com ids diferentes
-- Foi o caso real: 57 "campaign_recipients lookup: Gateway Timeout" com
-- recipientId diferente em cada um.
-- ============================================================
do $$
begin
  perform pg_temp.assert(
    assinatura_erro('error', 'campaign_recipients lookup 8f3a: Gateway Timeout')
      = assinatura_erro('error', 'campaign_recipients lookup 91b7: Gateway Timeout'),
    'ids diferentes no mesmo erro precisam ter a mesma assinatura');

  perform pg_temp.assert(
    assinatura_erro('error', 'timeout ao ler a4f8fff3-b176-4c53-bb97-69bc7ce01e5b')
      = assinatura_erro('error', 'timeout ao ler 11111111-2222-4333-8444-555555555555'),
    'UUID também tem de ser normalizado');

  perform pg_temp.assert(
    assinatura_erro('error', 'Gateway Timeout') <> assinatura_erro('agenda_sync_erro', 'Gateway Timeout'),
    'mesmo texto em event_type diferente é problema diferente');
end $$;

-- ============================================================
-- 2. Resumo agrupa e conta
-- ============================================================
insert into events_log (tenant_id, event_type, payload, error, created_at)
select valor, 'error', '{}'::jsonb, 'campaign_recipients lookup ' || g || ': Gateway Timeout',
       now() - interval '2 hours'
  from _ids, generate_series(1, 57) g where chave='tenant';

do $$
declare r record;
begin
  -- A função filtra por my_tenant_id(); no teste o papel é de serviço, então
  -- exercitamos o agrupamento direto na expressão que ela usa.
  select assinatura_erro(event_type, error) as assinatura, count(*) as n
    into r
    from events_log
   where tenant_id = (select valor from _ids where chave='tenant')
     and error is not null
   group by 1;

  perform pg_temp.assert(r.n = 57, format('57 ocorrências deveriam virar uma linha, vieram %s linhas', r.n));
end $$;

-- ============================================================
-- 3. Assinatura nova merece aviso; repetida no mesmo dia, não
-- ============================================================
do $$
declare n int;
begin
  select count(*) into n from erros_para_avisar()
   where tenant_id = (select valor from _ids where chave='tenant');
  perform pg_temp.assert(n = 0, 'erro de 2h atrás não entra na janela de 1 hora');

  insert into events_log (tenant_id, event_type, payload, error)
  select valor, 'agenda_sync_erro', '{}'::jsonb, 'painel-shows respondeu 500' from _ids where chave='tenant';

  select count(*) into n from erros_para_avisar()
   where tenant_id = (select valor from _ids where chave='tenant');
  perform pg_temp.assert(n = 1, format('assinatura nova deveria merecer aviso, veio %s', n));

  -- Depois de avisado hoje, não avisa de novo: alerta repetido de hora em
  -- hora é o que faz alerta ser ignorado.
  insert into erros_avisados (tenant_id, assinatura)
  select valor, assinatura_erro('agenda_sync_erro', 'painel-shows respondeu 500') from _ids where chave='tenant';

  select count(*) into n from erros_para_avisar()
   where tenant_id = (select valor from _ids where chave='tenant');
  perform pg_temp.assert(n = 0, 'assinatura já avisada hoje não pode avisar de novo');
end $$;

-- ============================================================
-- 4. Erro conhecido só volta a avisar por VOLUME
-- Erro que acontece todo dia (e já é conhecido) não pode virar alerta diário;
-- só quando o volume sai do normal.
-- ============================================================
do $$
declare n int;
begin
  -- Mesma assinatura vista 40 dias atrás e agora: não é nova.
  insert into events_log (tenant_id, event_type, payload, error, created_at)
  select valor, 'error', '{}'::jsonb, 'erro rotineiro', now() - interval '10 days' from _ids where chave='tenant';
  insert into events_log (tenant_id, event_type, payload, error)
  select valor, 'error', '{}'::jsonb, 'erro rotineiro' from _ids where chave='tenant';

  select count(*) into n from erros_para_avisar()
   where tenant_id = (select valor from _ids where chave='tenant')
     and assinatura = assinatura_erro('error', 'erro rotineiro');
  perform pg_temp.assert(n = 0, 'erro conhecido e em volume normal não vira alerta');

  -- Passa de 20 no dia: aí sim.
  insert into events_log (tenant_id, event_type, payload, error)
  select valor, 'error', '{}'::jsonb, 'erro rotineiro' from _ids, generate_series(1, 25) where chave='tenant';

  select count(*) into n from erros_para_avisar()
   where tenant_id = (select valor from _ids where chave='tenant')
     and assinatura = assinatura_erro('error', 'erro rotineiro');
  perform pg_temp.assert(n = 1, 'volume acima de 20 no dia precisa avisar mesmo sendo erro conhecido');
end $$;

-- ============================================================
-- 5. Sem o segredo do cron, o envio não tenta nada
-- Mesma lição da migration 0023: sem segredo, chamada devolve 401 em loop.
-- ============================================================
do $$
declare antes int;
begin
  delete from internal_secrets where key = 'service_role_key';
  select count(*) into antes from erros_avisados;
  perform avisar_erros_do_events_log();
  perform pg_temp.assert(
    (select count(*) from erros_avisados) = antes,
    'sem segredo configurado, nada pode ser marcado como avisado');
end $$;

rollback;
