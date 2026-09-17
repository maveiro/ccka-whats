-- ============================================================
-- Conteúdo do espetáculo (arte e sinopse) na tela do show.
--
-- Vem do board "Espetáculos" do Monday (criado em 17/09/2026), pela mesma
-- ponte com o painel-shows: Artista > Espetáculo > Show > Cidade > Teatro.
-- O show diz QUAL é o espetáculo; o espetáculo carrega a arte e o texto.
--
-- A imagem fica em BASE64 nesta tabela porque é o único formato que o
-- componente `Image` do Flow aceita — URL não funciona (verificado na doc da
-- Meta em 17/09/2026), e o teto recomendado é 300KB por imagem, com 1MB de
-- payload total no data endpoint. Converter a cada abertura de detalhe
-- gastaria o orçamento de latência do endpoint a cada clique.
-- ============================================================

-- ============================================================
-- CHAVE DE TEXTO
--
-- A ligação show -> espetáculo é por NOME: o rótulo do status "Espetáculo"
-- no board de shows casa com o nome do item no board de espetáculos
-- (decisão do fundador, 17/09/2026 — sem coluna de conexão por ora).
--
-- Comparar o texto cru deixaria "Especial de Natal" e "especial de natal"
-- como espetáculos diferentes, e um acento digitado diferente quebraria em
-- silêncio. Mesma solução de chave_telefone() (regra 25): a chave é coluna
-- gerada, e é ela que tem o índice único.
--
-- `translate` em vez de `unaccent`: a extensão vive no schema `extensions`,
-- que não está no search_path de quem aplica migration (regra 35) — e função
-- de coluna gerada precisa ser IMMUTABLE, o que `unaccent` não é.
-- ============================================================
create or replace function chave_texto(p_texto text)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(lower(translate(
      coalesce(p_texto, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
    ))),
    ''
  )
$$;

comment on function chave_texto is
  'Normaliza texto para casamento por nome (minúsculo, sem acento, sem borda). IMMUTABLE porque é usada em coluna gerada. Não usa unaccent: extensão fora do search_path de migration e não imutável.';

-- ============================================================
-- TEMAS (ESPETÁCULOS)
-- ============================================================
create table agenda_temas (
  tenant_id            uuid not null references tenants(id) on delete cascade,
  nome                 text not null,
  -- Chave do casamento com agenda_shows_sync.espetaculo.
  nome_chave           text generated always as (chave_texto(nome)) stored,
  monday_item_id       text,
  artista_codigo       text,   -- 'IB'
  artista_nome         text,   -- 'Índio Behn'
  sinopse              text,
  -- ID do asset no Monday: é o que diz se a arte MUDOU. A URL não serve para
  -- isso (é assinada e muda a cada request), então baixar de novo só porque
  -- a URL é outra significaria baixar tudo de hora em hora, para sempre.
  arte_asset_id        text,
  imagem_base64        text,
  imagem_bytes         int,
  imagem_atualizada_em timestamptz,
  -- Motivo da última recusa de arte (arquivo grande demais, formato que o
  -- Flow não aceita, download falhou). Sem isso, "o espetáculo não tem
  -- imagem" e "a imagem foi rejeitada" são indistinguíveis na tela.
  imagem_erro          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  id                   uuid primary key default gen_random_uuid()
);

create unique index agenda_temas_nome_chave_key on agenda_temas (tenant_id, nome_chave);

alter table agenda_temas enable row level security;

-- Mesma regra da agenda (0025): leitura para o tenant, escrita para quem
-- administra conteúdo. O sync escreve com service role.
create policy "tenant_read" on agenda_temas for select using (
  tenant_id = my_tenant_id()
);
create policy "gestao_escreve" on agenda_temas for all using (
  tenant_id = my_tenant_id() and my_role() in ('admin', 'operator')
) with check (
  tenant_id = my_tenant_id() and my_role() in ('admin', 'operator')
);

create trigger agenda_temas_set_updated_at
  before update on agenda_temas
  for each row execute function set_updated_at();

-- ============================================================
-- QUAL ESPETÁCULO É O SHOW
--
-- Até agora o espetáculo só era usado para FILTRAR (agenda_filtros.
-- espetaculos) e não era guardado. Sem a coluna, a tela de detalhe não tem
-- como saber de que tema é o show.
-- ============================================================
alter table agenda_shows_sync
  add column espetaculo text;

comment on column agenda_shows_sync.espetaculo is
  'Rótulo do espetáculo como está no board. Casa com agenda_temas.nome_chave via chave_texto() — é assim que a tela do show acha a arte e a sinopse.';

create index idx_agenda_shows_sync_espetaculo
  on agenda_shows_sync (tenant_id, (chave_texto(espetaculo)))
  where espetaculo is not null;

-- ============================================================
-- BUCKET DA ARTE
--
-- A imagem original do Monday é guardada aqui por um motivo prático: a
-- transformação de imagem do Storage (que reduz para caber nos 300KB do
-- Flow) só funciona sobre objeto que está no Storage. Guardar o original
-- também permite refazer o redimensionamento sem baixar do Monday de novo.
--
-- Privado, sem policy: só o sync (service role) escreve e lê.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('temas', 'temas', false)
on conflict (id) do nothing;

-- ============================================================
-- O SYNC PASSA A GRAVAR O ESPETÁCULO
--
-- Coluna nova que vem DO BOARD: entra no insert e também no `do update set`
-- (ao contrário de `publicado`, que é decisão nossa). Se o espetáculo de um
-- show mudar no Monday, a tela do fã tem de acompanhar.
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
      nullif(btrim(l->>'show_id_origem'), '')             as show_id_origem,
      nullif(btrim(coalesce(l->>'cidade', '')), '')       as cidade,
      nullif(btrim(coalesce(l->>'teatro', '')), '')       as teatro,
      (nullif(l->>'data_hora', ''))::timestamptz          as data_show,
      nullif(btrim(coalesce(l->>'status_venda', '')), '') as status_venda,
      nullif(btrim(coalesce(l->>'link_compra', '')), '')  as link_compra,
      nullif(btrim(coalesce(l->>'espetaculo', '')), '')   as espetaculo
    from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) as l
  )
  insert into agenda_shows_sync
    (tenant_id, filtro_id, show_id_origem, artista, cidade, teatro, data_show,
     status_venda, link_compra, espetaculo, publicado)
  select v_filtro.tenant_id, p_filtro_id, e.show_id_origem, v_artista,
         e.cidade, e.teatro, e.data_show, e.status_venda, e.link_compra,
         e.espetaculo, false
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
    espetaculo   = excluded.espetaculo,
    updated_at   = now();
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
