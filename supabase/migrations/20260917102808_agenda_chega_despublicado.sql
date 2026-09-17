-- ============================================================
-- Show novo do board chega DESPUBLICADO (decisão do fundador, 17/09/2026).
--
-- Inverte o default da migration agenda_publicado, de um dia antes: lá o
-- critério era "não esconder o que já estava no ar"; aqui o critério é
-- curadoria — nada chega ao fã sem alguém dizer que vai.
--
-- O que NÃO muda: as linhas que já existem. 68 shows estão publicados e
-- continuam; `set default` não reescreve linha nenhuma. Se reescrevesse, a
-- central ficaria vazia sem ninguém pedir.
-- ============================================================

alter table agenda_shows_sync
  alter column publicado set default false;

comment on column agenda_shows_sync.publicado is
  'Escolha editorial de quem cuida da central. Show novo do board nasce false (curadoria: nada vai ao ar sem aprovação) e só o painel publica. Sobrevive ao sync nos DOIS sentidos — publicar à mão não é desfeito pela rodada seguinte, despublicar também não.';

-- ============================================================
-- O INSERT PASSA A SER EXPLÍCITO
--
-- Não por necessidade (o default resolveria), e sim porque este é o único
-- escritor da tabela: deixar implícito faria a regra de negócio morar num
-- `alter column` que ninguém lê ao abrir a função. E o `do update set`
-- continua sem tocar `publicado` — é o que garante os dois sentidos: a
-- rodada seguinte não republica o que foi escondido nem esconde o que foi
-- aprovado.
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
    (tenant_id, filtro_id, show_id_origem, artista, cidade, teatro, data_show, status_venda, link_compra, publicado)
  select v_filtro.tenant_id, p_filtro_id, e.show_id_origem, v_artista,
         e.cidade, e.teatro, e.data_show, e.status_venda, e.link_compra,
         false
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
    -- `publicado` FICA FORA nos dois sentidos (ver comentário acima).

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
           -- Renomeado de `despublicados`: com o default invertido, o número
           -- deixa de ser "o que alguém escondeu" e passa a ser "o que está
           -- esperando aprovação" — é a fila de trabalho da tela.
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
