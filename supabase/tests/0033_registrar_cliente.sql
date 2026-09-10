-- ============================================================
-- Porta única de cadastro (migration 0033).
--
-- Cada asserção aqui corresponde a um problema real deste projeto:
-- telefone divergente entre landing e WhatsApp, cadastro sobrescrito com
-- vazio, consentimento não registrado pelo gate, e dado apagado por pedido do
-- titular voltando por outro canal.
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

insert into tenants (name, slug) values ('Tenant 0033','tenant-0033');
insert into _ids select 'tenant', id from tenants where slug='tenant-0033';

-- ============================================================
-- 1. Normalização: formatos diferentes viram a MESMA pessoa
-- ============================================================
do $$
declare t uuid := (select valor from _ids where chave='tenant');
begin
  perform registrar_cliente(t, '(41) 99999-9999', 'Ana', null, 'landing', 'v1', 'landing');
  perform registrar_cliente(t, '5541999999999', null, 'ana@exemplo.invalido', 'flow', null, null);
  perform registrar_cliente(t, '+55 41 99999-9999', null, null, 'organico', null, null);

  perform pg_temp.assert(
    (select count(*) from clientes where tenant_id = t) = 1,
    'os três formatos deveriam ser a mesma pessoa — é o que faz a central reconhecer quem veio da landing');

  perform pg_temp.assert(
    (select telefone from clientes where tenant_id = t) = '5541999999999',
    'o telefone deve ser guardado normalizado');

  perform pg_temp.assert(
    (select nome = 'Ana' and email = 'ana@exemplo.invalido' and cadastro_completo
     from clientes where tenant_id = t),
    'canais diferentes preenchem lacunas do mesmo cadastro');
end;
$$;

-- ============================================================
-- 2. Não sobrescrever dado bom com vazio
-- ============================================================
do $$
declare t uuid := (select valor from _ids where chave='tenant');
begin
  perform registrar_cliente(t, '5541999999999', null, null, 'campanha', null, null);
  perform pg_temp.assert(
    (select nome = 'Ana' and email is not null from clientes where tenant_id = t),
    'um canal que só sabe o telefone não pode apagar o que outro coletou');
end;
$$;

-- ============================================================
-- 3. Valor novo e não-vazio vence, e a troca fica registrada
-- ============================================================
do $$
declare
  t uuid := (select valor from _ids where chave='tenant');
  antes int;
begin
  -- Conta ANTES: preencher o e-mail na etapa 1 já foi uma atualização, então
  -- comparar com um número fixo aqui esconderia o que se quer medir.
  select count(*) into antes from events_log
  where tenant_id = t and event_type = 'cliente_dado_atualizado';

  perform registrar_cliente(t, '5541999999999', 'Ana Maria', null, 'painel', null, null);
  perform pg_temp.assert(
    (select nome = 'Ana Maria' from clientes where tenant_id = t),
    'o dado mais recente com valor deve vencer (decisão do fundador)');
  perform pg_temp.assert(
    (select count(*) from events_log where tenant_id = t and event_type = 'cliente_dado_atualizado') = antes + 1,
    'a troca precisa gerar exatamente um evento novo');
  -- Selecionado pela ORIGEM, não pelo mais recente: dentro de uma transação
  -- now() é constante, então created_at empata e o "último" é arbitrário.
  perform pg_temp.assert(
    (select payload->>'trocou_nome' = 'true' and payload::text not like '%Ana Maria%'
     from events_log
     where tenant_id = t and event_type='cliente_dado_atualizado'
       and payload->>'origem' = 'painel'),
    'o log registra QUE mudou, nunca o valor — log não é lugar de PII');
end;
$$;

-- ============================================================
-- 4. Consentimento versionado — a lacuna que o gate tinha
-- ============================================================
do $$
declare t uuid := (select valor from _ids where chave='tenant');
begin
  perform pg_temp.assert(
    (select consentimento_versao = 'v1' and consentimento_em is not null
     from clientes where tenant_id = t),
    'o consentimento informado no primeiro cadastro precisa persistir');

  perform registrar_cliente(t, '5541999999999', null, null, 'flow', 'v2-2026-09', 'flow');
  perform pg_temp.assert(
    (select consentimento_versao = 'v2-2026-09' from clientes where tenant_id = t),
    'consentimento novo substitui o antigo (é o que vale para auditoria)');

  perform registrar_cliente(t, '5541999999999', 'Ana Maria', null, 'painel', null, null);
  perform pg_temp.assert(
    (select consentimento_versao = 'v2-2026-09' from clientes where tenant_id = t),
    'canal sem consentimento não pode apagar o aceite já registrado');
end;
$$;

-- ============================================================
-- 5. Direito ao esquecimento não é desfeito por outro canal
-- ============================================================
do $$
declare t uuid := (select valor from _ids where chave='tenant');
begin
  update clientes set nome = null, email = null, pii_apagada_em = now() where tenant_id = t;

  perform registrar_cliente(t, '5541999999999', 'Ana', 'ana@exemplo.invalido', 'landing', 'v3', 'landing');

  perform pg_temp.assert(
    (select nome is null and email is null from clientes where tenant_id = t),
    'quem pediu exclusão não pode ser recadastrado pela porta dos fundos');
  perform pg_temp.assert(
    (select count(*) from events_log where tenant_id = t and event_type='cliente_cadastro_ignorado_pii_apagada') = 1,
    'a tentativa precisa ficar registrada — é auditoria de LGPD');
end;
$$;

-- ============================================================
-- 6. Telefone inválido falha alto, não grava lixo
-- ============================================================
do $$
declare t uuid := (select valor from _ids where chave='tenant'); falhou boolean := false;
begin
  begin
    perform registrar_cliente(t, 'não é telefone', 'X', null, 'landing', null, null);
  exception when others then falhou := true;
  end;
  perform pg_temp.assert(falhou, 'telefone sem dígito nenhum deve falhar em vez de virar cadastro');
end;
$$;

-- ============================================================
-- 7. Contato de campanha não passa pelo gate
-- ============================================================
do $$
declare t uuid := (select valor from _ids where chave='tenant');
begin
  perform registrar_cliente(t, '5541988887777', null, null, 'campanha', null, null);
  perform pg_temp.assert(
    (select cadastro_completo and aguardando_campo is null
     from clientes where tenant_id = t and telefone='5541988887777'),
    'quem veio de campanha já é conhecido do negócio e não pode cair no gate');

  perform registrar_cliente(t, '5541977776666', null, null, 'organico', null, null);
  perform pg_temp.assert(
    (select not cadastro_completo from clientes where tenant_id = t and telefone='5541977776666'),
    'quem chega orgânico sem dado nenhum ainda precisa do gate');
end;
$$;

-- ============================================================
-- 8. Toda origem prevista é aceita — a lista cresce a cada porta nova, e
--    descobrir isso só na hora do insert já aconteceu (migration 0034).
-- ============================================================
do $$
declare
  t uuid := (select valor from _ids where chave='tenant');
  origens text[] := array['campanha','organico','landing','flow','painel'];
  o text;
  i int := 0;
begin
  foreach o in array origens loop
    i := i + 1;
    perform registrar_cliente(t, '5541' || lpad(i::text, 9, '9'), null, null, o, null, null);
  end loop;

  perform pg_temp.assert(
    (select count(*) from clientes where tenant_id = t and origem = any(origens)) >= array_length(origens,1),
    'toda origem prevista precisa ser aceita pelo constraint');
end;
$$;

do $$ begin raise notice 'OK: todas as asserções de 0033 passaram'; end; $$;

rollback;
