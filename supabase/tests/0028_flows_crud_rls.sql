-- ============================================================
-- Contrato de acesso do CRUD de Flows (Sprint A2).
--
-- As rotas em apps/web/app/api/flows/* delegam a autorização à RLS da 0025
-- (regra 15 do CLAUDE.md: a autoridade é o Supabase, não filtro de app). Este
-- arquivo prova esse contrato: quem pode criar, editar, excluir, e o que o
-- banco impede independentemente do que a UI faça.
--
-- RESSALVA (mesma de 0027): não exercita os handlers HTTP — não há infra de
-- teste de rota Next no projeto. Se alguém trocar a checagem de role numa
-- rota, este teste não pega; ele pega quem quebrar a RLS por baixo.
--
-- COMO RODAR: banco LOCAL, `npm run test:db`. Tudo em begin/rollback.
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

-- Executa SQL como um operador (simula o JWT que o PostgREST injeta).
create or replace function pg_temp.como(p_user_id uuid, p_sql text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql;
  perform set_config('role', 'postgres', true);
end;
$$;

create or replace function pg_temp.como_int(p_user_id uuid, p_sql text)
returns int language plpgsql as $$
declare r int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into r;
  perform set_config('role', 'postgres', true);
  return r;
end;
$$;

-- ---------- fixtures ----------
insert into tenants (name, slug) values ('Tenant 0028','tenant-0028');
insert into _ids select 'tenant', id from tenants where slug='tenant-0028';

insert into auth.users (id, email) values
  (gen_random_uuid(), 'admin-0028@exemplo.invalido'),
  (gen_random_uuid(), 'op-com-acesso-0028@exemplo.invalido'),
  (gen_random_uuid(), 'op-sem-acesso-0028@exemplo.invalido');
insert into _ids select 'admin', id from auth.users where email='admin-0028@exemplo.invalido';
insert into _ids select 'op_ok', id from auth.users where email='op-com-acesso-0028@exemplo.invalido';
insert into _ids select 'op_nao', id from auth.users where email='op-sem-acesso-0028@exemplo.invalido';

insert into operators (id, tenant_id, email, role, session_scope)
select (select valor from _ids where chave='admin'), (select valor from _ids where chave='tenant'),
       'admin-0028@exemplo.invalido', 'admin', 'all';
insert into operators (id, tenant_id, email, role, session_scope)
select (select valor from _ids where chave='op_ok'), (select valor from _ids where chave='tenant'),
       'op-com-acesso-0028@exemplo.invalido', 'operator', 'restricted';
insert into operators (id, tenant_id, email, role, session_scope)
select (select valor from _ids where chave='op_nao'), (select valor from _ids where chave='tenant'),
       'op-sem-acesso-0028@exemplo.invalido', 'operator', 'restricted';

insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token)
select (select valor from _ids where chave='tenant'), 'WABA_0028', 'PN_0028', 'tok';
insert into _ids select 'cred', id from whatsapp_cloud_credentials where phone_number_id='PN_0028';

insert into wa_sessions (tenant_id, phone_number, channel, cloud_credential_id, status)
select (select valor from _ids where chave='tenant'), '+55 11 0000-0028', 'cloud_api',
       (select valor from _ids where chave='cred'), 'connected';
insert into _ids select 'sessao', id from wa_sessions where phone_number='+55 11 0000-0028';

-- Só o op_ok recebe acesso ao número.
insert into operator_session_access (operator_id, session_id, tenant_id)
select (select valor from _ids where chave='op_ok'), (select valor from _ids where chave='sessao'),
       (select valor from _ids where chave='tenant');

-- ============================================================
-- 1. Operator COM acesso ao número cria Flow e palavra-chave
--    (decisão fechada do PRD: criar/editar não é admin-only)
-- ============================================================
do $$
declare
  t uuid := (select valor from _ids where chave='tenant');
  c uuid := (select valor from _ids where chave='cred');
begin
  perform pg_temp.como((select valor from _ids where chave='op_ok'), format(
    'insert into whatsapp_flows (tenant_id, cloud_credential_id, nome, tipo, ativo, mensagem_fallback)
     values (%L, %L, ''Flow do operator'', ''keyword_automation'', false, ''nao entendi'')', t, c));

  perform pg_temp.assert(
    (select count(*) from whatsapp_flows where nome='Flow do operator') = 1,
    'operator com acesso ao número deve conseguir criar Flow');
end;
$$;

insert into _ids select 'flow', id from whatsapp_flows where nome='Flow do operator';

do $$
declare
  t uuid := (select valor from _ids where chave='tenant');
  f uuid := (select valor from _ids where chave='flow');
begin
  perform pg_temp.como((select valor from _ids where chave='op_ok'), format(
    'insert into flow_palavras_chave (tenant_id, flow_id, palavra_chave, tipo_resposta, resposta)
     values (%L, %L, ''ingresso'', ''link'', ''https://exemplo.invalido'')', t, f));

  perform pg_temp.assert(
    (select count(*) from flow_palavras_chave where flow_id = f) = 1,
    'operator com acesso deve conseguir cadastrar palavra-chave');

  -- Editar também (o motor lê o que a UI grava aqui).
  perform pg_temp.como((select valor from _ids where chave='op_ok'), format(
    'update whatsapp_flows set mensagem_boas_vindas = ''oi'' where id = %L', f));
  perform pg_temp.assert(
    (select mensagem_boas_vindas from whatsapp_flows where id = f) = 'oi',
    'operator com acesso deve conseguir editar o Flow');
end;
$$;

-- ============================================================
-- 2. Operator SEM acesso ao número não enxerga nem edita
-- ============================================================
do $$
declare
  f uuid := (select valor from _ids where chave='flow');
begin
  perform pg_temp.assert(
    pg_temp.como_int((select valor from _ids where chave='op_nao'),
      'select count(*)::int from whatsapp_flows') = 0,
    'operator sem acesso ao número não pode enxergar o Flow');

  perform pg_temp.assert(
    pg_temp.como_int((select valor from _ids where chave='op_nao'),
      'select count(*)::int from flow_palavras_chave') = 0,
    'operator sem acesso não pode enxergar as palavras-chave');

  -- UPDATE não falha com erro: a RLS simplesmente não encontra a linha.
  perform pg_temp.como((select valor from _ids where chave='op_nao'), format(
    'update whatsapp_flows set nome = ''sequestrado'' where id = %L', f));
  perform pg_temp.assert(
    (select nome from whatsapp_flows where id = f) = 'Flow do operator',
    'operator sem acesso não pode alterar o Flow de outro número');
end;
$$;

-- ============================================================
-- 3. Exclusão é admin-only (regra 21 — simetria com sessões)
-- ============================================================
do $$
declare
  f uuid := (select valor from _ids where chave='flow');
begin
  perform pg_temp.como((select valor from _ids where chave='op_ok'), format(
    'delete from whatsapp_flows where id = %L', f));
  perform pg_temp.assert(
    (select count(*) from whatsapp_flows where id = f) = 1,
    'operator NÃO pode excluir Flow (delete é admin-only)');

  perform pg_temp.como((select valor from _ids where chave='admin'), format(
    'delete from flow_palavras_chave where flow_id = %L', f));
  perform pg_temp.assert(
    (select count(*) from flow_palavras_chave where flow_id = f) = 0,
    'admin pode excluir palavra-chave');
end;
$$;

-- ============================================================
-- 4. O banco impede dois Flows ativos do mesmo tipo no mesmo número
--    (a UI depende disso: "o Flow ativo do número" só existe se for único)
-- ============================================================
do $$
declare
  t uuid := (select valor from _ids where chave='tenant');
  c uuid := (select valor from _ids where chave='cred');
  f uuid := (select valor from _ids where chave='flow');
  falhou boolean := false;
begin
  update whatsapp_flows set ativo = true where id = f;

  begin
    insert into whatsapp_flows (tenant_id, cloud_credential_id, nome, tipo, ativo)
    values (t, c, 'Segundo ativo', 'keyword_automation', true);
  exception when unique_violation then
    falhou := true;
  end;

  perform pg_temp.assert(falhou, 'segundo Flow ativo do mesmo tipo no mesmo número deve ser rejeitado');

  -- Um Flow soft-deletado que ficou ativo=true não pode bloquear o substituto
  -- (é o motivo do `deleted_at is null` no índice único da 0025).
  update whatsapp_flows set deleted_at = now() where id = f;
  insert into whatsapp_flows (tenant_id, cloud_credential_id, nome, tipo, ativo)
  values (t, c, 'Substituto', 'keyword_automation', true);

  perform pg_temp.assert(
    (select count(*) from whatsapp_flows where nome='Substituto') = 1,
    'Flow soft-deletado não pode bloquear a criação do substituto ativo');
end;
$$;

do $$ begin raise notice 'OK: todas as asserções de 0028 passaram'; end; $$;

rollback;
