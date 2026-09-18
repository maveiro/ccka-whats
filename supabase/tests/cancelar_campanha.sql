-- ============================================================
-- Cancelar campanha (migration cancelar_campanha).
--
-- O que estas asserções protegem: que cancelar ENCERRE de verdade (nem o
-- cron nem um "Retomar" acidental disparam o resto), que NÃO apague o
-- histórico do que já foi enviado — é o que explica a fatura — e que não
-- deixe reescrever o passado de campanha concluída.
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

insert into tenants (name, slug) values ('Tenant cancel','tenant-cancel');
insert into _ids select 'tenant', id from tenants where slug='tenant-cancel';

-- Um operador admin de verdade: `cancelar_campanha` confere my_tenant_id(),
-- que lê auth.uid() do JWT. Sem isso, o teste passaria por "campanha não
-- encontrada" em vez de exercitar a regra — falso verde.
insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'admin@cancel.teste');
insert into operators (id, tenant_id, email, role)
select '11111111-1111-4111-8111-111111111111', valor, 'admin@cancel.teste', 'admin'
  from _ids where chave='tenant';

create or replace function pg_temp.como_admin(p_sql text)
returns jsonb language plpgsql as $$
declare resultado jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into resultado;
  perform set_config('role', 'postgres', true);
  return resultado;
end;
$$;

insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token)
select valor, 'waba-c', 'phone-c', 'tok' from _ids where chave='tenant';
insert into _ids select 'cred', id from whatsapp_cloud_credentials where phone_number_id='phone-c';

insert into campaigns (tenant_id, credential_id, name, template_name, template_language, status)
select t.valor, c.valor, 'Campanha pausada', 'tpl', 'pt_BR', 'paused'
  from _ids t, _ids c where t.chave='tenant' and c.chave='cred';
insert into _ids select 'campanha', id from campaigns where name='Campanha pausada';

-- 4 já enviados (2 entregues, 1 lido), 1 falhou, 6 ainda esperando.
insert into campaign_recipients (campaign_id, tenant_id, phone_e164, status)
select c.valor, t.valor, '55419999990' || g, s.st
  from _ids c, _ids t,
       (values (1,'sent'),(2,'delivered'),(3,'delivered'),(4,'read'),(5,'failed'),
               (6,'pending'),(7,'pending'),(8,'pending'),(9,'pending'),(10,'pending'),(11,'sending')) as s(g, st)
 where c.chave='campanha' and t.chave='tenant';

-- ============================================================
-- 1. Cancelar encerra e marca quem não recebeu
-- ============================================================
do $$
declare r jsonb; c uuid := (select valor from _ids where chave='campanha');
begin
  r := pg_temp.como_admin(format('select cancelar_campanha(%L)', c));

  perform pg_temp.assert((r->>'cancelados')::int = 6,
    format('6 destinatários (5 pending + 1 sending) deveriam ser cancelados, veio %s', r->>'cancelados'));
  perform pg_temp.assert(r->>'statusAnterior' = 'paused', 'o status anterior deveria ser registrado');
  perform pg_temp.assert(
    (select status from campaigns where id=c) = 'cancelled',
    'a campanha precisa ficar cancelled');
  perform pg_temp.assert(
    (select count(*) from campaign_recipients where campaign_id=c and status='cancelled') = 6,
    'os 6 que ainda não receberam precisam virar cancelled');
  perform pg_temp.assert(
    (select count(*) from events_log where event_type='campaign_cancelled') = 1,
    'o cancelamento precisa deixar rastro em events_log');
end $$;

-- ============================================================
-- 2. O histórico do que JÁ foi enviado sobrevive
-- É ele que explica a fatura: cancelar não pode apagar custo nem entrega.
-- ============================================================
do $$
declare c uuid := (select valor from _ids where chave='campanha');
begin
  perform pg_temp.assert(
    (select sent_count from campaigns where id=c) = 4,
    'os 4 enviados continuam contando (sent + delivered + read)');
  perform pg_temp.assert(
    (select delivered_count from campaigns where id=c) = 3,
    'as 3 entregas continuam contando');
  perform pg_temp.assert(
    (select failed_count from campaigns where id=c) = 1,
    'a falha continua contando');
  perform pg_temp.assert(
    (select count(*) from campaign_recipients where campaign_id=c) = 11,
    'nenhuma linha de destinatário pode ser apagada');
end $$;

-- ============================================================
-- 3. Cancelado não volta a disparar
-- Nem pelo claim do cron (que só pega `pending`), nem por um "Retomar"
-- acidental — a rota de fire só aceita ready/paused.
-- ============================================================
do $$
declare lote int;
begin
  update campaigns set status='sending' where id=(select valor from _ids where chave='campanha');
  select count(*) into lote from claim_campaign_recipients(
    (select valor from _ids where chave='campanha'), 50);
  perform pg_temp.assert(lote = 0, 'nenhum destinatário cancelado pode ser reivindicado pelo cron');
  update campaigns set status='cancelled' where id=(select valor from _ids where chave='campanha');
end $$;

-- ============================================================
-- 4. Campanha concluída não pode ser cancelada
-- Cancelar o que já terminou seria reescrever história.
-- ============================================================
do $$
declare ok boolean := false;
begin
  insert into campaigns (tenant_id, credential_id, name, template_name, template_language, status)
  select t.valor, c.valor, 'Campanha concluída', 'tpl', 'pt_BR', 'completed'
    from _ids t, _ids c where t.chave='tenant' and c.chave='cred';

  begin
    perform pg_temp.como_admin(format('select cancelar_campanha(%L)',
      (select id from campaigns where name='Campanha concluída')));
  exception when others then ok := true;
  end;
  perform pg_temp.assert(ok, 'campanha concluída não pode ser cancelada');
end $$;

-- ============================================================
-- 5. Campanha de OUTRO tenant não pode ser cancelada
-- A função é security definer: sem a checagem de my_tenant_id(), um admin
-- encerraria a campanha de outro cliente com um id adivinhado.
-- ============================================================
do $$
declare ok boolean := false; outra uuid;
begin
  insert into tenants (name, slug) values ('Tenant vizinho','tenant-cancel-viz');
  insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token)
  select id, 'waba-v', 'phone-v', 'tok' from tenants where slug='tenant-cancel-viz';
  insert into campaigns (tenant_id, credential_id, name, template_name, template_language, status)
  select t.id, c.id, 'Campanha do vizinho', 'tpl', 'pt_BR', 'paused'
    from tenants t join whatsapp_cloud_credentials c on c.tenant_id = t.id
   where t.slug='tenant-cancel-viz'
  returning id into outra;

  begin
    perform pg_temp.como_admin(format('select cancelar_campanha(%L)', outra));
  exception when others then ok := true;
  end;
  perform pg_temp.assert(ok, 'campanha de outro tenant não pode ser cancelada');
  perform pg_temp.assert(
    (select status from campaigns where id = outra) = 'paused',
    'e o status dela não pode mudar');
end $$;

rollback;
