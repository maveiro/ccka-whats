-- ============================================================
-- Selos do card de show + show confirmado que ainda não vende.
--
-- Referência de layout (decisão do fundador, 17/09/2026): card com data à
-- esquerda, espetáculo, hora/cidade/teatro, chips de selo e um botão de ação
-- à direita — no formato de agenda de ticketeira.
--
-- Duas mudanças de dado:
--
-- 1. `label_ingressos` / `label_periodo`, vindos do board (espelhados do
--    Marketing): são os chips. Rótulo cru, como o status — traduzir no banco
--    esconderia do painel o que está escrito lá.
--
-- 2. Show com status `Confirmado` passa a poder entrar na agenda. É show que
--    existe mas ainda não vende: aparece com o selo "Confirmado" e o botão
--    vira LISTA DE ESPERA em vez de "Ver ingressos". Antes disso, a allowlist
--    prática era Vendendo/Esgotado e ele simplesmente não existia para o fã.
-- ============================================================

alter table agenda_shows_sync
  add column label_ingressos text,
  add column label_periodo   text;

comment on column agenda_shows_sync.label_ingressos is
  'Selo editorial vindo do board ("Em Alta", "Quase Esgotado"...). Chip no card da página pública. Rótulo cru.';
comment on column agenda_shows_sync.label_periodo is
  'Selo de período vindo do board ("Amanhã", "Neste Fim de Semana"). ATENÇÃO: é fato derivado da data mantido à mão, e envelhece — a página pública deriva o período da própria data e usa este campo só como complemento.';

-- ============================================================
-- LINK DA LISTA DE ESPERA
--
-- Show confirmado que não vende não tem link de compra. Sem um destino, o
-- botão "Lista de espera" não teria para onde ir — e botão que não leva a
-- nada é pior que ausência de botão.
--
-- Fica no BLOCO de agenda (conteudo->>'url_lista_espera'), não numa coluna:
-- é decisão editorial da página, e cada grupo de shows pode ter um
-- formulário diferente (o Linktree atual tem um "faltou a sua cidade").
-- Nada a migrar aqui, é jsonb — este comentário existe para a decisão não se
-- perder.
-- ============================================================

-- O sync passa a gravar os dois selos. Coluna nova que vem DO BOARD entra no
-- insert e no `do update set` (ao contrário de `publicado`, que é nossa).
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
      nullif(btrim(l->>'show_id_origem'), '')                as show_id_origem,
      nullif(btrim(coalesce(l->>'cidade', '')), '')          as cidade,
      nullif(btrim(coalesce(l->>'teatro', '')), '')          as teatro,
      (nullif(l->>'data_hora', ''))::timestamptz             as data_show,
      nullif(btrim(coalesce(l->>'status_venda', '')), '')    as status_venda,
      nullif(btrim(coalesce(l->>'link_compra', '')), '')     as link_compra,
      nullif(btrim(coalesce(l->>'espetaculo', '')), '')      as espetaculo,
      nullif(btrim(coalesce(l->>'label_ingressos', '')), '') as label_ingressos,
      nullif(btrim(coalesce(l->>'label_periodo', '')), '')   as label_periodo
    from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) as l
  )
  insert into agenda_shows_sync
    (tenant_id, filtro_id, show_id_origem, artista, cidade, teatro, data_show,
     status_venda, link_compra, espetaculo, label_ingressos, label_periodo, publicado)
  select v_filtro.tenant_id, p_filtro_id, e.show_id_origem, v_artista,
         e.cidade, e.teatro, e.data_show, e.status_venda, e.link_compra,
         e.espetaculo, e.label_ingressos, e.label_periodo, false
    from entrada e
   where e.show_id_origem is not null
  on conflict (tenant_id, show_id_origem) where show_id_origem is not null
  do update set
    filtro_id       = excluded.filtro_id,
    artista         = excluded.artista,
    cidade          = excluded.cidade,
    teatro          = excluded.teatro,
    data_show       = excluded.data_show,
    status_venda    = excluded.status_venda,
    link_compra     = excluded.link_compra,
    espetaculo      = excluded.espetaculo,
    label_ingressos = excluded.label_ingressos,
    label_periodo   = excluded.label_periodo,
    updated_at      = now();
    -- `publicado` continua FORA: é decisão nossa, não dado do board.

  get diagnostics v_gravados = row_count;

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
           'removidos', v_removidos,
           'aguardando_publicacao', (
             select count(*) from agenda_shows_sync
              where filtro_id = p_filtro_id and publicado = false
           )
         )
   where id = p_filtro_id;

  return jsonb_build_object(
    'artista', v_artista,
    'recebidos', jsonb_array_length(coalesce(p_linhas, '[]'::jsonb)),
    'inseridos', v_gravados - v_existentes,
    'atualizados', v_existentes,
    'removidos', v_removidos,
    'aguardando_publicacao', (
      select count(*) from agenda_shows_sync
       where filtro_id = p_filtro_id and publicado = false
    )
  );
end;
$$;

-- ============================================================
-- O CLIQUE NA LISTA DE ESPERA TAMBÉM CONTA
--
-- Show confirmado não tem link de compra; o botão vira lista de espera e
-- aponta para o `url_lista_espera` do BLOCO. Sem esse fallback, o clique
-- cairia no `return null` e a pessoa iria para a home — perdendo tanto o
-- lead quanto a contagem, que é justamente a informação mais valiosa aqui
-- ("quanta gente quer esta cidade").
-- ============================================================
create or replace function registrar_clique_pagina(p_bloco_id uuid, p_show_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bloco   record;
  v_destino text;
begin
  select b.id, b.pagina_id, b.tenant_id, b.tipo, b.conteudo, b.ativo
    into v_bloco
    from pagina_blocos b
    join paginas_publicas p on p.id = b.pagina_id and p.ativo
   where b.id = p_bloco_id and b.ativo;

  if not found then
    return null;
  end if;

  if p_show_id is not null then
    select s.link_compra into v_destino
      from agenda_shows_sync s
     where s.id = p_show_id
       and s.tenant_id = v_bloco.tenant_id
       and s.publicado;

    -- Sem link de compra (show confirmado que ainda não vende), o destino é
    -- a lista de espera do bloco.
    if nullif(btrim(coalesce(v_destino, '')), '') is null then
      v_destino := nullif(btrim(coalesce(v_bloco.conteudo->>'url_lista_espera', '')), '');
    end if;
  else
    v_destino := nullif(btrim(coalesce(v_bloco.conteudo->>'url', '')), '');
  end if;

  insert into pagina_cliques (tenant_id, pagina_id, bloco_id, show_id)
  values (v_bloco.tenant_id, v_bloco.pagina_id, p_bloco_id, p_show_id);

  update pagina_blocos
     set cliques = (select count(*) from pagina_cliques where bloco_id = p_bloco_id)
   where id = p_bloco_id;

  return v_destino;
end;
$$;
