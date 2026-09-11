-- ============================================================
-- Clique rastreado no botão de URL (migration campanhas_clique_rastreado).
--
-- Cada asserção corresponde a um jeito real de o rastreio falhar em silêncio:
-- token repetido entre destinatários (todo mundo vira a mesma pessoa),
-- clicked_at sendo sobrescrito a cada reabertura do link (perde-se o momento
-- do primeiro clique), contador da campanha inflado por quem abriu duas vezes,
-- e token inexistente derrubando o redirect de um comprador.
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

insert into tenants (name, slug) values ('Tenant clique','tenant-clique');
insert into _ids select 'tenant', id from tenants where slug='tenant-clique';

insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token)
select valor, 'waba-teste', 'phone-teste', 'token-teste' from _ids where chave='tenant';
insert into _ids select 'credencial', id from whatsapp_cloud_credentials where waba_id='waba-teste';

insert into campaigns (tenant_id, credential_id, name, template_name, template_language, click_target_url)
select t.valor, c.valor, 'Campanha clique', 'tpl_teste', 'pt_BR', 'https://exemplo.invalido/checkout'
  from _ids t, _ids c where t.chave='tenant' and c.chave='credencial';
insert into _ids select 'campanha', id from campaigns where name='Campanha clique';

insert into campaign_recipients (campaign_id, tenant_id, phone_e164)
select c.valor, t.valor, x.fone
  from _ids c, _ids t, (values ('5541999999901'),('5541999999902'),('5541999999903')) as x(fone)
 where c.chave='campanha' and t.chave='tenant';

-- ============================================================
-- 1. Todo destinatário nasce com token, e nunca dois iguais
-- O token vem de DEFAULT no banco justamente porque há mais de um caminho de
-- criação de destinatário; se o default falhasse, o insert acima passaria e o
-- rastreio inteiro apontaria para a pessoa errada.
-- ============================================================
do $$
declare c uuid := (select valor from _ids where chave='campanha');
begin
  perform pg_temp.assert(
    (select count(*) from campaign_recipients where campaign_id = c and click_token is not null) = 3,
    'todo destinatário precisa nascer com click_token, sem a aplicação gerar nada');

  perform pg_temp.assert(
    (select count(distinct click_token) from campaign_recipients where campaign_id = c) = 3,
    'tokens repetidos fariam cliques de pessoas diferentes caírem na mesma linha');
end $$;

-- ============================================================
-- 2. O clique registra e devolve o destino
-- ============================================================
do $$
declare
  c     uuid := (select valor from _ids where chave='campanha');
  tok   text := (select click_token from campaign_recipients where phone_e164='5541999999901');
  saida text;
begin
  saida := register_campaign_click(tok);

  perform pg_temp.assert(
    saida = 'https://exemplo.invalido/checkout',
    'a função precisa devolver o destino: é com ele que o redirect responde ao comprador');

  perform pg_temp.assert(
    (select clicked_at is not null and click_count = 1
       from campaign_recipients where phone_e164='5541999999901'),
    'o primeiro clique precisa marcar clicked_at e contar 1');

  perform pg_temp.assert(
    (select clicked_count from campaigns where id = c) = 1,
    'o contador da campanha precisa acompanhar o clique');
end $$;

-- ============================================================
-- 3. Reabrir o link conta de novo, mas NÃO move clicked_at
-- clicked_at é o momento da intenção de compra — é o que datará o follow-up
-- de X minutos. Sobrescrever a cada reabertura empurraria o lembrete para
-- sempre, para quem mais mexeu no link.
-- ============================================================
do $$
declare
  c        uuid := (select valor from _ids where chave='campanha');
  tok      text := (select click_token from campaign_recipients where phone_e164='5541999999901');
  primeiro timestamptz := (select clicked_at from campaign_recipients where phone_e164='5541999999901');
begin
  perform register_campaign_click(tok);
  perform register_campaign_click(tok);

  perform pg_temp.assert(
    (select click_count from campaign_recipients where phone_e164='5541999999901') = 3,
    'cada reabertura do link precisa contar');

  perform pg_temp.assert(
    (select clicked_at from campaign_recipients where phone_e164='5541999999901') = primeiro,
    'clicked_at é o PRIMEIRO clique e não pode ser sobrescrito nas reaberturas');

  perform pg_temp.assert(
    (select clicked_count from campaigns where id = c) = 1,
    'clicked_count conta PESSOAS, não aberturas — três cliques de uma pessoa são um clicador');
end $$;

-- ============================================================
-- 4. Token inexistente devolve null, sem estourar
-- O redirect trata null mandando o cliente para a home. Se a função lançasse
-- exceção, um link adulterado viraria erro 500 na cara de um comprador.
-- ============================================================
do $$
declare saida text;
begin
  saida := register_campaign_click('token-que-nunca-existiu');
  perform pg_temp.assert(saida is null, 'token inexistente precisa devolver null, não estourar');
end $$;

-- ============================================================
-- 5. recompute_campaign_counters não regride clicked_count
-- O campaign-sender chama essa função a cada lote. Se ela não soubesse de
-- clicked_count, o contador voltaria a zero no meio do disparo.
-- ============================================================
do $$
declare c uuid := (select valor from _ids where chave='campanha');
begin
  perform recompute_campaign_counters(c);
  perform pg_temp.assert(
    (select clicked_count from campaigns where id = c) = 1,
    'recompute_campaign_counters precisa recalcular clicked_count, não zerá-lo');
end $$;

rollback;
