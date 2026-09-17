-- ============================================================
-- Métricas da página pública: visualizações + leitura agregada.
--
-- Cliques já eram gravados (migration paginas_publicas) e apareciam só como
-- um número no editor. Faltavam as visualizações — sem elas não existe taxa
-- de clique, que é a métrica que diz se o problema é o botão ou o alcance.
-- ============================================================

-- ============================================================
-- VISITAS
--
-- Mesma disciplina de pagina_cliques: NADA de pessoal. Sem IP, sem
-- user-agent, sem identificador de visitante. Consequência assumida: o número
-- é de ABERTURAS, não de pessoas únicas — visitante único exigiria um
-- identificador, que é exatamente o que não queremos gravar numa página que
-- qualquer um abre.
--
-- Por que não um contador na linha da página: a evolução no tempo ("caiu
-- depois do story?") precisa de uma linha por abertura. Contador só responde
-- o total.
-- ============================================================
create table pagina_visitas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  pagina_id   uuid not null references paginas_publicas(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index idx_pagina_visitas_pagina on pagina_visitas (pagina_id, created_at desc);

alter table pagina_visitas enable row level security;
create policy "tenant_le" on pagina_visitas for select using (
  tenant_id = my_tenant_id()
);

-- ============================================================
-- REGISTRO DA VISITA
--
-- Recebe o SLUG, não o id: quem chama é o navegador de quem abriu a página,
-- e o slug é o que ela já conhece. Resolver aqui também garante que só
-- página existente e no ar conta.
--
-- Devolve boolean em vez de estourar: é chamada de uma rota pública, e erro
-- ali não pode virar 500 na aba de quem está lendo a página.
-- ============================================================
create or replace function registrar_visita_pagina(p_slug text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pagina record;
begin
  select id, tenant_id into v_pagina
    from paginas_publicas
   where slug = p_slug and ativo;

  if not found then
    return false;
  end if;

  insert into pagina_visitas (tenant_id, pagina_id)
  values (v_pagina.tenant_id, v_pagina.id);

  return true;
end;
$$;

-- ============================================================
-- LEITURA AGREGADA
--
-- Uma função em vez de o app somar linhas: a página de um artista em
-- divulgação pode acumular dezenas de milhares de cliques, e trazer isso
-- para o Node só para contar é o mesmo erro que o Analytics de mensagens já
-- paga hoje com scan paginado (ver "Escala do Analytics" no CLAUDE.md).
--
-- `por_show` é o que o Linktree não responde: qual CIDADE/DATA recebe mais
-- clique. É a pergunta que decide onde anunciar.
-- ============================================================
create or replace function metricas_pagina(p_pagina_id uuid, p_dias int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with limites as (
    select
      (current_date - (p_dias - 1))::timestamptz as desde,
      p.tenant_id
    from paginas_publicas p
    where p.id = p_pagina_id
      -- Isolamento: a função é security definer e chamada pelo painel, então
      -- confere o tenant de quem pergunta em vez de confiar no id recebido.
      and p.tenant_id = my_tenant_id()
  ),
  -- JOIN explícito em tudo, sem vírgula: `from a, b join c on c.x = a.x` faz
  -- o JOIN se ligar a `b` e não a `a`, e o Postgres recusa com "invalid
  -- reference to FROM-clause entry" (erro real ao aplicar esta migration na
  -- primeira tentativa).
  visitas as (
    select count(*)::int as total
      from pagina_visitas pv
      cross join limites l
     where pv.pagina_id = p_pagina_id and pv.created_at >= l.desde
  ),
  cliques as (
    select count(*)::int as total
      from pagina_cliques pc
      cross join limites l
     where pc.pagina_id = p_pagina_id and pc.created_at >= l.desde
  ),
  cliques_por_bloco as (
    select pc.bloco_id, count(*)::int as cliques
      from pagina_cliques pc
      cross join limites l
     where pc.pagina_id = p_pagina_id
       and pc.created_at >= l.desde
       and pc.bloco_id is not null
     group by pc.bloco_id
  ),
  por_bloco as (
    select jsonb_agg(
             jsonb_build_object(
               'bloco_id', b.id,
               'tipo', b.tipo,
               'rotulo', coalesce(
                 nullif(b.conteudo->>'rotulo', ''),
                 nullif(b.conteudo->>'titulo', ''),
                 b.tipo
               ),
               'ativo', b.ativo,
               'cliques', coalesce(cb.cliques, 0)
             )
             order by coalesce(cb.cliques, 0) desc, b.ordem
           ) as dados
      from pagina_blocos b
      left join cliques_por_bloco cb on cb.bloco_id = b.id
     where b.pagina_id = p_pagina_id
  ),
  por_show as (
    select jsonb_agg(
             jsonb_build_object(
               'show_id', s.id,
               'cidade', s.cidade,
               'teatro', s.teatro,
               'data_show', s.data_show,
               'status_venda', s.status_venda,
               'cliques', t.cliques
             )
             order by t.cliques desc
           ) as dados
      from (
        select pc.show_id, count(*)::int as cliques
          from pagina_cliques pc
          cross join limites l
         where pc.pagina_id = p_pagina_id
           and pc.created_at >= l.desde
           and pc.show_id is not null
         group by pc.show_id
      ) t
      join agenda_shows_sync s on s.id = t.show_id
  ),
  serie as (
    select jsonb_agg(
             jsonb_build_object(
               'dia', d.dia::date,
               'visitas', (
                 select count(*) from pagina_visitas pv
                  where pv.pagina_id = p_pagina_id and pv.created_at::date = d.dia::date
               ),
               'cliques', (
                 select count(*) from pagina_cliques pc
                  where pc.pagina_id = p_pagina_id and pc.created_at::date = d.dia::date
               )
             )
             order by d.dia
           ) as dados
      from limites l
      cross join generate_series(l.desde, now(), interval '1 day') as d(dia)
  )
  select jsonb_build_object(
    'dias', p_dias,
    'visitas', (select total from visitas),
    'cliques', (select total from cliques),
    'por_bloco', coalesce((select dados from por_bloco), '[]'::jsonb),
    'por_show', coalesce((select dados from por_show), '[]'::jsonb),
    'serie', coalesce((select dados from serie), '[]'::jsonb)
  )
  from limites;
$$;

comment on function metricas_pagina is
  'Métricas de uma página pública nos últimos N dias, agregadas no banco. Confere my_tenant_id() internamente — security definer não pode confiar no id recebido.';
