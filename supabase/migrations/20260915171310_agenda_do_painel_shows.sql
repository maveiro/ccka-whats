-- ============================================================
-- Migration: 20260915171310_agenda_do_painel_shows.sql
-- Fase 3 do PRD docs/prd/prd-agenda-via-painel-shows.md: a agenda da central
-- deixa de ser digitada e passa a espelhar o board do Monday, pela ponte com
-- o painel-shows (ADR 0006 do plauz-core: registro de fonte + API interna,
-- sincroniza-e-serve; nunca credencial copiada nem schema cruzado).
--
-- Esta migration é só o lado do whats: conexão, filtro por agenda e a função
-- que grava. Ler o Monday continua sendo exclusividade do painel-shows.
-- ============================================================

-- ============================================================
-- CONEXÃO COM O PAINEL-SHOWS (uma por tenant)
--
-- RLS deny-all, mesmo desenho de whatsapp_cloud_credentials (0019) e
-- internal_secrets (0023): é token de API com poder de leitura sobre a
-- operação inteira de shows. Não vai para integrations.config, que é texto
-- plano lido por RLS de admin e já é dívida datada no CLAUDE.md.
-- ============================================================
create table agenda_conexoes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null unique references tenants(id) on delete cascade,
  base_url    text not null,
  token       text not null,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table agenda_conexoes enable row level security;
create policy "deny_all" on agenda_conexoes for all using (false) with check (false);

create trigger agenda_conexoes_set_updated_at
  before update on agenda_conexoes
  for each row execute function set_updated_at();

-- ============================================================
-- FILTRO POR AGENDA
--
-- Uma linha = uma agenda = "este número se alimenta do board filtrando
-- assim". Desenho pedido pelo fundador em 15/09/2026, no lugar de um mapa
-- global de artistas.
--
-- O filtro é guardado por RÓTULO (`Vendendo`, `IB`), nunca pelo índice que a
-- API do Monday exige em query_params: índice depende da ordem em que os
-- rótulos foram criados no board, e criar um rótulo novo lá reordenaria o
-- significado do número gravado aqui. Como o painel-shows importa o board
-- inteiro, o filtro é aplicado sobre a cópia local, onde rótulo é rótulo.
--
-- O nome do artista NA CENTRAL não está aqui de propósito: sai de
-- whatsapp_cloud_credentials.artista do próprio número, que é o mesmo valor
-- que o endpoint do Flow usa para filtrar a lista do fã. Repetir aqui abriria
-- a chance de um typo que produz agenda vazia sem erro nenhum.
-- ============================================================
create table agenda_filtros (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  cloud_credential_id  uuid not null unique references whatsapp_cloud_credentials(id) on delete cascade,
  -- Rótulo da coluna "Artista" no board (ex: 'IB'). Obrigatório: agenda sem
  -- artista de origem puxaria o board inteiro para a central de um artista.
  artista_origem       text not null,
  -- Allowlist de "Status". Default = o que significa "o fã pode ver".
  status_permitidos    text[] not null default array['Vendendo', 'Esgotado'],
  -- Rótulos de "Espetáculo"; null = todos. Para central de um espetáculo só.
  espetaculos          text[],
  -- Teto de horizonte em dias; null = todo o futuro.
  janela_dias          int check (janela_dias is null or janela_dias > 0),
  ativo                boolean not null default true,
  ultima_sync_em       timestamptz,
  ultima_sync_resumo   jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Allowlist vazia = agenda vazia sem nenhum erro. Barrar no banco.
  constraint status_permitidos_nao_vazio check (cardinality(status_permitidos) > 0),
  constraint espetaculos_nao_vazio check (espetaculos is null or cardinality(espetaculos) > 0),
  -- Dois números do mesmo tenant apontando para o mesmo artista do board
  -- brigariam pela mesma linha de agenda_shows_sync (o índice único de
  -- show_id_origem é por tenant, não por agenda) — e cada rodada de sync
  -- desfaria a anterior.
  unique (tenant_id, artista_origem)
);

create trigger agenda_filtros_set_updated_at
  before update on agenda_filtros
  for each row execute function set_updated_at();

alter table agenda_filtros enable row level security;

-- Mesmo modelo de acesso dos Flows (0025): quem não enxerga o número não
-- enxerga nem edita a agenda dele.
create policy "acesso_por_numero" on agenda_filtros for all using (
  tenant_id = my_tenant_id()
  and my_role() in ('admin', 'operator')
  and has_cloud_credential_access(cloud_credential_id)
);

-- ============================================================
-- PROCEDÊNCIA NA AGENDA
--
-- Serve para dois fins: a tela mostrar o que veio do Monday e o que foi
-- digitado, e a reconciliação do sync apagar SÓ o que ela mesma trouxe.
-- Reconciliar por artista seria quase igual, mas erraria no dia em que duas
-- agendas dividissem o mesmo nome de artista na central.
-- ============================================================
alter table agenda_shows_sync
  add column filtro_id uuid references agenda_filtros(id) on delete set null;

create index idx_agenda_shows_sync_filtro on agenda_shows_sync (filtro_id)
  where filtro_id is not null;

-- ============================================================
-- GRAVAÇÃO DO SYNC
--
-- Uma função, e não upsert pelo client, por três motivos:
--
-- 1. O índice único de origem é PARCIAL (`where show_id_origem is not null`,
--    migration 0025). O Postgres só infere índice parcial em ON CONFLICT se o
--    predicado vier no statement, e o upsert do PostgREST/supabase-js não tem
--    como expressá-lo — a chamada falharia com "no unique or exclusion
--    constraint matching the ON CONFLICT specification".
-- 2. Gravar e reconciliar precisa ser atômico: entre o upsert e o delete, um
--    fã poderia abrir a central e ver a agenda pela metade.
-- 3. Um round-trip por rodada em vez de um por show (regra 11).
--
-- O que ela NÃO faz: decidir o que entra. O filtro (status, espetáculo,
-- janela) é aplicado no agenda-sync, onde é testável com o board de verdade.
-- Aqui chega a lista já elegível.
--
-- `p_linhas`: array de objetos com show_id_origem, cidade, teatro, data_hora,
-- status_venda, link_compra.
-- ============================================================
create or replace function sincronizar_agenda_shows(p_filtro_id uuid, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filtro      record;
  v_artista     text;
  v_origens     text[];
  v_existentes  int;
  v_gravados    int;
  v_removidos   int;
begin
  select f.*, c.artista as artista_credencial
    into v_filtro
    from agenda_filtros f
    join whatsapp_cloud_credentials c on c.id = f.cloud_credential_id
   where f.id = p_filtro_id;

  if not found then
    raise exception 'agenda_filtros % não existe', p_filtro_id;
  end if;

  v_artista := nullif(btrim(coalesce(v_filtro.artista_credencial, '')), '');

  -- Sem artista no número, o endpoint do Flow serve a agenda INTEIRA do
  -- tenant (ver responderAgenda em flow-endpoint): gravar shows aqui
  -- vazaria a agenda de um artista para a central de outro. Recusar é o
  -- único desfecho seguro, e a mensagem diz o que fazer.
  if v_artista is null then
    raise exception 'o número desta agenda não tem artista definido — defina em Números antes de sincronizar';
  end if;

  select coalesce(array_agg(l->>'show_id_origem'), array[]::text[])
    into v_origens
    from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) as l
   where nullif(btrim(coalesce(l->>'show_id_origem', '')), '') is not null;

  select count(*) into v_existentes
    from agenda_shows_sync
   where tenant_id = v_filtro.tenant_id
     and show_id_origem = any(v_origens);

  with entrada as (
    select
      nullif(btrim(l->>'show_id_origem'), '')            as show_id_origem,
      nullif(btrim(coalesce(l->>'cidade', '')), '')      as cidade,
      nullif(btrim(coalesce(l->>'teatro', '')), '')      as teatro,
      (nullif(l->>'data_hora', ''))::timestamptz         as data_show,
      nullif(btrim(coalesce(l->>'status_venda', '')), '') as status_venda,
      nullif(btrim(coalesce(l->>'link_compra', '')), '')  as link_compra
    from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) as l
  )
  insert into agenda_shows_sync
    (tenant_id, filtro_id, show_id_origem, artista, cidade, teatro, data_show, status_venda, link_compra)
  select v_filtro.tenant_id, p_filtro_id, e.show_id_origem, v_artista,
         e.cidade, e.teatro, e.data_show, e.status_venda, e.link_compra
    from entrada e
   where e.show_id_origem is not null
  on conflict (tenant_id, show_id_origem) where show_id_origem is not null
  do update set
    filtro_id    = excluded.filtro_id,
    artista      = excluded.artista,
    cidade       = excluded.cidade,
    teatro       = excluded.teatro,
    data_show    = excluded.data_show,
    status_venda = excluded.status_venda,
    link_compra  = excluded.link_compra,
    updated_at   = now();

  get diagnostics v_gravados = row_count;

  -- Show que saiu de 'Vendendo' (cancelou, adiou, virou bloqueio) tem que
  -- SAIR da tabela: a lista do fã no Flow filtra só data futura e artista,
  -- não status (ver flow-endpoint). Escopado ao próprio filtro, então linha
  -- de outra agenda e linha MANUAL (filtro_id null) nunca são tocadas — é
  -- para isso que o índice único de origem é parcial.
  delete from agenda_shows_sync
   where filtro_id = p_filtro_id
     and not (show_id_origem = any(v_origens));

  get diagnostics v_removidos = row_count;

  update agenda_filtros
     set ultima_sync_em = now(),
         ultima_sync_resumo = jsonb_build_object(
           'recebidos', jsonb_array_length(coalesce(p_linhas, '[]'::jsonb)),
           'inseridos', v_gravados - v_existentes,
           'atualizados', v_existentes,
           'removidos', v_removidos
         )
   where id = p_filtro_id;

  return jsonb_build_object(
    'artista', v_artista,
    'recebidos', jsonb_array_length(coalesce(p_linhas, '[]'::jsonb)),
    'inseridos', v_gravados - v_existentes,
    'atualizados', v_existentes,
    'removidos', v_removidos
  );
end;
$$;

comment on function sincronizar_agenda_shows is
  'Grava a agenda já filtrada de uma linha de agenda_filtros e remove o que não veio nesta rodada. Chamada pela Edge Function agenda-sync.';
