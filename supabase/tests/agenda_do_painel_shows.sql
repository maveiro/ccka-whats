-- ============================================================
-- Sync da agenda a partir do painel-shows (migration agenda_do_painel_shows).
--
-- Cada asserção é um jeito real de a agenda do fã ficar errada sem erro
-- nenhum: show cancelado que continua na lista, linha digitada à mão
-- atropelada pelo sync, agenda de um artista vazando para a central de outro,
-- e allowlist vazia que devolve agenda em branco.
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

insert into tenants (name, slug) values ('Tenant agenda','tenant-agenda-sync');
insert into _ids select 'tenant', id from tenants where slug='tenant-agenda-sync';

-- Número do IB (com artista definido) e número da Dra. (sem artista).
insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token, artista)
select valor, 'waba-ag', 'phone-ag-ib', 'tok', 'Índio Behn - Dra. Rosangêla' from _ids where chave='tenant';
insert into _ids select 'cred_ib', id from whatsapp_cloud_credentials where phone_number_id='phone-ag-ib';

insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token)
select valor, 'waba-ag', 'phone-ag-sem', 'tok' from _ids where chave='tenant';
insert into _ids select 'cred_sem_artista', id from whatsapp_cloud_credentials where phone_number_id='phone-ag-sem';

insert into whatsapp_cloud_credentials (tenant_id, waba_id, phone_number_id, access_token, artista)
select valor, 'waba-ag', 'phone-ag-fp', 'tok', 'Fábio Porchat' from _ids where chave='tenant';
insert into _ids select 'cred_fp', id from whatsapp_cloud_credentials where phone_number_id='phone-ag-fp';

insert into agenda_filtros (tenant_id, cloud_credential_id, artista_origem)
select t.valor, c.valor, 'IB' from _ids t, _ids c where t.chave='tenant' and c.chave='cred_ib';
insert into _ids select 'filtro_ib', id from agenda_filtros where artista_origem='IB';

insert into agenda_filtros (tenant_id, cloud_credential_id, artista_origem)
select t.valor, c.valor, 'FP' from _ids t, _ids c where t.chave='tenant' and c.chave='cred_fp';
insert into _ids select 'filtro_fp', id from agenda_filtros where artista_origem='FP';

-- Linha DIGITADA À MÃO: sem origem, sem filtro. O sync nunca pode tocá-la.
insert into agenda_shows_sync (tenant_id, artista, cidade, teatro, data_show, status_venda)
select valor, 'Índio Behn - Dra. Rosangêla', 'Cidade Manual', 'Teatro Manual',
       now() + interval '40 days', 'à venda'
  from _ids where chave='tenant';

-- ============================================================
-- 1. Primeira rodada: grava o que veio
-- ============================================================
do $$
declare r jsonb;
begin
  r := sincronizar_agenda_shows(
    (select valor from _ids where chave='filtro_ib'),
    '[{"show_id_origem":"m-1","cidade":"Curitiba/PR","teatro":"Teatro Bom Jesus","data_hora":"2026-09-20T21:00:00Z","status_venda":"à venda","link_compra":"https://exemplo.invalido/1"},
      {"show_id_origem":"m-2","cidade":"Curitiba/PR","teatro":"Teatro Bom Jesus","data_hora":"2026-09-20T23:15:00Z","status_venda":"à venda","link_compra":"https://exemplo.invalido/2"},
      {"show_id_origem":"m-3","cidade":"Uberaba/MG","teatro":"Teatro SESIMINAS","data_hora":"2026-09-27T21:00:00Z","status_venda":"esgotado","link_compra":"https://exemplo.invalido/3"}]'::jsonb);

  perform pg_temp.assert((r->>'inseridos')::int = 3, format('deveria inserir 3, veio %s', r->>'inseridos'));
  perform pg_temp.assert((r->>'removidos')::int = 0, 'nada a remover na primeira rodada');
  perform pg_temp.assert(
    r->>'artista' = 'Índio Behn - Dra. Rosangêla',
    'o artista gravado precisa vir da CREDENCIAL do número, não do rótulo do board');
end $$;

do $$
begin
  -- Duas sessões no mesmo dia e teatro são dois shows distintos para o fã:
  -- é o horário que as separa, e é por isso que a hora não pode ser perdida.
  perform pg_temp.assert(
    (select count(*) from agenda_shows_sync where filtro_id = (select valor from _ids where chave='filtro_ib')) = 3,
    'as 3 linhas do sync deveriam existir');
  perform pg_temp.assert(
    (select count(distinct data_show) from agenda_shows_sync
      where filtro_id = (select valor from _ids where chave='filtro_ib')) = 3,
    'as duas sessões do mesmo dia precisam ter horários distintos');
  perform pg_temp.assert(
    (select artista from agenda_shows_sync where show_id_origem='m-1') = 'Índio Behn - Dra. Rosangêla',
    'a linha gravada tem que casar com o artista que o endpoint do Flow filtra');
end $$;

-- ============================================================
-- 2. Segunda rodada idempotente, e show que saiu do board SAI da tabela
-- Show cancelado/adiado deixa de ser elegível; se continuasse aqui, o fã
-- continuaria vendo (a lista do Flow não filtra status).
-- ============================================================
do $$
declare r jsonb;
begin
  r := sincronizar_agenda_shows(
    (select valor from _ids where chave='filtro_ib'),
    '[{"show_id_origem":"m-1","cidade":"Curitiba/PR","teatro":"Teatro Bom Jesus","data_hora":"2026-09-20T21:00:00Z","status_venda":"esgotado","link_compra":"https://exemplo.invalido/1"},
      {"show_id_origem":"m-2","cidade":"Curitiba/PR","teatro":"Teatro Bom Jesus","data_hora":"2026-09-20T23:15:00Z","status_venda":"à venda","link_compra":"https://exemplo.invalido/2"}]'::jsonb);

  perform pg_temp.assert((r->>'inseridos')::int = 0, format('nada novo, veio %s', r->>'inseridos'));
  perform pg_temp.assert((r->>'atualizados')::int = 2, format('deveria atualizar 2, veio %s', r->>'atualizados'));
  perform pg_temp.assert((r->>'removidos')::int = 1, format('m-3 deveria sair, removidos=%s', r->>'removidos'));
  perform pg_temp.assert(
    not exists (select 1 from agenda_shows_sync where show_id_origem='m-3'),
    'show que não veio na rodada não pode continuar visível ao fã');
  perform pg_temp.assert(
    (select status_venda from agenda_shows_sync where show_id_origem='m-1') = 'esgotado',
    'mudança de status precisa chegar na linha');
end $$;

-- ============================================================
-- 3. A linha digitada à mão continua intacta
-- ============================================================
do $$
begin
  perform pg_temp.assert(
    (select count(*) from agenda_shows_sync
      where teatro='Teatro Manual' and show_id_origem is null and filtro_id is null) = 1,
    'o sync não pode apagar nem adotar linha manual');
end $$;

-- ============================================================
-- 4. Agenda de outro artista não é tocada
-- A reconciliação é escopada ao filtro, não ao tenant.
-- ============================================================
do $$
declare r jsonb;
begin
  r := sincronizar_agenda_shows(
    (select valor from _ids where chave='filtro_fp'),
    '[{"show_id_origem":"m-9","cidade":"Osasco/SP","teatro":"Teatro Aspro","data_hora":"2026-10-01T23:00:00Z","status_venda":"à venda"}]'::jsonb);

  perform pg_temp.assert((r->>'inseridos')::int = 1, 'FP deveria receber seu show');
  perform pg_temp.assert((r->>'removidos')::int = 0, 'sincronizar FP não pode remover nada do IB');
  perform pg_temp.assert(
    (select count(*) from agenda_shows_sync where filtro_id = (select valor from _ids where chave='filtro_ib')) = 2,
    'as linhas do IB seguem lá depois de sincronizar o FP');
  perform pg_temp.assert(
    (select artista from agenda_shows_sync where show_id_origem='m-9') = 'Fábio Porchat',
    'cada agenda grava o artista do seu próprio número');
end $$;

-- ============================================================
-- 5. Número sem artista é recusado
-- Sem artista na credencial, o endpoint do Flow serve a agenda INTEIRA do
-- tenant — gravar aqui vazaria a agenda de um artista na central de outro.
-- ============================================================
do $$
declare ok boolean := false;
begin
  insert into agenda_filtros (tenant_id, cloud_credential_id, artista_origem)
  select t.valor, c.valor, 'CD' from _ids t, _ids c where t.chave='tenant' and c.chave='cred_sem_artista';

  begin
    perform sincronizar_agenda_shows(
      (select id from agenda_filtros where artista_origem='CD'),
      '[{"show_id_origem":"m-77","cidade":"X","teatro":"Y","data_hora":"2026-11-01T23:00:00Z"}]'::jsonb);
  exception when others then ok := true;
  end;
  perform pg_temp.assert(ok, 'agenda de número sem artista definido precisa ser recusada');
  perform pg_temp.assert(
    not exists (select 1 from agenda_shows_sync where show_id_origem='m-77'),
    'nada pode ser gravado quando o número não tem artista');
end $$;

-- ============================================================
-- 6. Lista vazia zera a agenda DAQUELE filtro (e só dele)
-- Comportamento deliberado: artista sem nenhum show elegível tem agenda
-- vazia. Por isso o agenda-sync nunca chama esta função quando a API falha —
-- falha de rede não pode virar "nenhum show".
-- ============================================================
do $$
declare r jsonb;
begin
  r := sincronizar_agenda_shows((select valor from _ids where chave='filtro_fp'), '[]'::jsonb);
  perform pg_temp.assert((r->>'removidos')::int = 1, 'lista vazia remove o que havia daquele filtro');
  perform pg_temp.assert(
    (select count(*) from agenda_shows_sync where filtro_id = (select valor from _ids where chave='filtro_ib')) = 2,
    'zerar a agenda do FP não pode encostar na do IB');
  perform pg_temp.assert(
    (select count(*) from agenda_shows_sync where show_id_origem is null) = 1,
    'zerar uma agenda não pode encostar na linha manual');
end $$;

-- ============================================================
-- 7. Resumo da rodada fica gravado no filtro
-- É o que a tela mostra como "última sincronização" — sem isso, "a agenda
-- não atualizou" não tem como ser investigado.
-- ============================================================
do $$
begin
  perform pg_temp.assert(
    (select ultima_sync_em is not null from agenda_filtros where id = (select valor from _ids where chave='filtro_ib')),
    'ultima_sync_em deveria estar preenchida');
  perform pg_temp.assert(
    (select (ultima_sync_resumo->>'atualizados')::int from agenda_filtros
      where id = (select valor from _ids where chave='filtro_ib')) = 2,
    'o resumo da última rodada do IB deveria registrar 2 atualizados');
end $$;

-- ============================================================
-- 7b. Despublicar sobrevive ao sync
-- É o ponto inteiro da coluna `publicado`: o show continua elegível no board,
-- então toda rodada de hora em hora o encontra e faz upsert. Se `publicado`
-- entrasse no `do update set`, a despublicação duraria até o próximo tick e
-- voltaria sozinha, sem ninguém saber por quê.
-- ============================================================
do $$
declare r jsonb;
begin
  perform pg_temp.assert(
    (select bool_and(publicado) from agenda_shows_sync
      where filtro_id = (select valor from _ids where chave='filtro_ib')),
    'show sincronizado nasce publicado (é o comportamento que já existia)');

  update agenda_shows_sync set publicado = false where show_id_origem = 'm-1';

  r := sincronizar_agenda_shows(
    (select valor from _ids where chave='filtro_ib'),
    '[{"show_id_origem":"m-1","cidade":"Curitiba/PR","teatro":"Teatro Bom Jesus","data_hora":"2026-09-20T21:00:00Z","status_venda":"à venda","link_compra":"https://exemplo.invalido/1"},
      {"show_id_origem":"m-2","cidade":"Curitiba/PR","teatro":"Teatro Bom Jesus","data_hora":"2026-09-20T23:15:00Z","status_venda":"à venda","link_compra":"https://exemplo.invalido/2"}]'::jsonb);

  perform pg_temp.assert(
    (select publicado is false from agenda_shows_sync where show_id_origem='m-1'),
    'o sync NÃO pode republicar o que foi despublicado à mão');
  perform pg_temp.assert(
    (select publicado from agenda_shows_sync where show_id_origem='m-2'),
    'os outros continuam publicados');
  perform pg_temp.assert(
    (r->>'despublicados')::int = 1,
    format('o resumo da rodada deveria contar 1 despublicado, veio %s', r->>'despublicados'));
  perform pg_temp.assert(
    (select (ultima_sync_resumo->>'despublicados')::int from agenda_filtros
      where id = (select valor from _ids where chave='filtro_ib')) = 1,
    'a contagem de despublicados fica visível no resumo do filtro');
end $$;

-- ============================================================
-- 7c. Show despublicado que sai do board sai da tabela
-- Despublicar não é arquivar: se deixou de ser elegível, a linha vai embora
-- como qualquer outra — senão a tabela acumularia show invisível para sempre.
-- ============================================================
do $$
declare r jsonb;
begin
  r := sincronizar_agenda_shows(
    (select valor from _ids where chave='filtro_ib'),
    '[{"show_id_origem":"m-2","cidade":"Curitiba/PR","teatro":"Teatro Bom Jesus","data_hora":"2026-09-20T23:15:00Z","status_venda":"à venda"}]'::jsonb);

  perform pg_temp.assert(
    not exists (select 1 from agenda_shows_sync where show_id_origem='m-1'),
    'show despublicado que saiu do board precisa sair da tabela também');
  perform pg_temp.assert((r->>'removidos')::int = 1, 'e ser contado como removido');
end $$;

-- ============================================================
-- 8. Allowlist vazia é recusada pelo banco
-- Agenda com zero status permitidos devolve lista vazia sem erro nenhum.
-- ============================================================
do $$
declare ok boolean := false;
begin
  begin
    update agenda_filtros set status_permitidos = array[]::text[]
     where id = (select valor from _ids where chave='filtro_ib');
  exception when others then ok := true;
  end;
  perform pg_temp.assert(ok, 'allowlist de status vazia precisa ser recusada');
end $$;

-- ============================================================
-- 9. Duas agendas do mesmo tenant para o mesmo artista do board
-- Brigariam pela mesma linha de agenda_shows_sync (o índice único de origem é
-- por tenant), e cada rodada desfaria a anterior.
-- ============================================================
do $$
declare ok boolean := false;
begin
  begin
    insert into agenda_filtros (tenant_id, cloud_credential_id, artista_origem)
    select t.valor, c.valor, 'IB' from _ids t, _ids c where t.chave='tenant' and c.chave='cred_sem_artista';
  exception when others then ok := true;
  end;
  perform pg_temp.assert(ok, 'duas agendas para o mesmo artista de origem precisam ser recusadas');
end $$;

-- ============================================================
-- 10. Credencial deny-all: a conexão com o painel-shows não é legível por RLS
-- ============================================================
insert into agenda_conexoes (tenant_id, base_url, token)
select valor, 'https://painel.invalido', 'segredo' from _ids where chave='tenant';

do $$
declare n int;
begin
  set local role authenticated;
  select count(*) into n from agenda_conexoes;
  reset role;
  perform pg_temp.assert(n = 0, 'token do painel-shows não pode ser legível por client autenticado');
end $$;

rollback;
