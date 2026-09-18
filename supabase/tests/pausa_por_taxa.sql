-- taxa_de_falha_recente: a medida que decide pausar uma campanha por
-- proteção de qualidade (migration pausa_por_taxa).
--
-- O que se testa aqui é justamente o que a regra antiga não distinguia:
-- recusa isolada (teto individual de marketing) contra parede de verdade.
begin;

create or replace function pg_temp.assert(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if not cond then raise exception 'FALHOU: %', msg; end if;
end $$;

create temporary table _ids (chave text primary key, valor uuid);

insert into tenants (name, slug) values ('Tenant pausa', 'tenant-pausa');
insert into _ids select 'tenant', id from tenants where slug = 'tenant-pausa';

insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token)
select valor, 'waba-p', 'phone-p', 'tok' from _ids where chave = 'tenant';

insert into campaigns (tenant_id, credential_id, name, template_name, template_language, status)
select t.valor, c.id, 'Campanha da taxa', 'tpl', 'pt_BR', 'sending'
  from _ids t cross join whatsapp_cloud_credentials c
 where t.chave = 'tenant' and c.phone_number_id = 'phone-p';
insert into _ids select 'campanha', id from campaigns where name = 'Campanha da taxa';

-- ============================================================
-- 1. Campanha saudável com recusas isoladas NÃO cruza o limiar
-- É o caso real de 18/09/2026: 4 falhas em 100 processados, 92% de entrega,
-- e a regra antiga parou tudo na primeira.
-- ============================================================
do $$
declare c uuid := (select valor from _ids where chave = 'campanha');
        t uuid := (select valor from _ids where chave = 'tenant');
        r jsonb;
begin
  -- `sent_at` explícito: dentro de uma transação, `now()` é o mesmo para
  -- todas as linhas, e sem ordem definida a janela dos 50 mais recentes
  -- viraria sorteio.
  insert into campaign_recipients (tenant_id, campaign_id, phone_e164, status, sent_at)
  select t, c, '55419' || lpad(i::text, 7, '0'),
         case when i <= 4 then 'failed' else 'delivered' end,
         now() - (i * interval '1 minute')
    from generate_series(1, 100) i;

  r := taxa_de_falha_recente(c, 50);
  perform pg_temp.assert((r->>'processados')::int = 50, 'a janela deveria olhar 50 envios');
  perform pg_temp.assert(
    (r->>'falhas')::int < 10 or (r->>'taxa')::numeric < 0.2,
    format('4%% de falha não pode acionar a pausa: %s', r));
end $$;

-- ============================================================
-- 2. Parede de verdade cruza o limiar
-- O caso de 07/08/2026: 76-92% de falha depois do primeiro sinal.
-- ============================================================
do $$
declare c uuid := (select valor from _ids where chave = 'campanha');
        t uuid := (select valor from _ids where chave = 'tenant');
        r jsonb;
begin
  insert into campaign_recipients (tenant_id, campaign_id, phone_e164, status, sent_at)
  select t, c, '55429' || lpad(i::text, 7, '0'), 'failed', now() + (i * interval '1 minute')
    from generate_series(1, 40) i;

  r := taxa_de_falha_recente(c, 50);
  perform pg_temp.assert((r->>'falhas')::int >= 10, format('deveria contar as falhas recentes: %s', r));
  perform pg_temp.assert((r->>'taxa')::numeric >= 0.2, format('a taxa deveria cruzar 20%%: %s', r));
end $$;

-- ============================================================
-- 3. Só conta quem JÁ foi processado
-- Quem está pending não é sinal de qualidade nenhum — se entrasse na conta,
-- uma campanha grande nunca pausaria (o denominador seria a lista inteira).
-- ============================================================
do $$
declare c uuid := (select valor from _ids where chave = 'campanha');
        t uuid := (select valor from _ids where chave = 'tenant');
        r jsonb;
begin
  insert into campaign_recipients (tenant_id, campaign_id, phone_e164, status, created_at)
  select t, c, '55439' || lpad(i::text, 7, '0'), 'pending', now() + interval '1 day'
    from generate_series(1, 500) i;

  r := taxa_de_falha_recente(c, 50);
  perform pg_temp.assert((r->>'processados')::int = 50,
    format('destinatário pendente não entra na medida: %s', r));
end $$;

-- ============================================================
-- 4. Campanha sem envio nenhum não divide por zero
-- ============================================================
do $$
declare nova uuid; r jsonb;
begin
  insert into campaigns (tenant_id, credential_id, name, template_name, template_language, status)
  select t.valor, c.id, 'Campanha vazia', 'tpl', 'pt_BR', 'sending'
    from _ids t cross join whatsapp_cloud_credentials c
   where t.chave = 'tenant' and c.phone_number_id = 'phone-p'
  returning id into nova;

  r := taxa_de_falha_recente(nova, 50);
  perform pg_temp.assert((r->>'processados')::int = 0 and (r->>'taxa')::numeric = 0,
    format('campanha sem envio deveria medir zero, veio %s', r));
end $$;

select 'pausa_por_taxa: ok' as resultado;
rollback;
