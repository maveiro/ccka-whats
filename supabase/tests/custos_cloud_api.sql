-- ============================================================
-- Teste da migration 20260910173238_custos_cloud_api.sql
--
-- COMO RODAR: banco LOCAL (`supabase start`). NÃO rodar em produção —
-- cria fixtures em auth.users/tenants/operators. Tudo dentro de
-- begin/rollback: nada persiste, mesmo passando. Falha = raise exception.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/custos_cloud_api.sql
--
-- Cobre o que a tela de Custos assume e o banco precisa garantir:
--  1. resolve_whatsapp_rate escolhe a tarifa VIGENTE na data — inclusive a
--     virada de 01/10/2026 (mensagem de serviço deixa de ser grátis);
--  2. a linha de 01/10 está marcada como estimated (rate card final ainda
--     não publicado) — é o que faz a UI rotular a projeção;
--  3. o ledger é admin-only e isolado por tenant (RLS, não filtro de app);
--  4. costs_summary/campaign_cost respondem com o valor congelado na linha,
--     não recalculado a partir da tarifa de hoje.
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

-- Executa SQL no contexto de um operador (mesmo truque dos testes de RLS:
-- request.jwt.claims é de onde auth.uid() lê).
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

-- ---------- fixtures ----------
insert into auth.users (id, email) values
  (gen_random_uuid(), 'teste-admin-custos@exemplo.invalido'),
  (gen_random_uuid(), 'teste-op-custos@exemplo.invalido'),
  (gen_random_uuid(), 'teste-admin-outro-custos@exemplo.invalido');

insert into _ids select 'admin', id from auth.users where email = 'teste-admin-custos@exemplo.invalido';
insert into _ids select 'operador', id from auth.users where email = 'teste-op-custos@exemplo.invalido';
insert into _ids select 'admin_outro', id from auth.users where email = 'teste-admin-outro-custos@exemplo.invalido';

insert into tenants (name, slug) values
  ('Tenant Custos', 'tenant-custos-teste'),
  ('Tenant Vizinho', 'tenant-vizinho-custos-teste');
insert into _ids select 'tenant', id from tenants where slug = 'tenant-custos-teste';
insert into _ids select 'tenant_vizinho', id from tenants where slug = 'tenant-vizinho-custos-teste';

insert into operators (id, tenant_id, email, role, session_scope)
select (select valor from _ids where chave = 'admin'), (select valor from _ids where chave = 'tenant'),
       'teste-admin-custos@exemplo.invalido', 'admin', 'all';
insert into operators (id, tenant_id, email, role, session_scope)
select (select valor from _ids where chave = 'operador'), (select valor from _ids where chave = 'tenant'),
       'teste-op-custos@exemplo.invalido', 'operator', 'all';
insert into operators (id, tenant_id, email, role, session_scope)
select (select valor from _ids where chave = 'admin_outro'), (select valor from _ids where chave = 'tenant_vizinho'),
       'teste-admin-outro-custos@exemplo.invalido', 'admin', 'all';

insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token)
select (select valor from _ids where chave = 'tenant'), 'waba-custos', 'pn-custos', 'tok';
insert into _ids select 'cred', id from whatsapp_cloud_credentials where phone_number_id = 'pn-custos';

insert into campaigns (tenant_id, credential_id, name, template_name, template_language, template_category, status)
select (select valor from _ids where chave = 'tenant'), (select valor from _ids where chave = 'cred'),
       'Campanha custos', 'tmpl_custos', 'pt_BR', 'MARKETING', 'completed';
insert into _ids select 'campanha', id from campaigns where name = 'Campanha custos';

-- ============================================================
-- 1. resolve_whatsapp_rate por data
-- ============================================================
do $$
begin
  perform pg_temp.assert(
    resolve_whatsapp_rate('BR', 'marketing', 'BRL', '2026-08-15'::timestamptz) = 0.321700,
    'marketing BR em ago/2026 deve ser 0,3217');

  perform pg_temp.assert(
    resolve_whatsapp_rate('BR', 'utility', 'BRL', '2026-08-15'::timestamptz) = 0.035000,
    'utility BR em ago/2026 deve ser 0,0350');

  -- Antes da virada, mensagem de serviço é grátis.
  perform pg_temp.assert(
    resolve_whatsapp_rate('BR', 'service', 'BRL', '2026-09-30'::timestamptz) = 0,
    'serviço em 30/09/2026 (véspera da virada) ainda deve ser zero');

  -- Na virada e depois dela, passa a custar a tarifa de utility/auth.
  perform pg_temp.assert(
    resolve_whatsapp_rate('BR', 'service', 'BRL', '2026-10-01'::timestamptz) = 0.035000,
    'serviço em 01/10/2026 deve passar a custar 0,0350');
  perform pg_temp.assert(
    resolve_whatsapp_rate('BR', 'service', 'BRL', '2026-12-25'::timestamptz) = 0.035000,
    'serviço depois da virada deve continuar custando 0,0350');

  -- País sem rate card cadastrado devolve null (o webhook grava zero e a
  -- tela conta essas mensagens à parte, em vez de fingir custo completo).
  perform pg_temp.assert(
    resolve_whatsapp_rate('PT', 'marketing', 'BRL', now()) is null,
    'país fora do rate card local deve devolver null, não uma tarifa qualquer');

  -- Data anterior a qualquer vigência não pode "herdar" a tarifa futura.
  perform pg_temp.assert(
    resolve_whatsapp_rate('BR', 'marketing', 'BRL', '2026-01-01'::timestamptz) is null,
    'data anterior à primeira vigência não deve resolver tarifa');
end;
$$;

-- ============================================================
-- 2. A tarifa da virada está marcada como estimativa
-- ============================================================
do $$
begin
  perform pg_temp.assert(
    (select estimated from whatsapp_rates
      where country_code = 'BR' and category = 'service' and effective_from = '2026-10-01'),
    'a tarifa de serviço de 01/10/2026 precisa estar marcada como estimated — é o que faz a UI rotular a projeção');

  perform pg_temp.assert(
    (select not estimated from whatsapp_rates
      where country_code = 'BR' and category = 'marketing' and effective_from = '2026-07-01'),
    'a tarifa de marketing vigente é oficial, não estimativa');
end;
$$;

-- ============================================================
-- 3. Ledger: RLS admin-only e isolamento por tenant
-- ============================================================
insert into whatsapp_message_costs
  (tenant_id, wamid, campaign_id, phone_number_id, recipient_phone, country_code,
   billable, pricing_model, pricing_type, pricing_category, rate_amount, currency, sent_at)
select (select valor from _ids where chave = 'tenant'), 'wamid-custos-1',
       (select valor from _ids where chave = 'campanha'), 'pn-custos', '5541900000001', 'BR',
       true, 'PMP', 'regular', 'marketing', 0.321700, 'BRL', '2026-08-15T12:00:00Z';

insert into whatsapp_message_costs
  (tenant_id, wamid, phone_number_id, recipient_phone, country_code,
   billable, pricing_model, pricing_type, pricing_category, rate_amount, currency, sent_at)
select (select valor from _ids where chave = 'tenant'), 'wamid-custos-2', 'pn-custos', '5541900000002', 'BR',
       false, 'PMP', 'free_customer_service', 'service', 0, 'BRL', '2026-08-15T13:00:00Z';

insert into whatsapp_message_costs
  (tenant_id, wamid, phone_number_id, country_code, billable, pricing_type, pricing_category, rate_amount, currency, sent_at)
select (select valor from _ids where chave = 'tenant_vizinho'), 'wamid-vizinho', 'pn-outro', 'BR',
       true, 'regular', 'marketing', 0.321700, 'BRL', '2026-08-15T14:00:00Z';

do $$
begin
  perform pg_temp.assert(
    pg_temp.como((select valor from _ids where chave = 'admin'),
      'select count(*) = 2 from whatsapp_message_costs'),
    'admin deve ver as 2 linhas do próprio tenant — e só elas');

  perform pg_temp.assert(
    pg_temp.como((select valor from _ids where chave = 'operador'),
      'select count(*) = 0 from whatsapp_message_costs'),
    'operator não-admin não pode ver custo (RLS admin_only)');

  perform pg_temp.assert(
    pg_temp.como((select valor from _ids where chave = 'admin_outro'),
      'select count(*) = 1 from whatsapp_message_costs'),
    'admin do tenant vizinho só pode ver a linha dele');
end;
$$;

-- ============================================================
-- 4. Agregações usam o valor CONGELADO na linha
-- ============================================================
-- Tarifa de marketing muda depois do disparo: o custo já registrado não pode
-- se mexer (é dado de faturamento, não de operação).
insert into whatsapp_rates (country_code, category, currency, amount, effective_from, estimated, source)
values ('BR', 'marketing', 'BRL', 0.999900, '2026-08-20', false, 'fixture de teste: reajuste posterior ao disparo');

do $$
declare
  resumo jsonb;
begin
  perform pg_temp.assert(
    pg_temp.como((select valor from _ids where chave = 'admin'),
      format('select campaign_cost(%L::uuid) = 0.321700', (select valor from _ids where chave = 'campanha'))),
    'campaign_cost deve devolver o valor congelado (0,3217), não a tarifa nova');

  perform set_config('request.jwt.claims',
    json_build_object('sub', (select valor from _ids where chave = 'admin'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select costs_summary('2026-08-01T00:00:00Z'::timestamptz, '2026-09-01T00:00:00Z'::timestamptz, null) into resumo;
  perform set_config('role', 'postgres', true);

  perform pg_temp.assert((resumo->>'total')::numeric = 0.321700,
    format('total do período deveria ser 0,3217, veio %s', resumo->>'total'));
  perform pg_temp.assert((resumo->>'messages')::int = 2,
    format('deveria contar as 2 mensagens do tenant, veio %s', resumo->>'messages'));
  perform pg_temp.assert((resumo->>'billableMessages')::int = 1,
    'só a mensagem de marketing é cobrada');
  perform pg_temp.assert((resumo->>'freeMessages')::int = 1,
    'a mensagem de serviço dentro da janela entra como grátis');

  -- Projeção da virada: a ÚNICA mensagem de serviço do mês cabe na franquia
  -- de 1.000 por número, então continua grátis mesmo depois de 01/10 — a
  -- franquia é a parte da regra que mais engana quem só olha a tarifa.
  perform pg_temp.assert((resumo->'projection'->>'newlyBillable')::int = 0,
    format('1 mensagem de serviço cabe na franquia e não deveria virar cobrada; veio %s', resumo->'projection'->>'newlyBillable'));
  perform pg_temp.assert((resumo->'projection'->>'total')::numeric = 0.321700,
    format('projeção deveria seguir 0,3217, veio %s', resumo->'projection'->>'total'));
  perform pg_temp.assert((resumo->'projection'->>'estimated')::boolean,
    'a projeção precisa se declarar estimativa enquanto o rate card de outubro não sair');
end;
$$;

-- ============================================================
-- 4b. Template de UTILIDADE dentro da janela: perde a gratuidade em 01/10
--     e, ao contrário da mensagem de serviço, não tem franquia nenhuma.
-- ============================================================
insert into whatsapp_message_costs
  (tenant_id, wamid, phone_number_id, country_code, billable, pricing_type, pricing_category, rate_amount, currency, sent_at)
select (select valor from _ids where chave = 'tenant'), 'wamid-utility-janela', 'pn-custos', 'BR',
       false, 'free_customer_service', 'utility', 0, 'BRL', '2026-08-15T15:00:00Z';

do $$
declare
  resumo jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select valor from _ids where chave = 'admin'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select costs_summary('2026-08-01T00:00:00Z'::timestamptz, '2026-09-01T00:00:00Z'::timestamptz, null) into resumo;
  perform set_config('role', 'postgres', true);

  perform pg_temp.assert((resumo->>'total')::numeric = 0.321700,
    'hoje o template de utilidade dentro da janela continua grátis');
  perform pg_temp.assert((resumo->'projection'->>'newlyBillable')::int = 1,
    format('o template de utilidade deveria virar cobrado em 01/10, veio %s', resumo->'projection'->>'newlyBillable'));
  perform pg_temp.assert((resumo->'projection'->>'total')::numeric = 0.356700,
    format('projeção deveria ser 0,3217 + 0,0350 = 0,3567, veio %s', resumo->'projection'->>'total'));
end;
$$;

-- ============================================================
-- 5. Franquia de 1.000 mensagens de serviço por número/mês na projeção
-- ============================================================
insert into whatsapp_message_costs
  (tenant_id, wamid, phone_number_id, country_code, billable, pricing_type, pricing_category, rate_amount, currency, sent_at)
select (select valor from _ids where chave = 'tenant'), 'wamid-franquia-' || g, 'pn-custos', 'BR',
       false, 'free_customer_service', 'service', 0, 'BRL', '2026-08-16T10:00:00Z'::timestamptz + (g || ' seconds')::interval
from generate_series(1, 1000) g;

do $$
declare
  resumo jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select valor from _ids where chave = 'admin'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select costs_summary('2026-08-01T00:00:00Z'::timestamptz, '2026-09-01T00:00:00Z'::timestamptz, null) into resumo;
  perform set_config('role', 'postgres', true);

  -- 1.001 mensagens de serviço no mês, franquia de 1.000 → só 1 passa.
  -- Somada ao template de utilidade do cenário 4b (que não tem franquia): 2.
  perform pg_temp.assert((resumo->'projection'->>'newlyBillable')::int = 2,
    format('com 1.001 de serviço (1 acima da franquia) + 1 utilidade, esperado 2; veio %s', resumo->'projection'->>'newlyBillable'));
end;
$$;

rollback;
