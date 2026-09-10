-- ============================================================
-- Migration: 20260910173238_custos_cloud_api.sql
-- Custo por disparo da WhatsApp Cloud API (oficial).
--
-- A Meta manda a informação de faturamento POR MENSAGEM no webhook de
-- status (objeto `pricing`: billable / pricing_model / type / category),
-- mas nunca o valor em dinheiro. O valor sai de uma tabela de tarifas
-- local (rate card publicado pela Meta). Esta migration cria as duas
-- pontas — tarifas + razão (ledger) — e as agregações que a aba de
-- Custos consome.
--
-- Aditivo: não altera nenhuma tabela existente. O ledger é escrito pelo
-- whatsapp-cloud-webhook, na mesma passagem em que ele já trata status de
-- entrega de campanha.
-- ============================================================


-- ============================================================
-- TARIFAS (rate card da Meta)
-- Referência de plataforma, SEM tenant_id — exceção consciente à regra 1
-- do CLAUDE.md, mesmo precedente de internal_secrets (0023): é preço
-- público da Meta, idêntico para todo tenant. Escrita só por migration
-- (deny-all); leitura liberada para authenticated porque a UI precisa
-- mostrar a tarifa vigente.
-- ============================================================
create table whatsapp_rates (
  country_code    text not null,           -- ISO-2 do destinatário ('BR')
  category        text not null,           -- marketing|utility|authentication|service
  currency        text not null,           -- 'BRL'
  amount          numeric(10,6) not null,
  effective_from  date not null,
  effective_to    date,                    -- null = vigente
  estimated       boolean not null default false,
    -- true = tarifa ainda não publicada oficialmente pela Meta (projeção).
    -- A UI rotula qualquer número derivado de linha estimada.
  source          text,
  primary key (country_code, category, currency, effective_from)
);

alter table whatsapp_rates enable row level security;

create policy "read_all_authenticated" on whatsapp_rates
  for select to authenticated using (true);

-- Rate card BRL vigente desde 01/07/2026 (faturamento pela Facebook Brasil).
-- Mensagem de serviço não existia como categoria cobrada até 30/09/2026.
insert into whatsapp_rates (country_code, category, currency, amount, effective_from, effective_to, estimated, source) values
  ('BR', 'marketing',      'BRL', 0.321700, '2026-07-01', null, false, 'Meta BRL rate card, jul/2026'),
  ('BR', 'utility',        'BRL', 0.035000, '2026-07-01', null, false, 'Meta BRL rate card, jul/2026'),
  ('BR', 'authentication', 'BRL', 0.035000, '2026-07-01', null, false, 'Meta BRL rate card, jul/2026'),
  ('BR', 'service',        'BRL', 0.000000, '2026-07-01', '2026-09-30', false, 'Mensagem de serviço gratuita até 30/09/2026'),
  -- A partir de 01/10/2026 mensagem de serviço passa a ser cobrada na
  -- tarifa local de utility/auth, com franquia de 1.000/mês por número.
  -- Marcada como estimada até a Meta publicar o rate card final.
  ('BR', 'service',        'BRL', 0.035000, '2026-10-01', null, true,  'Estimativa: tarifa de utility/auth BR, mudança de 01/10/2026');


-- Tarifa vigente numa data. Congelada na linha do ledger no momento da
-- gravação — mudança futura de rate card não reescreve histórico.
create or replace function resolve_whatsapp_rate(
  p_country  text,
  p_category text,
  p_currency text,
  p_at       timestamptz
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select amount
  from whatsapp_rates
  where country_code = upper(p_country)
    and category = lower(p_category)
    and currency = upper(p_currency)
    and effective_from <= (p_at at time zone 'UTC')::date
    and (effective_to is null or effective_to >= (p_at at time zone 'UTC')::date)
  order by effective_from desc
  limit 1
$$;


-- ============================================================
-- LEDGER — uma linha por wamid
-- Superset de propósito: cobre campanha (campaign_id preenchido),
-- resposta automática de Flow e envio manual do painel (campaign_id null)
-- — que são exatamente os disparos que passam a custar em 01/10/2026.
-- ============================================================
create table whatsapp_message_costs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  wamid             text not null unique,
  session_id        uuid references wa_sessions(id) on delete set null,
  campaign_id       uuid references campaigns(id) on delete set null,
    -- set null (não cascade): excluir a campanha não pode apagar o gasto
    -- que já aconteceu — é dado de faturamento, não de operação.
  phone_number_id   text,
  recipient_phone   text,
  country_code      text,
  billable          boolean not null default false,
  pricing_model     text,                  -- PMP|CBP
  pricing_type      text,                  -- regular|free_customer_service|free_entry_point
  pricing_category  text,                  -- marketing|utility|authentication|service
  rate_amount       numeric(10,6) not null default 0,
  currency          text not null default 'BRL',
  sent_at           timestamptz not null,
  created_at        timestamptz default now()
);

create index whatsapp_message_costs_tenant_sent_idx on whatsapp_message_costs (tenant_id, sent_at desc);
create index whatsapp_message_costs_campaign_idx on whatsapp_message_costs (campaign_id) where campaign_id is not null;

alter table whatsapp_message_costs enable row level security;

create policy "admin_only" on whatsapp_message_costs
  for all using (tenant_id = my_tenant_id() and my_role() = 'admin');


-- ============================================================
-- AGREGAÇÕES DA ABA DE CUSTOS
-- Em SQL com GROUP BY, não em scan paginado no Route Handler (dívida
-- conhecida do /api/analytics — ver CLAUDE.md, "Escala do Analytics").
-- Sem parâmetro de tenant: deriva de my_tenant_id() e exige admin, então
-- é chamada com o client autenticado do usuário (IDOR-safe por construção).
-- ============================================================
create or replace function costs_summary(
  p_from       timestamptz,
  p_to         timestamptz,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := my_tenant_id();
  v_result jsonb;
begin
  if v_tenant is null or my_role() <> 'admin' then
    raise exception 'forbidden';
  end if;

  with base as (
    select *
    from whatsapp_message_costs
    where tenant_id = v_tenant
      and sent_at >= p_from
      and sent_at < p_to
      and (p_session_id is null or session_id = p_session_id)
  ),
  -- Projeção das regras de 01/10/2026 aplicadas ao MESMO volume:
  --  • free_customer_service + category service  → tarifa de serviço,
  --    com franquia de 1.000/mês por número (rank dentro do número/mês).
  --    A franquia é contada dentro do período consultado: se o filtro não
  --    for um mês fechado, o número é aproximado por baixo — a tela avisa;
  --  • free_customer_service + category utility  → tarifa cheia de
  --    utilidade, sem franquia (perde a gratuidade dentro da janela);
  --  • free_entry_point                          → continua grátis;
  --  • regular                                   → inalterado.
  projetado as (
    select
      b.*,
      case
        when b.pricing_type = 'free_customer_service' and coalesce(b.pricing_category, 'service') = 'service'
          then case
            when row_number() over (
                   partition by b.phone_number_id, date_trunc('month', b.sent_at)
                   order by b.sent_at
                 ) <= 1000
              then 0
            else coalesce(resolve_whatsapp_rate(coalesce(b.country_code, 'BR'), 'service', b.currency, '2026-10-01'::timestamptz), 0)
          end
        when b.pricing_type = 'free_customer_service'
          then coalesce(resolve_whatsapp_rate(coalesce(b.country_code, 'BR'), b.pricing_category, b.currency, '2026-10-01'::timestamptz), 0)
        else b.rate_amount
      end as rate_futuro
    from base b
  )
  select jsonb_build_object(
    'total',            coalesce((select sum(rate_amount) from base), 0),
    'messages',         (select count(*) from base),
    'billableMessages', (select count(*) from base where billable),
    'freeMessages',     (select count(*) from base where not billable),
    -- Cobrada pela Meta mas sem tarifa cadastrada aqui (país fora do rate
    -- card local): entra com custo zero e é contada à parte, para o total
    -- nunca parecer completo quando não é.
    'unratedMessages',  (select count(*) from base where billable and rate_amount = 0),
    -- Quanto a janela de 24h/72h economizou: o que essas mensagens
    -- custariam na tarifa cheia da própria categoria, hoje.
    'savedByWindow', coalesce((
      select sum(coalesce(resolve_whatsapp_rate(coalesce(country_code, 'BR'), coalesce(pricing_category, 'service'), currency, sent_at), 0))
      from base where not billable
    ), 0),
    'byCategory', coalesce((
      select jsonb_agg(x order by x->>'category')
      from (
        select jsonb_build_object(
                 'category', coalesce(pricing_category, 'desconhecida'),
                 'messages', count(*),
                 'cost', sum(rate_amount)
               ) as x
        from base group by coalesce(pricing_category, 'desconhecida')
      ) t
    ), '[]'::jsonb),
    'byPricingType', coalesce((
      select jsonb_agg(x order by x->>'type')
      from (
        select jsonb_build_object(
                 'type', coalesce(pricing_type, 'desconhecido'),
                 'messages', count(*),
                 'cost', sum(rate_amount)
               ) as x
        from base group by coalesce(pricing_type, 'desconhecido')
      ) t
    ), '[]'::jsonb),
    'byDay', coalesce((
      select jsonb_agg(x order by x->>'day')
      from (
        select jsonb_build_object(
                 'day', to_char(date_trunc('day', sent_at), 'YYYY-MM-DD'),
                 'messages', count(*),
                 'cost', sum(rate_amount)
               ) as x
        from base group by date_trunc('day', sent_at)
      ) t
    ), '[]'::jsonb),
    'bySession', coalesce((
      select jsonb_agg(x order by (x->>'cost')::numeric desc)
      from (
        select jsonb_build_object(
                 'sessionId', b.session_id,
                 'label', coalesce(s.label, s.phone_number, b.phone_number_id, 'sem número'),
                 'messages', count(*),
                 'cost', sum(b.rate_amount)
               ) as x
        from base b
        left join wa_sessions s on s.id = b.session_id
        group by b.session_id, s.label, s.phone_number, b.phone_number_id
      ) t
    ), '[]'::jsonb),
    'byCampaign', coalesce((
      select jsonb_agg(x order by (x->>'cost')::numeric desc)
      from (
        select jsonb_build_object(
                 'campaignId', b.campaign_id,
                 'name', c.name,
                 'templateCategory', c.template_category,
                 'messages', count(*),
                 'delivered', count(*) filter (where r.status in ('delivered','read')),
                 'cost', sum(b.rate_amount)
               ) as x
        from base b
        join campaigns c on c.id = b.campaign_id
        left join campaign_recipients r on r.wamid = b.wamid
        where b.campaign_id is not null
        group by b.campaign_id, c.name, c.template_category
      ) t
    ), '[]'::jsonb),
    'projection', jsonb_build_object(
      'effectiveFrom', '2026-10-01',
      'total', coalesce((select sum(rate_futuro) from projetado), 0),
      'delta', coalesce((select sum(rate_futuro) - sum(rate_amount) from projetado), 0),
      'newlyBillable', (select count(*) from projetado where rate_amount = 0 and rate_futuro > 0),
      -- Estimada enquanto qualquer tarifa usada na projeção vier de linha
      -- marcada como estimated (rate card de outubro ainda não publicado).
      'estimated', coalesce((
        select bool_or(estimated) from whatsapp_rates
        where effective_from = '2026-10-01' and country_code = 'BR'
      ), true)
    ),
    'ledgerStart', (select min(sent_at) from whatsapp_message_costs where tenant_id = v_tenant)
  ) into v_result;

  return v_result;
end;
$$;


-- Custo por campanha do tenant inteiro, para a lista de campanhas mostrar
-- o valor sem uma chamada por linha.
create or replace function campaign_costs()
returns table (campaign_id uuid, cost numeric)
language sql
stable
security definer
set search_path = public
as $$
  select campaign_id, sum(rate_amount)
  from whatsapp_message_costs
  where tenant_id = my_tenant_id()
    and campaign_id is not null
  group by campaign_id
$$;


-- Custo total de uma campanha — usado por /api/campaigns/[id]/status.
create or replace function campaign_cost(p_campaign_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(rate_amount), 0)
  from whatsapp_message_costs
  where campaign_id = p_campaign_id
    and tenant_id = my_tenant_id()
$$;
