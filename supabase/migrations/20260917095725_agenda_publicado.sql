-- ============================================================
-- Controle manual de publicação por show (pedido do fundador, 17/09/2026).
--
-- O board do Monday diz o que está à venda; esta coluna diz o que vai ao ar
-- na central. São decisões diferentes e de donos diferentes: "Vendendo" é
-- estado comercial do show, "publicado" é escolha editorial de quem cuida do
-- WhatsApp — show à venda que ainda não deve ser divulgado (pré-venda de
-- fã-clube, anúncio combinado para outra data) existe, e antes disso a única
-- saída era tirar o show do board.
--
-- Default true: o comportamento de hoje é "tudo que é elegível aparece", e
-- mudar isso em silêncio esconderia 63 shows já publicados.
-- ============================================================

alter table agenda_shows_sync
  add column publicado boolean not null default true;

comment on column agenda_shows_sync.publicado is
  'Escolha editorial de quem cuida da central: false esconde o show do fã sem mexer no board. Sobrevive ao sync (sincronizar_agenda_shows não a toca no conflito) e é filtrada pelo flow-endpoint.';

-- A lista do fã é filtrada por tenant + artista + data futura + publicado; o
-- índice existente (tenant_id, artista, data_show) já cobre os três
-- primeiros, e `publicado` é seletivo ao contrário (quase tudo é true), então
-- não entra em índice: filtrar em memória as poucas linhas restantes é mais
-- barato que manter um índice a mais.

-- ============================================================
-- O SYNC NÃO PODE DESFAZER A ESCOLHA EDITORIAL
--
-- É o ponto inteiro desta coluna: o show continua elegível no board, então
-- toda rodada de hora em hora o encontra e faz upsert. Se `publicado`
-- entrasse no `do update set`, a despublicação duraria até o próximo tick —
-- e voltaria sozinha, sem ninguém saber por quê.
--
-- A lista de colunas do update abaixo é a mesma da migration
-- agenda_do_painel_shows, de propósito: só o que vem do board é
-- sobrescrito. Qualquer coluna nova que represente decisão NOSSA (e não
-- dado do board) fica fora dela.
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
    -- `publicado` FICA FORA: é decisão nossa, não dado do board (ver acima).

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
           'despublicados', (
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
    'despublicados', (
      select count(*) from agenda_shows_sync
       where filtro_id = p_filtro_id and publicado = false
    )
  );
end;
$$;
