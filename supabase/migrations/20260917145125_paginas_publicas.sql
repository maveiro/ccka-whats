-- ============================================================
-- Página pública do artista — substituta do Linktree.
--
-- Pedido do fundador (17/09/2026) olhando linktr.ee/indiobehn, onde hoje
-- ~25 botões de show são mantidos À MÃO. Esses shows já estão em
-- agenda_shows_sync, vindos do board do Monday: o bloco de agenda desta
-- página é GERADO, e "Esgotou!" sai de status_venda em vez de alguém editar
-- o rótulo do botão.
--
-- O que é decisão editorial (ordem dos blocos, texto, qual espetáculo
-- destacar) fica aqui; o que é dado de show continua vindo do board.
-- ============================================================

-- ============================================================
-- A PÁGINA
--
-- `slug` é único GLOBALMENTE, não por tenant: é uma URL pública, e duas
-- páginas com o mesmo endereço não é ambiguidade que se resolve depois.
--
-- `tema` é jsonb e não colunas: personalização por página foi pedido
-- explícito ("por linktree"), e cada artista vai querer um ajuste diferente.
-- Coluna por propriedade viraria migration a cada ideia nova de cor.
-- ============================================================
create table paginas_publicas (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  slug           text not null unique,
  -- Artista cujos shows o bloco de agenda mostra. Casa com
  -- agenda_shows_sync.artista, que é o mesmo valor de
  -- whatsapp_cloud_credentials.artista — o mesmo nome que a central usa.
  artista        text,
  titulo         text not null,
  bio            text,
  avatar_path    text,
  tema           jsonb not null default '{}'::jsonb,
  ativo          boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Slug de URL: minúsculo, sem espaço, sem acento. Barrado no banco porque
  -- um slug com maiúscula ou espaço gera link que funciona num lugar e
  -- quebra em outro (WhatsApp escapa, Instagram corta).
  constraint slug_formato check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$')
);

comment on column paginas_publicas.tema is
  'Personalização por página: cor_fundo, cor_texto, cor_botao, cor_texto_botao, estilo_botao, imagem_fundo_path. jsonb porque é gosto, não estrutura.';

alter table paginas_publicas enable row level security;
create policy "gestao" on paginas_publicas for all using (
  tenant_id = my_tenant_id() and my_role() in ('admin', 'operator')
) with check (
  tenant_id = my_tenant_id() and my_role() in ('admin', 'operator')
);
-- A leitura pública NÃO passa por policy: a página é servida por Route
-- Handler com service role (mesmo desenho de /f/[slug]), que seleciona só o
-- que é público por natureza. Dar SELECT anônimo aqui exporia tenant_id e
-- contagens para qualquer um.

create trigger paginas_publicas_set_updated_at
  before update on paginas_publicas
  for each row execute function set_updated_at();

-- ============================================================
-- OS BLOCOS
--
-- Quatro tipos cobrem o Linktree atual do artista inteiro:
--   texto   — cabeçalho/parágrafo ("PUBLICIDADE/EVENTOS/PALESTRAS")
--   link    — botão, com imagem opcional (o livro, o corporativo, o formulário)
--   imagem  — arte solta
--   agenda  — GERADO dos shows publicados, com filtro opcional de espetáculo
--
-- `conteudo` é jsonb porque cada tipo tem campos próprios; validar formato de
-- cada um em check aqui viraria uma constraint ilegível. O que o banco
-- garante é o essencial: tipo conhecido e ordem definida.
-- ============================================================
create table pagina_blocos (
  id          uuid primary key default gen_random_uuid(),
  pagina_id   uuid not null references paginas_publicas(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  tipo        text not null check (tipo in ('texto', 'link', 'imagem', 'agenda')),
  ordem       int not null,
  conteudo    jsonb not null default '{}'::jsonb,
  ativo       boolean not null default true,
  -- Contadores de clique. Recalculados por count(*) sobre pagina_cliques,
  -- nunca incrementados às cegas — mesma regra de recompute_campaign_counters
  -- (0019): evento repetido não pode inflar número.
  cliques     int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_pagina_blocos_pagina on pagina_blocos (pagina_id, ordem);

alter table pagina_blocos enable row level security;
create policy "gestao" on pagina_blocos for all using (
  tenant_id = my_tenant_id() and my_role() in ('admin', 'operator')
) with check (
  tenant_id = my_tenant_id() and my_role() in ('admin', 'operator')
);

create trigger pagina_blocos_set_updated_at
  before update on pagina_blocos
  for each row execute function set_updated_at();

-- ============================================================
-- CLIQUES
--
-- Uma linha por clique, sem NADA de pessoal: sem IP, sem user-agent, sem
-- identificador de visitante. O que interessa é "qual botão, quando" — e
-- guardar mais que isso numa página pública seria coleta que ninguém
-- consentiu (LGPD, mesmo espírito da regra 24 sobre cadastro).
--
-- `show_id` preenchido quando o clique foi num botão de show dentro de um
-- bloco de agenda: é o que responde "qual data vende mais", que é a pergunta
-- que o Linktree não responde.
-- ============================================================
create table pagina_cliques (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  pagina_id   uuid not null references paginas_publicas(id) on delete cascade,
  bloco_id    uuid references pagina_blocos(id) on delete set null,
  show_id     uuid references agenda_shows_sync(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index idx_pagina_cliques_bloco on pagina_cliques (bloco_id, created_at desc);
create index idx_pagina_cliques_show on pagina_cliques (show_id) where show_id is not null;

alter table pagina_cliques enable row level security;
create policy "tenant_le" on pagina_cliques for select using (
  tenant_id = my_tenant_id()
);

-- ============================================================
-- REGISTRO DO CLIQUE + DESTINO
--
-- Uma função, como register_campaign_click (migration
-- campanhas_clique_rastreado), e pelos mesmos motivos: o redirect precisa ser
-- rápido, e gravar o clique e descobrir o destino em dois round-trips dobra a
-- espera de quem está indo comprar ingresso.
--
-- Devolve o destino: para bloco de link, o `url` do conteúdo; para clique em
-- show, o link_compra daquele show. Sem destino, devolve null — e quem chama
-- manda a pessoa para a página em vez de mostrar erro (mesma regra 34).
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
    -- Só show PUBLICADO e do mesmo tenant: link de show despublicado não
    -- pode continuar funcionando por ter sido copiado antes.
    select s.link_compra into v_destino
      from agenda_shows_sync s
     where s.id = p_show_id
       and s.tenant_id = v_bloco.tenant_id
       and s.publicado;
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

comment on function registrar_clique_pagina is
  'Grava o clique e devolve o destino, numa chamada. Null quando não há destino — quem chama redireciona para a página, nunca mostra erro.';

-- ============================================================
-- BUCKET DAS IMAGENS DA PÁGINA
--
-- Público: são arte de divulgação e avatar, feitos para serem vistos, e
-- servir por CDN é o que mantém a página rápida. Diferente do bucket `media`
-- (conversa de WhatsApp, privado por natureza).
-- ============================================================
insert into storage.buckets (id, name, public)
values ('paginas', 'paginas', true)
on conflict (id) do nothing;

-- O mesmo vale para a arte dos espetáculos, que o bloco de agenda mostra: era
-- privada porque só o Flow a usava (em base64). Numa página pública, servir
-- por CDN é o certo — e não há segredo em cartaz de show.
update storage.buckets set public = true where id = 'temas';
