-- ============================================================
-- Campanha que abre a central (migration campanha_abre_flow, Sprint C4).
--
-- Cada asserção corresponde a um jeito real de isso falhar EM SILÊNCIO — e
-- silêncio é a regra aqui: mandar um template de Flow sem token, ou com o
-- token apontando para a central de outro artista, é aceito pela Graph API
-- sem erro nenhum. O estrago só aparece do lado do fã.
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

insert into tenants (name, slug) values ('Tenant flow camp','tenant-flow-camp');
insert into _ids select 'tenant', id from tenants where slug='tenant-flow-camp';
insert into tenants (name, slug) values ('Tenant vizinho','tenant-flow-camp-vizinho');
insert into _ids select 'tenant_vizinho', id from tenants where slug='tenant-flow-camp-vizinho';

-- Dois números do MESMO tenant: é entre eles que acontece o erro de cadastro
-- que mais importa (campanha do artista A abrindo a central do artista B).
insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token)
select valor, 'waba-fc', 'phone-fc-a', 'tok' from _ids where chave='tenant';
insert into _ids select 'cred_a', id from whatsapp_cloud_credentials where phone_number_id='phone-fc-a';

insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token)
select valor, 'waba-fc', 'phone-fc-b', 'tok' from _ids where chave='tenant';
insert into _ids select 'cred_b', id from whatsapp_cloud_credentials where phone_number_id='phone-fc-b';

insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token)
select valor, 'waba-viz', 'phone-fc-viz', 'tok' from _ids where chave='tenant_vizinho';
insert into _ids select 'cred_viz', id from whatsapp_cloud_credentials where phone_number_id='phone-fc-viz';

insert into whatsapp_flows (tenant_id, cloud_credential_id, nome, tipo, artista, meta_flow_id)
select t.valor, c.valor, 'Central A', 'central', 'Artista A', 'meta-flow-a'
  from _ids t, _ids c where t.chave='tenant' and c.chave='cred_a';
insert into _ids select 'flow_a', id from whatsapp_flows where nome='Central A';

insert into whatsapp_flows (tenant_id, cloud_credential_id, nome, tipo, artista, meta_flow_id)
select t.valor, c.valor, 'Central B', 'central', 'Artista B', 'meta-flow-b'
  from _ids t, _ids c where t.chave='tenant' and c.chave='cred_b';
insert into _ids select 'flow_b', id from whatsapp_flows where nome='Central B';

insert into whatsapp_flows (tenant_id, cloud_credential_id, nome, tipo)
select t.valor, c.valor, 'FAQ por palavra-chave', 'keyword_automation'
  from _ids t, _ids c where t.chave='tenant' and c.chave='cred_a';
insert into _ids select 'flow_keyword', id from whatsapp_flows where nome='FAQ por palavra-chave';

insert into whatsapp_flows (tenant_id, cloud_credential_id, nome, tipo, ativo, meta_flow_id)
select t.valor, c.valor, 'Central do vizinho', 'central', true, 'meta-flow-viz'
  from _ids t, _ids c where t.chave='tenant_vizinho' and c.chave='cred_viz';
insert into _ids select 'flow_viz', id from whatsapp_flows where nome='Central do vizinho';

-- ============================================================
-- 1. Flow do MESMO número é aceito
-- ============================================================
insert into campaigns (tenant_id, credential_id, name, template_name, template_language, flow_id)
select t.valor, c.valor, 'Campanha com central', 'tpl_flow', 'pt_BR', f.valor
  from _ids t, _ids c, _ids f
 where t.chave='tenant' and c.chave='cred_a' and f.chave='flow_a';
insert into _ids select 'campanha', id from campaigns where name='Campanha com central';

-- ============================================================
-- 2. Flow de OUTRO número do mesmo tenant é recusado
-- O caso que a Graph API aceitaria: disparo pelo número do artista A
-- entregando a agenda do artista B para a base inteira.
-- ============================================================
do $$
declare ok boolean := false;
begin
  begin
    insert into campaigns (tenant_id, credential_id, name, template_name, template_language, flow_id)
    select t.valor, c.valor, 'Campanha cruzada', 'tpl_flow', 'pt_BR', f.valor
      from _ids t, _ids c, _ids f
     where t.chave='tenant' and c.chave='cred_a' and f.chave='flow_b';
  exception when others then ok := true;
  end;
  perform pg_temp.assert(ok, 'Flow de outro número precisa ser recusado na campanha');
end $$;

-- ============================================================
-- 3. Flow de outro TENANT é recusado
-- ============================================================
do $$
declare ok boolean := false;
begin
  begin
    insert into campaigns (tenant_id, credential_id, name, template_name, template_language, flow_id)
    select t.valor, c.valor, 'Campanha de outro tenant', 'tpl_flow', 'pt_BR', f.valor
      from _ids t, _ids c, _ids f
     where t.chave='tenant' and c.chave='cred_a' and f.chave='flow_viz';
  exception when others then ok := true;
  end;
  perform pg_temp.assert(ok, 'Flow de outro tenant precisa ser recusado na campanha');
end $$;

-- ============================================================
-- 4. Flow que não é abrível (keyword_automation) é recusado
-- Não tem Flow publicado na Meta; o botão não teria o que abrir.
-- ============================================================
do $$
declare ok boolean := false;
begin
  begin
    insert into campaigns (tenant_id, credential_id, name, template_name, template_language, flow_id)
    select t.valor, c.valor, 'Campanha keyword', 'tpl_flow', 'pt_BR', f.valor
      from _ids t, _ids c, _ids f
     where t.chave='tenant' and c.chave='cred_a' and f.chave='flow_keyword';
  exception when others then ok := true;
  end;
  perform pg_temp.assert(ok, 'Flow keyword_automation não pode ser destino de campanha');
end $$;

-- ============================================================
-- 5. Flow inativo é recusado
-- ============================================================
do $$
declare ok boolean := false;
begin
  update whatsapp_flows set ativo = false where id = (select valor from _ids where chave='flow_a');
  begin
    insert into campaigns (tenant_id, credential_id, name, template_name, template_language, flow_id)
    select t.valor, c.valor, 'Campanha com flow inativo', 'tpl_flow', 'pt_BR', f.valor
      from _ids t, _ids c, _ids f
     where t.chave='tenant' and c.chave='cred_a' and f.chave='flow_a';
  exception when others then ok := true;
  end;
  update whatsapp_flows set ativo = true where id = (select valor from _ids where chave='flow_a');
  perform pg_temp.assert(ok, 'Flow inativo não pode ser destino de campanha');
end $$;

-- ============================================================
-- 6. Trocar o número da campanha revalida o Flow
-- Sem `update of credential_id` no trigger, a validação seria burlável em
-- dois passos: cria certo, depois troca o número.
-- ============================================================
do $$
declare ok boolean := false;
begin
  begin
    update campaigns set credential_id = (select valor from _ids where chave='cred_b')
     where id = (select valor from _ids where chave='campanha');
  exception when others then ok := true;
  end;
  perform pg_temp.assert(ok, 'trocar o número da campanha precisa revalidar o Flow escolhido');
end $$;

-- ============================================================
-- 7. Campanha sem Flow continua funcionando
-- O trigger não pode atrapalhar o caminho antigo (campanha de texto/link).
-- ============================================================
insert into campaigns (tenant_id, credential_id, name, template_name, template_language)
select t.valor, c.valor, 'Campanha sem flow', 'tpl_simples', 'pt_BR'
  from _ids t, _ids c where t.chave='tenant' and c.chave='cred_a';

do $$
begin
  perform pg_temp.assert(
    (select flow_id is null from campaigns where name='Campanha sem flow'),
    'campanha sem botão de Flow precisa continuar sendo criada, com flow_id nulo');
end $$;

-- ============================================================
-- 8. flow_token: existe sempre e é único por destinatário
-- Token repetido faria dois fãs virarem a mesma pessoa dentro da central.
-- Vem do DEFAULT do banco justamente porque há mais de um caminho de
-- criação de destinatário.
-- ============================================================
insert into campaign_recipients (campaign_id, tenant_id, phone_e164)
select c.valor, t.valor, x.fone
  from _ids c, _ids t, (values ('5541999999801'),('5541999999802'),('5541999999803')) as x(fone)
 where c.chave='campanha' and t.chave='tenant';

do $$
declare c uuid := (select valor from _ids where chave='campanha');
begin
  perform pg_temp.assert(
    (select count(*) from campaign_recipients where campaign_id=c and flow_token is null) = 0,
    'flow_token precisa vir do default em todo destinatário');
  perform pg_temp.assert(
    (select count(distinct flow_token) from campaign_recipients where campaign_id=c) = 3,
    'flow_token precisa ser único por destinatário');
end $$;

-- ============================================================
-- 9. Apagar um Flow usado por campanha falha (on delete restrict)
-- Mesma armadilha já paga com palavra-chave: a campanha sai primeiro.
-- Sem isto, a campanha enviada perderia o registro de qual central o fã
-- abriu — e a sessão em flow_sessoes já teria ficado sem flow_id (set null).
-- ============================================================
do $$
declare ok boolean := false;
begin
  begin
    delete from whatsapp_flows where id = (select valor from _ids where chave='flow_a');
  exception when others then ok := true;
  end;
  perform pg_temp.assert(ok, 'apagar Flow usado por campanha precisa falhar, não apagar em cascata');
end $$;

rollback;
