-- ============================================================
-- Invariante: um tenant tem N números Cloud API, e cadastrar mais um não
-- pode desativar nem desconectar os que já existem.
--
-- RESSALVA IMPORTANTE: isto NÃO exercita o handler HTTP
-- (POST /api/campaigns/credentials). O projeto não tem infra de teste de rota
-- Next, e montá-la é tarefa própria. O que este arquivo cobre é a REGRA que a
-- rota tem que preservar — reproduzindo aqui as mesmas operações de banco que
-- ela faz (upsert da credencial + upsert da sessão) e provando que o estado
-- dos outros números não muda. Se alguém reintroduzir um `.neq(...)` na rota,
-- este teste NÃO pega; ele pega quem quebrar o invariante no banco.
--
-- Contexto (04/09/2026): a rota tinha dois `.neq()` que desativavam as
-- credenciais e desconectavam as sessões de todos os outros números a cada
-- cadastro, porque getCloudCredential(tenantId) resolvia com `.maybeSingle()`
-- e não tolerava duas credenciais ativas. Isso quebrou em produção assim que a
-- WABA passou a ter 4 números (PGRST116, "The result contains 4 rows"):
-- responder no chat e listar templates passaram a devolver 404.
--
-- COMO RODAR: banco LOCAL. `npm run test:db`. Tudo em begin/rollback.
-- ============================================================

begin;

create temporary table _ids (chave text primary key, valor uuid) on commit drop;

create or replace function pg_temp.assert(p_condicao boolean, p_mensagem text)
returns void language plpgsql as $$
begin
  if p_condicao is not true then
    raise exception 'FALHOU: %', p_mensagem;
  end if;
end;
$$;

insert into tenants (name, slug) values ('Tenant 0027','tenant-0027');
insert into _ids select 'tenant', id from tenants where slug='tenant-0027';

-- Três números da mesma WABA, como a Plauz tem hoje.
insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, display_phone_number, access_token, active)
select (select valor from _ids where chave='tenant'), 'WABA_0027', v.pn, v.display, 'tok', true
from (values ('PN_1','+55 11 0000-0001'), ('PN_2','+55 11 0000-0002'), ('PN_3','+55 11 0000-0003')) v(pn, display);

insert into wa_sessions (tenant_id, phone_number, label, status, channel, cloud_credential_id)
select tenant_id, display_phone_number, display_phone_number, 'connected', 'cloud_api', id
from whatsapp_cloud_credentials where waba_id='WABA_0027';

-- ============================================================
-- 1. Cadastrar um número NOVO não mexe nos existentes
--    (as mesmas operações de banco que a rota executa)
-- ============================================================
do $$
declare
  t uuid := (select valor from _ids where chave='tenant');
  nova_cred uuid;
begin
  -- upsert da credencial (onConflict tenant_id,phone_number_id)
  insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, display_phone_number, access_token, active)
  values (t, 'WABA_0027', 'PN_4', '+55 11 0000-0004', 'tok', true)
  on conflict (tenant_id, phone_number_id) do update
    set access_token = excluded.access_token, active = true, updated_at = now()
  returning id into nova_cred;

  -- upsert da sessão (onConflict cloud_credential_id)
  insert into wa_sessions (tenant_id, phone_number, label, status, channel, cloud_credential_id)
  values (t, '+55 11 0000-0004', 'novo', 'connected', 'cloud_api', nova_cred);

  perform pg_temp.assert(
    (select count(*) from whatsapp_cloud_credentials where tenant_id = t and active) = 4,
    'as 4 credenciais devem seguir ativas depois de cadastrar a quarta');

  perform pg_temp.assert(
    (select count(*) from wa_sessions where tenant_id = t and channel='cloud_api' and status='connected') = 4,
    'as 4 sessões cloud_api devem seguir conectadas');

  perform pg_temp.assert(
    (select count(*) from whatsapp_cloud_credentials c
      join wa_sessions s on s.cloud_credential_id = c.id
     where c.tenant_id = t) = 4,
    'cada credencial deve ter exatamente uma sessão');
end;
$$;

-- ============================================================
-- 2. Trocar o token do MESMO número atualiza a linha, não cria outra
--    (o caso legítimo que o `.neq()` dizia cobrir)
-- ============================================================
do $$
declare
  t uuid := (select valor from _ids where chave='tenant');
begin
  insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, display_phone_number, access_token, active)
  values (t, 'WABA_NOVA', 'PN_1', '+55 11 0000-0001', 'tok_rotacionado', true)
  on conflict (tenant_id, phone_number_id) do update
    set waba_id = excluded.waba_id, access_token = excluded.access_token, active = true, updated_at = now();

  perform pg_temp.assert(
    (select count(*) from whatsapp_cloud_credentials where tenant_id = t and phone_number_id='PN_1') = 1,
    'trocar o token do mesmo número não pode criar uma segunda credencial');

  perform pg_temp.assert(
    (select access_token from whatsapp_cloud_credentials where tenant_id = t and phone_number_id='PN_1') = 'tok_rotacionado',
    'o token novo deve substituir o antigo');

  perform pg_temp.assert(
    (select count(*) from whatsapp_cloud_credentials where tenant_id = t and active) = 4,
    'rotacionar token de um número não desativa os outros');
end;
$$;

-- ============================================================
-- 3. Resolução por SESSÃO devolve exatamente um número
--    (é o que getCloudCredentialForSession faz; era aqui que o
--     .maybeSingle() por tenant estourava com N credenciais)
-- ============================================================
do $$
declare
  t uuid := (select valor from _ids where chave='tenant');
  s record;
begin
  for s in select id, cloud_credential_id from wa_sessions where tenant_id = t and channel='cloud_api' loop
    perform pg_temp.assert(
      (select count(*) from whatsapp_cloud_credentials c
       where c.id = s.cloud_credential_id and c.active) = 1,
      'cada sessão deve resolver para exatamente uma credencial ativa');
  end loop;

  -- E a prova do bug original: resolver por TENANT é ambíguo por natureza.
  perform pg_temp.assert(
    (select count(*) from whatsapp_cloud_credentials where tenant_id = t and active) > 1,
    'o cenário do teste precisa mesmo ter N credenciais ativas, senão não prova nada');
end;
$$;

-- ============================================================
-- 4. Desativar número com automação ativa é bloqueado pela rota
--    (aqui provamos só a consulta que a rota faz — a regra em si vive no
--     handler, ver ressalva no topo)
-- ============================================================
do $$
declare
  t uuid := (select valor from _ids where chave='tenant');
  c uuid := (select id from whatsapp_cloud_credentials where tenant_id = t and phone_number_id='PN_1');
begin
  insert into whatsapp_flows (tenant_id, cloud_credential_id, nome, tipo, ativo, mensagem_fallback)
  values (t, c, 'Flow do PN_1', 'keyword_automation', true, 'nao entendi');

  perform pg_temp.assert(
    (select count(*) from whatsapp_flows
      where cloud_credential_id = c and ativo and deleted_at is null) = 1,
    'a consulta que a rota usa para barrar a desativação precisa achar o Flow ativo');

  perform pg_temp.assert(
    (select count(*) from whatsapp_flows
      where cloud_credential_id = (select id from whatsapp_cloud_credentials where tenant_id = t and phone_number_id='PN_2')
        and ativo and deleted_at is null) = 0,
    'número sem automação não pode ser confundido com número que tem');
end;
$$;

do $$ begin raise notice 'OK: todas as asserções de 0027 passaram'; end; $$;

rollback;
