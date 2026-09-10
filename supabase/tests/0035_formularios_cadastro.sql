-- ============================================================
-- Formulários de cadastro embutíveis (migration 0035).
--
-- O que se testa aqui é o que a rota pública depende do banco: slug válido,
-- unicidade, e a ligação entre formulário e o consentimento que vai ser
-- registrado. O comportamento HTTP (honeypot, limite por IP, resposta única)
-- vive na rota e não tem infra de teste neste projeto — está declarado no
-- código.
--
-- COMO RODAR: banco LOCAL, `npm run test:db`.
-- ============================================================

begin;

create temporary table _ids (chave text primary key, valor uuid) on commit drop;

create or replace function pg_temp.assert(p_condicao boolean, p_mensagem text)
returns void language plpgsql as $$
begin
  if p_condicao is not true then raise exception 'FALHOU: %', p_mensagem; end if;
end;
$$;

insert into tenants (name, slug) values ('Tenant 0035','tenant-0035');
insert into _ids select 'tenant', id from tenants where slug='tenant-0035';

-- ============================================================
-- 1. Slug tem formato de URL
-- ============================================================
do $$
declare
  t uuid := (select valor from _ids where chave='tenant');
  invalidos text[] := array['Com Maiúscula', 'com espaço', 'acentuação', 'a', 'com/barra'];
  s text;
  falhou boolean;
begin
  foreach s in array invalidos loop
    falhou := false;
    begin
      insert into formularios_cadastro (tenant_id, slug, nome, texto_consentimento, versao_consentimento)
      values (t, s, 'x', 'texto', 'v1');
    exception when check_violation then falhou := true;
    end;
    perform pg_temp.assert(falhou, format('slug %L deveria ser recusado — ele vira URL pública', s));
  end loop;

  insert into formularios_cadastro (tenant_id, slug, nome, texto_consentimento, versao_consentimento)
  values (t, 'turne-2026', 'Landing turnê', 'Autorizo o contato.', 'turne-2026-v1');
  perform pg_temp.assert(
    (select count(*) from formularios_cadastro where slug='turne-2026') = 1,
    'slug válido deveria ser aceito');
end;
$$;

-- ============================================================
-- 2. Slug é único — ele é o endereço público
-- ============================================================
do $$
declare t uuid := (select valor from _ids where chave='tenant'); falhou boolean := false;
begin
  begin
    insert into formularios_cadastro (tenant_id, slug, nome, texto_consentimento, versao_consentimento)
    values (t, 'turne-2026', 'Outro', 'texto', 'v1');
  exception when unique_violation then falhou := true;
  end;
  perform pg_temp.assert(falhou, 'dois formulários não podem dividir o mesmo endereço público');
end;
$$;

-- ============================================================
-- 3. O consentimento gravado carrega a versão DO FORMULÁRIO
--    (é o que liga o aceite ao texto que a pessoa leu)
-- ============================================================
do $$
declare
  t uuid := (select valor from _ids where chave='tenant');
  versao text;
begin
  select versao_consentimento into versao from formularios_cadastro where slug='turne-2026';

  perform registrar_cliente(t, '(41) 98888-7777', 'Joana', 'joana@exemplo.invalido',
                            'landing', versao, 'formulario:turne-2026');

  perform pg_temp.assert(
    (select consentimento_versao = versao and consentimento_origem = 'formulario:turne-2026'
     from clientes where tenant_id = t and telefone = '5541988887777'),
    'o cadastro precisa registrar a versão do texto do formulário e por qual formulário entrou');

  perform pg_temp.assert(
    (select origem = 'landing' from clientes where tenant_id = t and telefone = '5541988887777'),
    'cadastro por formulário é origem landing');
end;
$$;

-- ============================================================
-- 4. Formulário desligado continua existindo (o embed pode estar num site
--    que não controlamos — o certo é responder "indisponível", não sumir)
-- ============================================================
do $$
declare t uuid := (select valor from _ids where chave='tenant');
begin
  update formularios_cadastro set ativo = false where slug = 'turne-2026';
  perform pg_temp.assert(
    (select count(*) from formularios_cadastro where slug='turne-2026' and deleted_at is null) = 1,
    'desligar não apaga: o slug precisa continuar respondendo, como indisponível');
end;
$$;

do $$ begin raise notice 'OK: todas as asserções de 0035 passaram'; end; $$;

rollback;
