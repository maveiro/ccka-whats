-- ============================================================
-- Teste de RLS/acesso da migration 0025_flows_automacao.sql
-- PRD: docs/prd/prd-automacao-flows-whatsapp.md
--
-- COMO RODAR: banco LOCAL (`supabase start`) ou branch de teste.
-- NÃO rodar em produção — cria fixtures em auth.users/tenants/operators.
-- O script inteiro roda dentro de begin/rollback: nada persiste nem no
-- banco de teste, mesmo passando. Falha = `raise exception` (o script morre
-- na primeira asserção quebrada, com o motivo na mensagem).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0025_flows_automacao_rls.sql
--
-- Cobre o buraco identificado ao revisar a migration: credencial Cloud API
-- ainda SEM wa_session provisionada faz has_cloud_credential_access() cair
-- em has_session_access(null). Comportamento esperado e confirmado como
-- correto: admin e operator com session_scope='all' passam; operator
-- 'restricted' não. Na prática a sessão é auto-provisionada no cadastro da
-- credencial (campaigns/credentials/route.ts), mas isso é garantia de
-- aplicação, não do banco — daí o teste.
-- ============================================================

begin;

-- ---------- fixtures ----------
create temporary table _ids (chave text primary key, valor uuid) on commit drop;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'teste-admin-0025@exemplo.invalido'),
  (gen_random_uuid(), 'teste-op-all-0025@exemplo.invalido'),
  (gen_random_uuid(), 'teste-op-restrito-0025@exemplo.invalido');

insert into _ids (chave, valor)
select 'admin', id from auth.users where email = 'teste-admin-0025@exemplo.invalido';
insert into _ids (chave, valor)
select 'op_all', id from auth.users where email = 'teste-op-all-0025@exemplo.invalido';
insert into _ids (chave, valor)
select 'op_restrito', id from auth.users where email = 'teste-op-restrito-0025@exemplo.invalido';

insert into tenants (name, slug) values ('Tenant Teste 0025', 'tenant-teste-0025');
insert into _ids (chave, valor) select 'tenant', id from tenants where slug = 'tenant-teste-0025';

insert into operators (id, tenant_id, email, role, session_scope)
select (select valor from _ids where chave = 'admin'),
       (select valor from _ids where chave = 'tenant'),
       'teste-admin-0025@exemplo.invalido', 'admin', 'all';
insert into operators (id, tenant_id, email, role, session_scope)
select (select valor from _ids where chave = 'op_all'),
       (select valor from _ids where chave = 'tenant'),
       'teste-op-all-0025@exemplo.invalido', 'operator', 'all';
insert into operators (id, tenant_id, email, role, session_scope)
select (select valor from _ids where chave = 'op_restrito'),
       (select valor from _ids where chave = 'tenant'),
       'teste-op-restrito-0025@exemplo.invalido', 'operator', 'restricted';

-- Credencial A: SEM wa_session provisionada (o caso do teste)
insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token)
select (select valor from _ids where chave = 'tenant'), 'waba-teste', 'pn-sem-sessao', 'token-teste';
insert into _ids (chave, valor)
select 'cred_sem_sessao', id from whatsapp_cloud_credentials where phone_number_id = 'pn-sem-sessao';

-- Credencial B: COM wa_session, à qual o operator restrito NÃO tem grant
insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token)
select (select valor from _ids where chave = 'tenant'), 'waba-teste', 'pn-com-sessao', 'token-teste';
insert into _ids (chave, valor)
select 'cred_com_sessao', id from whatsapp_cloud_credentials where phone_number_id = 'pn-com-sessao';

insert into wa_sessions (tenant_id, phone_number, channel, cloud_credential_id)
select (select valor from _ids where chave = 'tenant'), '+550000000025', 'cloud_api',
       (select valor from _ids where chave = 'cred_com_sessao');
insert into _ids (chave, valor)
select 'sessao', id from wa_sessions where phone_number = '+550000000025';

insert into whatsapp_flows (tenant_id, cloud_credential_id, nome, tipo)
select (select valor from _ids where chave = 'tenant'),
       (select valor from _ids where chave = 'cred_com_sessao'),
       'Flow do número com sessão', 'keyword_automation';

insert into clientes (tenant_id, telefone, origem)
select (select valor from _ids where chave = 'tenant'), '+550000000099', 'organico';

-- ---------- helper de asserção ----------
create or replace function pg_temp.assert(p_condicao boolean, p_mensagem text)
returns void language plpgsql as $$
begin
  if p_condicao is not true then
    raise exception 'FALHOU: %', p_mensagem;
  end if;
end;
$$;

-- Executa uma expressão booleana no contexto de um operador (simula o JWT
-- que o PostgREST injeta, que é de onde auth.uid() lê).
create or replace function pg_temp.como(p_user_id uuid, p_sql text)
returns boolean language plpgsql as $$
declare
  resultado boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into resultado;
  perform set_config('role', 'postgres', true);
  return resultado;
end;
$$;

-- ============================================================
-- 1. has_cloud_credential_access() com credencial SEM sessão provisionada
-- ============================================================
do $$
declare
  cred uuid := (select valor from _ids where chave = 'cred_sem_sessao');
begin
  perform pg_temp.assert(
    pg_temp.como((select valor from _ids where chave = 'admin'),
      format('select has_cloud_credential_access(%L::uuid)', cred)),
    'admin deve ter acesso a credencial sem sessão provisionada');

  perform pg_temp.assert(
    pg_temp.como((select valor from _ids where chave = 'op_all'),
      format('select has_cloud_credential_access(%L::uuid)', cred)),
    'operator com session_scope=all deve ter acesso a credencial sem sessão');

  perform pg_temp.assert(
    pg_temp.como((select valor from _ids where chave = 'op_restrito'),
      format('select coalesce(has_cloud_credential_access(%L::uuid), false) = false', cred)),
    'operator restricted NÃO pode ter acesso a credencial sem sessão provisionada');
end;
$$;

-- ============================================================
-- 2. has_cloud_credential_access() com sessão existente, sem grant
-- ============================================================
do $$
declare
  cred uuid := (select valor from _ids where chave = 'cred_com_sessao');
begin
  perform pg_temp.assert(
    pg_temp.como((select valor from _ids where chave = 'op_restrito'),
      format('select coalesce(has_cloud_credential_access(%L::uuid), false) = false', cred)),
    'operator restricted sem grant não pode acessar a credencial');
end;
$$;

-- Concede o grant e o acesso passa a existir — sem isso o teste acima
-- passaria por qualquer motivo (função quebrada devolvendo false sempre).
insert into operator_session_access (operator_id, session_id, tenant_id)
select (select valor from _ids where chave = 'op_restrito'),
       (select valor from _ids where chave = 'sessao'),
       (select valor from _ids where chave = 'tenant');

do $$
declare
  cred uuid := (select valor from _ids where chave = 'cred_com_sessao');
begin
  perform pg_temp.assert(
    pg_temp.como((select valor from _ids where chave = 'op_restrito'),
      format('select has_cloud_credential_access(%L::uuid)', cred)),
    'operator restricted COM grant deve acessar a credencial');
end;
$$;

-- ============================================================
-- 3. RLS de whatsapp_flows enxerga o mesmo que a função
-- ============================================================
delete from operator_session_access
where operator_id = (select valor from _ids where chave = 'op_restrito');

do $$
begin
  perform pg_temp.assert(
    pg_temp.como((select valor from _ids where chave = 'op_restrito'),
      'select count(*) = 0 from whatsapp_flows'),
    'operator restricted sem grant não pode enxergar Flow de outro número');

  perform pg_temp.assert(
    pg_temp.como((select valor from _ids where chave = 'admin'),
      'select count(*) = 1 from whatsapp_flows'),
    'admin deve enxergar o Flow do tenant');
end;
$$;

-- ============================================================
-- 4. clientes é admin-only (decisão fechada: sem SELECT para operator)
-- ============================================================
do $$
begin
  perform pg_temp.assert(
    pg_temp.como((select valor from _ids where chave = 'op_all'),
      'select count(*) = 0 from clientes'),
    'operator (mesmo com session_scope=all) não pode listar clientes — PII admin-only');

  perform pg_temp.assert(
    pg_temp.como((select valor from _ids where chave = 'admin'),
      'select count(*) = 1 from clientes'),
    'admin deve listar clientes do tenant');
end;
$$;

do $$ begin raise notice 'OK: todas as asserções de 0025 passaram'; end; $$;

rollback;
