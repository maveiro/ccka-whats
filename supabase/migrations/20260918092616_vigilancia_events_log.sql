-- ============================================================
-- Vigilância do events_log.
--
-- O projeto grava em events_log com disciplina (regra 6) e NUNCA lê. Em
-- 12–14/09/2026 houve um surto de 86 `Gateway Timeout` no caminho do webhook
-- de custo/status — 71 só no dia 13 — que passou sozinho e ninguém soube. No
-- mesmo mês, duas falhas silenciosas na ponte da agenda (espelho não
-- atualizando por timeout, arte sumindo dentro de um `catch {}` vazio).
--
-- O que torna isso legível não é listar linha a linha: 57 erros idênticos
-- precisam virar UMA linha com contagem. E o que interessa mais é
-- **assinatura nova** — erro que nunca apareceu costuma ser o que quebrou
-- agora.
-- ============================================================

-- ============================================================
-- ASSINATURA
--
-- Agrupa erros que são "o mesmo problema". Número e UUID viram `#` porque
-- eles são o que difere entre duas ocorrências do mesmo defeito
-- ("campaign_recipients lookup: Gateway Timeout" com ids diferentes).
--
-- 80 caracteres: o suficiente para distinguir causa, curto o bastante para
-- caber numa linha de tabela.
-- ============================================================
create or replace function assinatura_erro(p_event_type text, p_error text)
returns text
language sql
immutable
as $$
  select left(
    coalesce(p_event_type, 'error') || ': ' ||
    regexp_replace(
      regexp_replace(coalesce(p_error, ''), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '#', 'gi'),
      -- Qualquer palavra QUE CONTENHA dígito vira `#`: pega id numérico
      -- (`lookup 4821`) e id alfanumérico (`lookup 8f3a`), que é a forma
      -- comum. Palavra sem dígito nunca casa, então "Gateway Timeout"
      -- continua legível — trocar todo token hexadecimal estragaria
      -- palavras como "face" e "dead".
      '\m[a-z0-9]*[0-9][a-z0-9]*\M', '#', 'gi'
    ),
    80
  )
$$;

comment on function assinatura_erro is
  'Identidade de um erro para agrupamento: tipo + mensagem com números e UUIDs trocados por #. É o que faz 57 timeouts virarem uma linha.';

-- ============================================================
-- RECONHECIMENTO
--
-- Reconhecer não apaga: guarda o instante. Ocorrência NOVA depois disso
-- volta a contar — senão um erro reconhecido uma vez ficaria invisível para
-- sempre, que é pior que não ter tela.
-- ============================================================
create table erros_reconhecidos (
  tenant_id       uuid not null references tenants(id) on delete cascade,
  assinatura      text not null,
  reconhecido_em  timestamptz not null default now(),
  reconhecido_por uuid references operators(id) on delete set null,
  primary key (tenant_id, assinatura)
);

alter table erros_reconhecidos enable row level security;
create policy "gestao" on erros_reconhecidos for all using (
  tenant_id = my_tenant_id() and my_role() = 'admin'
) with check (
  tenant_id = my_tenant_id() and my_role() = 'admin'
);

-- Avisos já enviados, para não repetir o mesmo alerta de hora em hora.
create table erros_avisados (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  assinatura  text not null,
  dia         date not null default current_date,
  avisado_em  timestamptz not null default now(),
  primary key (tenant_id, assinatura, dia)
);

alter table erros_avisados enable row level security;
create policy "tenant_le" on erros_avisados for select using (tenant_id = my_tenant_id());

-- events_log não tinha índice para "erros recentes" — a tela varreria a
-- tabela inteira, que é a de maior volume do sistema.
create index idx_events_log_erros
  on events_log (tenant_id, created_at desc)
  where error is not null;

-- ============================================================
-- RESUMO PARA A TELA
--
-- Agregado no banco: a alternativa é trazer milhares de linhas para contar
-- no Node, que é o erro que o Analytics de mensagens já paga com scan
-- paginado.
-- ============================================================
create or replace function resumo_de_erros(p_horas int default 24)
returns table (
  assinatura     text,
  event_type     text,
  amostra        text,
  ocorrencias    bigint,
  primeiro       timestamptz,
  ultimo         timestamptz,
  reconhecido    boolean,
  novo_desde_ack bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with erros as (
    select
      assinatura_erro(e.event_type, e.error) as assinatura,
      e.event_type,
      e.error,
      e.created_at
    from events_log e
    where e.tenant_id = my_tenant_id()
      and e.error is not null
      and e.created_at >= now() - make_interval(hours => p_horas)
  )
  select
    e.assinatura,
    min(e.event_type) as event_type,
    -- Uma mensagem real, não a assinatura: a assinatura tem `#` no lugar dos
    -- ids e é ruim de ler quando se quer investigar.
    (array_agg(e.error order by e.created_at desc))[1] as amostra,
    count(*) as ocorrencias,
    min(e.created_at) as primeiro,
    max(e.created_at) as ultimo,
    r.assinatura is not null as reconhecido,
    count(*) filter (where r.reconhecido_em is null or e.created_at > r.reconhecido_em) as novo_desde_ack
  from erros e
  left join erros_reconhecidos r
    on r.tenant_id = my_tenant_id() and r.assinatura = e.assinatura
  group by e.assinatura, r.assinatura, r.reconhecido_em
  order by count(*) filter (where r.reconhecido_em is null or e.created_at > r.reconhecido_em) desc,
           max(e.created_at) desc;
$$;

-- ============================================================
-- AVISO ATIVO (pg_cron, de hora em hora)
--
-- Dois gatilhos, e o primeiro é o que importa:
--   1. assinatura NOVA — nunca vista nos 30 dias anteriores;
--   2. volume — mais de 20 ocorrências no dia.
--
-- Entrega pelo `webhook-delivery`, que já existe e já lê as integrações do
-- tenant (Slack, n8n, o que o admin apontar). Nenhuma peça nova, nenhum
-- custo por mensagem — ao contrário de avisar por WhatsApp, que fora da
-- janela de 24h exigiria template aprovado.
-- ============================================================
-- A SELEÇÃO é uma função à parte do ENVIO, de propósito: assim o critério
-- ("o que merece aviso") tem teste automatizado sem que nenhum teste dispare
-- HTTP para lugar nenhum. O envio, que é o pedaço não testável, fica bobo.
create or replace function erros_para_avisar()
returns table (tenant_id uuid, assinatura text, na_hora bigint, amostra text, e_nova boolean, no_dia bigint)
language sql
stable
security definer
set search_path = public
as $$
  with recentes as (
    select
      e.tenant_id,
      assinatura_erro(e.event_type, e.error) as assinatura,
      count(*) as na_hora,
      max(e.error) as amostra
    from events_log e
    where e.error is not null
      and e.created_at >= now() - interval '1 hour'
    group by 1, 2
  ),
  avaliados as (
    select
      r.tenant_id,
      r.assinatura,
      r.na_hora,
      r.amostra,
      not exists (
        select 1 from events_log a
        where a.tenant_id = r.tenant_id
          and a.error is not null
          and a.created_at between now() - interval '30 days' and now() - interval '1 hour'
          and assinatura_erro(a.event_type, a.error) = r.assinatura
      ) as e_nova,
      (
        select count(*) from events_log d
        where d.tenant_id = r.tenant_id
          and d.error is not null
          and d.created_at >= current_date
          and assinatura_erro(d.event_type, d.error) = r.assinatura
      ) as no_dia
    from recentes r
  )
  select a.tenant_id, a.assinatura, a.na_hora, a.amostra, a.e_nova, a.no_dia
    from avaliados a
   -- Só o que é NOVO ou passou do volume...
   where (a.e_nova or a.no_dia > 20)
     -- ...e no máximo uma vez por dia por assinatura: alerta repetido de hora
     -- em hora vira ruído, e ruído é o que faz alerta ser ignorado.
     and not exists (
       select 1 from erros_avisados v
       where v.tenant_id = a.tenant_id and v.assinatura = a.assinatura and v.dia = current_date
     );
$$;

comment on function erros_para_avisar is
  'O que merece aviso agora: assinatura nova (nunca vista em 30 dias) ou mais de 20 ocorrências no dia, uma vez por dia. Separada do envio para ter teste sem HTTP.';

create or replace function avisar_erros_do_events_log()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
  aviso       record;
begin
  select value into service_key from internal_secrets where key = 'service_role_key';
  if service_key is null then
    return; -- sem segredo não há como chamar a function (evita 401 em loop)
  end if;

  for aviso in select * from erros_para_avisar() loop
    insert into erros_avisados (tenant_id, assinatura) values (aviso.tenant_id, aviso.assinatura)
    on conflict do nothing;

    perform net.http_post(
      url     := 'https://byuggqcnvezendgrcysb.supabase.co/functions/v1/webhook-delivery',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body    := jsonb_build_object(
        'tenantId', aviso.tenant_id,
        'event', case when aviso.e_nova then 'erro.novo' else 'erro.volume' end,
        'payload', jsonb_build_object(
          'assinatura', aviso.assinatura,
          'amostra', aviso.amostra,
          'na_ultima_hora', aviso.na_hora,
          'no_dia', aviso.no_dia,
          'novo', aviso.e_nova
        )
      )
    );
  end loop;
end;
$$;

-- Minuto 12: longe do topo da hora (onde todo cron se acumula) e longe do
-- minuto 7, que é o tick da agenda.
select cron.schedule(
  'vigilancia-events-log',
  '12 * * * *',
  $$ select avisar_erros_do_events_log(); $$
);
