-- ============================================================
-- Duas coisas pequenas e independentes.
-- ============================================================

-- ============================================================
-- 1. CAMINHO DA ARTE NO STORAGE
--
-- O sync já sobe o original para `storage/temas/{tenant}/{item}.jpg` e guarda
-- a versão reduzida em base64 (para o Flow, que só aceita base64). A PÁGINA
-- pública não quer base64 — quer uma URL, servida por CDN, com a
-- transformação do Storage fazendo o redimensionamento.
--
-- A coluna guarda o caminho em vez de a página adivinhar a extensão: arte em
-- PNG e arte em JPG convivem, e adivinhar erraria metade.
-- ============================================================
alter table agenda_temas
  add column imagem_path text;

comment on column agenda_temas.imagem_path is
  'Caminho do ORIGINAL no bucket público `temas`. A página monta a URL com transformação; o Flow continua usando imagem_base64.';

-- ============================================================
-- 2. RETENÇÃO DOS DADOS DE PÁGINA (13 meses)
--
-- `pagina_cliques` e `pagina_visitas` crescem para sempre. Guardar dado sem
-- prazo é o oposto do que a LGPD pede, mesmo sendo dado não-pessoal (não há
-- IP, user-agent nem identificador — regra 41).
--
-- 13 meses, e não 12: permite comparar um mês com o mesmo mês do ano
-- anterior, que é a única pergunta histórica que essa base responde.
--
-- RESUMIR ANTES DE APAGAR é a parte que não pode faltar: sem o consolidado,
-- a retenção apagaria a série histórica junto com o dado bruto, e alguém
-- descobriria isso só quando fosse comparar.
-- ============================================================
create table pagina_metricas_mensais (
  pagina_id   uuid not null references paginas_publicas(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  mes         date not null,
  visitas     int not null default 0,
  cliques     int not null default 0,
  por_bloco   jsonb not null default '{}'::jsonb,
  primary key (pagina_id, mes)
);

alter table pagina_metricas_mensais enable row level security;
create policy "tenant_le" on pagina_metricas_mensais for select using (
  tenant_id = my_tenant_id()
);

create or replace function consolidar_e_expurgar_metricas_pagina(p_meses int default 13)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corte       date;
  v_consolidados int;
  v_cliques     int;
  v_visitas     int;
begin
  v_corte := (date_trunc('month', current_date) - make_interval(months => p_meses))::date;

  -- Consolida TUDO que ainda não foi consolidado (não só o que vai ser
  -- apagado): assim a série mensal existe desde sempre, e o expurgo vira um
  -- detalhe em vez de um evento.
  insert into pagina_metricas_mensais (pagina_id, tenant_id, mes, visitas, cliques, por_bloco)
  select
    p.id,
    p.tenant_id,
    m.mes,
    (select count(*) from pagina_visitas v
      where v.pagina_id = p.id and date_trunc('month', v.created_at)::date = m.mes),
    (select count(*) from pagina_cliques c
      where c.pagina_id = p.id and date_trunc('month', c.created_at)::date = m.mes),
    coalesce((
      select jsonb_object_agg(x.bloco_id::text, x.n)
        from (
          select c.bloco_id, count(*) as n
            from pagina_cliques c
           where c.pagina_id = p.id
             and date_trunc('month', c.created_at)::date = m.mes
             and c.bloco_id is not null
           group by c.bloco_id
        ) x
    ), '{}'::jsonb)
  from paginas_publicas p
  cross join lateral (
    select distinct date_trunc('month', d.created_at)::date as mes
      from (
        select created_at from pagina_visitas where pagina_id = p.id
        union all
        select created_at from pagina_cliques where pagina_id = p.id
      ) d
  ) m
  on conflict (pagina_id, mes) do update set
    visitas   = excluded.visitas,
    cliques   = excluded.cliques,
    por_bloco = excluded.por_bloco;

  get diagnostics v_consolidados = row_count;

  delete from pagina_cliques where created_at < v_corte;
  get diagnostics v_cliques = row_count;

  delete from pagina_visitas where created_at < v_corte;
  get diagnostics v_visitas = row_count;

  return jsonb_build_object(
    'corte', v_corte,
    'meses_consolidados', v_consolidados,
    'cliques_apagados', v_cliques,
    'visitas_apagadas', v_visitas
  );
end;
$$;

comment on function consolidar_e_expurgar_metricas_pagina is
  'Consolida o mensal e apaga o bruto com mais de N meses (13 por padrão). Consolidar vem antes de apagar: sem isso a retenção levaria a série histórica junto.';

-- Dia 1, 4h30: mês fechado, e horário sem concorrência com os outros crons.
select cron.schedule(
  'retencao-metricas-pagina',
  '30 4 1 * *',
  $$ select consolidar_e_expurgar_metricas_pagina(); $$
);
