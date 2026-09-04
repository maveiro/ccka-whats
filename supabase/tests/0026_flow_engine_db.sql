-- ============================================================
-- Primitivas de banco que o flow-engine depende (migration 0026) + RLS.
-- O comportamento do motor em si está em flow_engine.e2e.ts — aqui ficam só
-- as garantias que TÊM que ser do banco, não da aplicação.
--
-- COMO RODAR: banco LOCAL. NÃO rodar em produção (cria fixtures em auth.users).
--   npm run test:db
-- Tudo dentro de begin/rollback; falha = raise exception.
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

-- ---------- fixtures: dois tenants, para provar isolamento ----------
insert into tenants (name, slug) values ('Tenant A 0026','tenant-a-0026'), ('Tenant B 0026','tenant-b-0026');
insert into _ids select 'tenant_a', id from tenants where slug='tenant-a-0026';
insert into _ids select 'tenant_b', id from tenants where slug='tenant-b-0026';

insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token)
select valor, 'WABA_A', 'PN_A', 'tok' from _ids where chave='tenant_a';
insert into _ids select 'cred_a', id from whatsapp_cloud_credentials where phone_number_id='PN_A';

insert into whatsapp_flows (tenant_id, cloud_credential_id, nome, tipo, mensagem_boas_vindas, mensagem_fallback)
select (select valor from _ids where chave='tenant_a'), (select valor from _ids where chave='cred_a'),
       'Flow A', 'keyword_automation', 'Bem-vindo!', 'Não entendi.';
insert into _ids select 'flow_a', id from whatsapp_flows where nome='Flow A';

insert into clientes (tenant_id, telefone, origem)
select valor, '5541999990001', 'organico' from _ids where chave='tenant_a';
insert into clientes (tenant_id, telefone, origem)
select valor, '5541999990001', 'organico' from _ids where chave='tenant_b';

-- ============================================================
-- 1. Idempotência: o claim é atômico, a segunda tentativa não insere
-- ============================================================
do $$
declare
  ta uuid := (select valor from _ids where chave='tenant_a');
  tb uuid := (select valor from _ids where chave='tenant_b');
  n int;
begin
  insert into flow_mensagens_processadas (tenant_id, message_id) values (ta, 'wamid.X')
  on conflict (tenant_id, message_id) do nothing;
  get diagnostics n = row_count;
  perform pg_temp.assert(n = 1, 'primeiro claim de wamid.X deve inserir');

  insert into flow_mensagens_processadas (tenant_id, message_id) values (ta, 'wamid.X')
  on conflict (tenant_id, message_id) do nothing;
  get diagnostics n = row_count;
  perform pg_temp.assert(n = 0, 'segundo claim do mesmo wamid NÃO pode inserir (senão duplica resposta)');

  -- O mesmo wamid em outro tenant é outra mensagem: a chave é composta.
  insert into flow_mensagens_processadas (tenant_id, message_id) values (tb, 'wamid.X')
  on conflict (tenant_id, message_id) do nothing;
  get diagnostics n = row_count;
  perform pg_temp.assert(n = 1, 'mesmo wamid em outro tenant deve ser aceito');
end;
$$;

-- ============================================================
-- 2. try_lock_gate: só um pega; expirado pode ser retomado
-- ============================================================
do $$
declare
  ta uuid := (select valor from _ids where chave='tenant_a');
begin
  perform pg_temp.assert(
    coalesce(try_lock_gate(ta, '5541999990001', 30), false),
    'primeiro try_lock_gate deve conceder o lock');

  perform pg_temp.assert(
    coalesce(try_lock_gate(ta, '5541999990001', 30), false) = false,
    'segundo try_lock_gate concorrente NÃO pode conceder o lock');

  -- Lock expirado é retomável — senão uma function que morra no meio do gate
  -- travaria aquele telefone para sempre.
  update clientes set gate_lock_ate = now() - interval '1 second'
  where tenant_id = ta and telefone = '5541999990001';

  perform pg_temp.assert(
    coalesce(try_lock_gate(ta, '5541999990001', 30), false),
    'lock expirado deve poder ser readquirido');

  perform unlock_gate(ta, '5541999990001');
  perform pg_temp.assert(
    (select gate_lock_ate is null from clientes where tenant_id = ta and telefone = '5541999990001'),
    'unlock_gate deve liberar o lock');
end;
$$;

-- ============================================================
-- 3. Isolamento de tenant: o lock de um tenant não afeta o outro
--    (mesmo telefone existindo nos dois — o caso que um .eq('tenant_id')
--     esquecido quebraria)
-- ============================================================
do $$
declare
  ta uuid := (select valor from _ids where chave='tenant_a');
  tb uuid := (select valor from _ids where chave='tenant_b');
begin
  perform pg_temp.assert(coalesce(try_lock_gate(ta, '5541999990001', 30), false),
    'tenant A deve conseguir o lock');
  perform pg_temp.assert(coalesce(try_lock_gate(tb, '5541999990001', 30), false),
    'tenant B deve conseguir o lock do MESMO telefone — locks são por tenant');
  perform pg_temp.assert(
    (select count(*) from clientes where telefone='5541999990001' and gate_lock_ate is not null) = 2,
    'os dois clientes homônimos devem estar travados independentemente');
end;
$$;

-- ============================================================
-- 4. Coerência do gate garantida pelo banco (constraint da 0025)
-- ============================================================
do $$
declare
  ta uuid := (select valor from _ids where chave='tenant_a');
  falhou boolean := false;
begin
  begin
    update clientes set cadastro_completo = true, aguardando_campo = 'email'
    where tenant_id = ta and telefone = '5541999990001';
  exception when check_violation then
    falhou := true;
  end;
  perform pg_temp.assert(falhou, 'cadastro_completo=true com aguardando_campo preenchido deve ser rejeitado pelo banco');
end;
$$;

-- ============================================================
-- 5. Unicidade de flow_contato_estado por (flow, telefone)
--    Sem isso o reset de 14 dias passa a ler a linha errada.
-- ============================================================
do $$
declare
  ta uuid := (select valor from _ids where chave='tenant_a');
  fa uuid := (select valor from _ids where chave='flow_a');
  falhou boolean := false;
begin
  insert into flow_contato_estado (tenant_id, flow_id, contato_telefone) values (ta, fa, '5541999990001');
  begin
    insert into flow_contato_estado (tenant_id, flow_id, contato_telefone) values (ta, fa, '5541999990001');
  exception when unique_violation then
    falhou := true;
  end;
  perform pg_temp.assert(falhou, 'estado duplicado para (flow, telefone) deve ser rejeitado');
end;
$$;

-- ============================================================
-- 6. RLS: flow_mensagens_processadas é admin-only (PII indireta: telefone
--    aparece no histórico de quem falou com o número)
-- ============================================================
insert into auth.users (id, email) values (gen_random_uuid(), 'op-0026@exemplo.invalido');
insert into _ids select 'op', id from auth.users where email='op-0026@exemplo.invalido';
insert into operators (id, tenant_id, email, role, session_scope)
select (select valor from _ids where chave='op'), (select valor from _ids where chave='tenant_a'),
       'op-0026@exemplo.invalido', 'operator', 'all';

do $$
declare
  resultado int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select valor from _ids where chave='op'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into resultado from flow_mensagens_processadas;
  perform set_config('role', 'postgres', true);

  perform pg_temp.assert(resultado = 0, 'operator não pode enxergar flow_mensagens_processadas');
end;
$$;

do $$ begin raise notice 'OK: todas as asserções de 0026 passaram'; end; $$;

rollback;
