-- ============================================================
-- Migration: 0025_flows_automacao.sql
-- Automação de resposta por Flow (keyword_automation + agenda_shows).
-- PRD: docs/prd/prd-automacao-flows-whatsapp.md
-- Nota de posicionamento: CLAUDE.md, "Segunda reabertura parcial e
-- consciente (04/09/2026)".
--
-- Aditiva: não altera nenhuma tabela do pipeline Evolution (wa_sessions,
-- messages, chats, contacts, media_files). Escopada a números Cloud API
-- (whatsapp_cloud_credentials), como o módulo de campanhas.
--
-- Convenções aplicadas (decisões desta rodada, divergindo do PRD onde o
-- repo já tinha padrão próprio):
--   * enums são `text` + `check`, nunca `create type` — nenhum enum nativo
--     existe no projeto, e `whatsapp_flows.tipo` é declaradamente extensível
--   * `created_at`/`updated_at` em inglês, como o resto do schema; o
--     vocabulário de domínio (nome, telefone, email, artista...) fica em
--     português
--   * `deleted_at` como coluna, SEM view `<tabela>_ativos` — esse padrão vem
--     do plauz-core e não existe neste repo; filtrar `deleted_at is null` na
--     query, apoiado pelos índices parciais abaixo
--   * triggers de `updated_at`: PRIMEIROS triggers do projeto (até aqui
--     `updated_at` era responsabilidade do app). Justificativa: o reset de
--     boas-vindas por 14 dias lê `flow_contato_estado.updated_at` — deixar
--     isso na mão do flow-engine é uma falha silenciosa esperando acontecer,
--     a classe de bug mais repetida do projeto (regras 10, 12, 13).
--
-- Fora desta migration de propósito: a chave privada do Flow em
-- `internal_secrets` (Trilha B, junto do spike de criptografia) e a ação de
-- exclusão real de PII de `clientes` (rota de admin, Sprint A2).
-- ============================================================

-- ============================================================
-- HELPERS
-- ============================================================

-- Acesso por número, para credenciais Cloud API. Reaproveita
-- has_session_access() (0016) pela ponte criada na 0021:
-- wa_sessions.cloud_credential_id tem índice único, então a credencial
-- resolve para no máximo uma sessão. Um operator restrito que não enxerga o
-- número não enxerga nem edita os Flows dele — mesmo modelo da regra 20,
-- sem inventar um segundo mecanismo de acesso.
-- Credencial sem sessão provisionada ainda: has_session_access(null) devolve
-- true apenas para admin/scope 'all' (o exists interno falha), que é o
-- comportamento desejado.
create or replace function has_cloud_credential_access(p_credential_id uuid)
returns boolean language sql stable security definer as $$
  select has_session_access(
    (select id from wa_sessions where cloud_credential_id = p_credential_id)
  )
$$;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- WHATSAPP_FLOWS
-- Uma automação anexada a um número Cloud API. `artista` é texto escopado
-- por tenant de propósito — não referencia o app "artists" do plauz-core,
-- porque o wa-intelligence é multi-tenant e atende clientes fora da Plauz.
-- ============================================================
create table whatsapp_flows (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  cloud_credential_id   uuid not null references whatsapp_cloud_credentials(id) on delete cascade,
  artista               text,
  nome                  text not null,
  tipo                  text not null
                          check (tipo in ('keyword_automation', 'agenda_shows')),
  ativo                 boolean not null default true,
  mensagem_boas_vindas  text,
  mensagem_fallback     text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

-- "Busca o Flow ativo do número" só faz sentido se a unicidade for garantida
-- pelo banco, não assumida pela lógica (rodada 2 do PRD). O `deleted_at is
-- null` é necessário: sem ele um Flow soft-deletado que ficou `ativo = true`
-- bloquearia a criação do substituto para sempre.
create unique index whatsapp_flows_credencial_tipo_ativo_key
  on whatsapp_flows (cloud_credential_id, tipo)
  where ativo = true and deleted_at is null;

create index idx_whatsapp_flows_tenant on whatsapp_flows (tenant_id) where deleted_at is null;
create index idx_whatsapp_flows_credencial on whatsapp_flows (cloud_credential_id) where deleted_at is null;

alter table whatsapp_flows enable row level security;

-- Policies separadas por comando: admin e operator criam/editam (decisão
-- fechada do PRD), exclusão é admin-only por simetria com sessões (regra 21).
create policy "acesso_por_numero_select" on whatsapp_flows for select using (
  tenant_id = my_tenant_id() and has_cloud_credential_access(cloud_credential_id)
);
create policy "acesso_por_numero_insert" on whatsapp_flows for insert with check (
  tenant_id = my_tenant_id() and has_cloud_credential_access(cloud_credential_id)
);
create policy "acesso_por_numero_update" on whatsapp_flows for update
  using (tenant_id = my_tenant_id() and has_cloud_credential_access(cloud_credential_id))
  with check (tenant_id = my_tenant_id() and has_cloud_credential_access(cloud_credential_id));
create policy "admin_delete" on whatsapp_flows for delete using (
  tenant_id = my_tenant_id() and my_role() = 'admin'
);

create trigger whatsapp_flows_set_updated_at
  before update on whatsapp_flows
  for each row execute function set_updated_at();

-- ============================================================
-- FLOW_PALAVRAS_CHAVE
-- tenant_id explícito (regra 1 do CLAUDE.md: "em toda tabela, sem exceção" —
-- depender de join através de whatsapp_flows para filtrar tenant no RLS é
-- justamente o desvio que a regra existe para evitar).
-- ============================================================
create table flow_palavras_chave (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  flow_id         uuid not null references whatsapp_flows(id) on delete cascade,
  palavra_chave   text not null,
  tipo_resposta   text not null
                    check (tipo_resposta in ('texto', 'link', 'abrir_flow')),
  resposta        text,
  flow_destino_id uuid references whatsapp_flows(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  -- Coerência entre tipo_resposta e os campos que ele usa: 'abrir_flow'
  -- precisa de destino e não usa `resposta`; 'texto'/'link' são o inverso.
  constraint flow_palavras_chave_resposta_coerente check (
    (tipo_resposta = 'abrir_flow' and flow_destino_id is not null and resposta is null)
    or (tipo_resposta in ('texto', 'link') and resposta is not null and flow_destino_id is null)
  )
);

-- Duas keywords idênticas no mesmo Flow tornariam o match não-determinístico
-- (qual resposta ganha depende da ordem de leitura). lower() porque o
-- flow-engine compara sem diferenciar maiúscula.
create unique index flow_palavras_chave_flow_palavra_key
  on flow_palavras_chave (flow_id, lower(palavra_chave))
  where deleted_at is null;

create index idx_flow_palavras_chave_flow on flow_palavras_chave (flow_id) where deleted_at is null;
create index idx_flow_palavras_chave_tenant on flow_palavras_chave (tenant_id) where deleted_at is null;

alter table flow_palavras_chave enable row level security;

create policy "acesso_por_numero_select" on flow_palavras_chave for select using (
  tenant_id = my_tenant_id() and exists (
    select 1 from whatsapp_flows f
    where f.id = flow_palavras_chave.flow_id
      and has_cloud_credential_access(f.cloud_credential_id)
  )
);
create policy "acesso_por_numero_insert" on flow_palavras_chave for insert with check (
  tenant_id = my_tenant_id() and exists (
    select 1 from whatsapp_flows f
    where f.id = flow_palavras_chave.flow_id
      and has_cloud_credential_access(f.cloud_credential_id)
  )
);
create policy "acesso_por_numero_update" on flow_palavras_chave for update
  using (
    tenant_id = my_tenant_id() and exists (
      select 1 from whatsapp_flows f
      where f.id = flow_palavras_chave.flow_id
        and has_cloud_credential_access(f.cloud_credential_id)
    )
  )
  with check (
    tenant_id = my_tenant_id() and exists (
      select 1 from whatsapp_flows f
      where f.id = flow_palavras_chave.flow_id
        and has_cloud_credential_access(f.cloud_credential_id)
    )
  );
create policy "admin_delete" on flow_palavras_chave for delete using (
  tenant_id = my_tenant_id() and my_role() = 'admin'
);

create trigger flow_palavras_chave_set_updated_at
  before update on flow_palavras_chave
  for each row execute function set_updated_at();

-- Validação de flow_destino_id: precisa apontar para um Flow ATIVO, do tipo
-- 'agenda_shows', no MESMO cloud_credential_id — nunca de outro número.
-- Não cabe em check constraint (cruza linhas de outra tabela), então é
-- trigger e não só validação de aplicação: `abrir_flow` fica bloqueado até a
-- Trilha B entregar a mensagem interativa com token de Flow, e descobrir um
-- destino inválido em produção sai mais caro que a constraint.
create or replace function valida_flow_destino()
returns trigger language plpgsql as $$
declare
  origem_credencial uuid;
  destino record;
begin
  if new.flow_destino_id is null then
    return new;
  end if;

  select cloud_credential_id into origem_credencial
  from whatsapp_flows where id = new.flow_id;

  select tipo, ativo, deleted_at, cloud_credential_id into destino
  from whatsapp_flows where id = new.flow_destino_id;

  if not found then
    raise exception 'flow_destino_id % não existe', new.flow_destino_id;
  end if;
  if destino.tipo <> 'agenda_shows' then
    raise exception 'flow_destino_id deve apontar para um Flow do tipo agenda_shows (recebido: %)', destino.tipo;
  end if;
  if destino.ativo is not true or destino.deleted_at is not null then
    raise exception 'flow_destino_id deve apontar para um Flow ativo';
  end if;
  if destino.cloud_credential_id is distinct from origem_credencial then
    raise exception 'flow_destino_id deve pertencer ao mesmo número (cloud_credential_id) do Flow de origem';
  end if;

  return new;
end;
$$;

create trigger flow_palavras_chave_valida_destino
  before insert or update on flow_palavras_chave
  for each row execute function valida_flow_destino();

-- ============================================================
-- CLIENTES
-- Base própria de contatos, tenant-wide (não presa a um Flow) — embrião do
-- CRM. Guarda PII (nome, email): a listagem geral é admin-only; operator vê
-- dado de cliente só no contexto de uma conversa a que já tem acesso, via
-- messages/chats (já restritos por sessão pela regra 20).
-- ============================================================
create table clientes (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id) on delete cascade,
  nome                      text,
  email                     text,
  telefone                  text not null,          -- E.164, chave de dedupe
  origem                    text not null
                              check (origem in ('campanha', 'organico')),
  cadastro_completo         boolean not null default false,
  aguardando_campo          text
                              check (aguardando_campo in ('nome', 'email')),
  tentativas_campo_atual    smallint not null default 0
                              check (tentativas_campo_atual >= 0),
  pulou_cadastro            boolean not null default false,
  gate_iniciado_por_flow_id uuid references whatsapp_flows(id) on delete set null,
  mensagem_pendente         text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,

  -- Constraint de verdade (não índice parcial): o flow-engine faz
  -- `on conflict (tenant_id, telefone)` para vencer a corrida entre duas
  -- mensagens quase simultâneas do mesmo telefone (rodada 2 do PRD), e
  -- ON CONFLICT precisa de um constraint/índice total para inferir.
  constraint clientes_tenant_telefone_key unique (tenant_id, telefone),

  -- Cadastro completo e gate aberto ao mesmo tempo é estado impossível.
  constraint clientes_gate_coerente check (
    (cadastro_completo = true and aguardando_campo is null)
    or (cadastro_completo = false)
  )
);

-- Fila do gate: quem ainda não completou cadastro.
create index idx_clientes_gate_aberto on clientes (tenant_id)
  where cadastro_completo = false and deleted_at is null;

alter table clientes enable row level security;

-- admin_only (proposta padrão do PRD, confirmada): sem tela de listagem
-- geral para operator — evita expor nome/email de fãs de um artista para
-- quem só deveria ver outro número. O flow-engine roda com service role e
-- não passa por esta policy; por isso mesmo a regra de isolamento do PRD
-- exige `.eq('tenant_id', ...)` explícito em toda query dele.
create policy "admin_only" on clientes for all using (
  tenant_id = my_tenant_id() and my_role() = 'admin'
);

create trigger clientes_set_updated_at
  before update on clientes
  for each row execute function set_updated_at();

-- ============================================================
-- FLOW_CONTATO_ESTADO
-- Estado por (Flow, telefone). Sem deleted_at: é estado operacional
-- efêmero, não registro de domínio.
-- ============================================================
create table flow_contato_estado (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id) on delete cascade,
  flow_id                   uuid not null references whatsapp_flows(id) on delete cascade,
  contato_telefone          text not null,
  recebeu_boas_vindas       boolean not null default false,
  fallbacks_consecutivos    smallint not null default 0
                              check (fallbacks_consecutivos >= 0),
  pausado_aguardando_humano boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- O flow-engine faz upsert por esta chave a cada mensagem recebida;
  -- sem o unique, o estado duplica e o reset de 14 dias passa a ler a linha
  -- errada.
  constraint flow_contato_estado_flow_telefone_key unique (flow_id, contato_telefone)
);

create index idx_flow_contato_estado_telefone on flow_contato_estado (tenant_id, contato_telefone);

alter table flow_contato_estado enable row level security;

create policy "acesso_por_numero" on flow_contato_estado for all using (
  tenant_id = my_tenant_id() and exists (
    select 1 from whatsapp_flows f
    where f.id = flow_contato_estado.flow_id
      and has_cloud_credential_access(f.cloud_credential_id)
  )
);

-- updated_at aqui não é metadado: é o relógio do reset de boas-vindas por
-- 14 dias de inatividade (decisão fechada do PRD). Por isso o trigger.
create trigger flow_contato_estado_set_updated_at
  before update on flow_contato_estado
  for each row execute function set_updated_at();

-- ============================================================
-- AGENDA_SHOWS_SYNC
-- V1: preenchida manualmente pela tela de gestão de Flows.
-- V2: mesma tabela, preenchida por job de sincronização a partir do
-- painel-shows — o endpoint do Flow não muda nada.
-- Lida pelo endpoint dinâmico do WhatsApp Flow, que tem teto de latência da
-- Meta: nunca consultar painel-shows/monday/Sympla ao vivo aqui.
-- ============================================================
create table agenda_shows_sync (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  show_id_origem  text,             -- referência ao painel-shows; nulo na V1
  artista         text not null,
  cidade          text,
  teatro          text,
  data_show       timestamptz,
  status_venda    text,
  link_compra     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Chave de upsert do job da V2. Parcial: na V1 show_id_origem é nulo e
-- várias linhas manuais coexistem sem conflito.
create unique index agenda_shows_sync_origem_key
  on agenda_shows_sync (tenant_id, show_id_origem)
  where show_id_origem is not null;

-- Exatamente a query do endpoint do Flow (agenda do artista por data).
create index idx_agenda_shows_sync_consulta
  on agenda_shows_sync (tenant_id, artista, data_show);

alter table agenda_shows_sync enable row level security;

-- Agenda é dado de artista, não de número: não faz sentido escopar por
-- sessão. Leitura para todo o tenant; escrita para admin e operator (mesmo
-- par que administra Flows).
create policy "tenant_read" on agenda_shows_sync for select using (
  tenant_id = my_tenant_id()
);
create policy "gestao_insert" on agenda_shows_sync for insert with check (
  tenant_id = my_tenant_id() and my_role() in ('admin', 'operator')
);
create policy "gestao_update" on agenda_shows_sync for update
  using (tenant_id = my_tenant_id() and my_role() in ('admin', 'operator'))
  with check (tenant_id = my_tenant_id() and my_role() in ('admin', 'operator'));
create policy "admin_delete" on agenda_shows_sync for delete using (
  tenant_id = my_tenant_id() and my_role() = 'admin'
);

create trigger agenda_shows_sync_set_updated_at
  before update on agenda_shows_sync
  for each row execute function set_updated_at();
