-- ============================================================
-- Migration: 0030_central_de_shows.sql
-- Fundação da Central de Shows (Sprint C1).
-- PRD: docs/prd/prd-central-de-shows.md
--
-- Uma central por artista: agenda + FAQ num Flow permanente, com identidade do
-- visitante resolvida por sessão.
-- ============================================================

-- ============================================================
-- IDENTIDADE DENTRO DO FLOW
--
-- A requisição que a Meta faz ao endpoint do Flow traz `version`, `action`,
-- `screen`, `data` e `flow_token` — NUNCA o telefone do usuário. Sem persistir
-- a associação, "quem já tem cadastro vê o menu" é impossível de implementar.
--
-- Nós sempre sabemos o telefone no momento do envio (não existe Flow aberto
-- sem uma mensagem nossa antes), então a sessão é sempre preenchível. O token é
-- ALEATÓRIO: embutir o telefone nele faria PII trafegar pelo aparelho num campo
-- que não controlamos.
--
-- Escolhida em vez de token cifrado auto-contido por dois motivos: dá trilha de
-- auditoria (quem abriu a central, quando, por qual campanha) e permite
-- revogar antes da expiração.
-- ============================================================
create table flow_sessoes (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  token                text not null unique,
  telefone             text not null,              -- E.164, mesma chave de clientes
  flow_id              uuid references whatsapp_flows(id) on delete set null,
  cloud_credential_id  uuid references whatsapp_cloud_credentials(id) on delete cascade,
  origem               text,                       -- campanha | keyword | manual
  created_at           timestamptz not null default now(),
  expira_em            timestamptz not null default now() + interval '30 days'
);

create index idx_flow_sessoes_telefone on flow_sessoes (tenant_id, telefone);
create index idx_flow_sessoes_expira on flow_sessoes (expira_em);

alter table flow_sessoes enable row level security;

-- Só o endpoint (service role) lê/escreve; leitura humana é auditoria.
create policy "admin_only" on flow_sessoes for all using (
  tenant_id = my_tenant_id() and my_role() = 'admin'
);

-- ============================================================
-- FAQ COMO DADO
--
-- Flow publicado é imutável: FAQ dentro do JSON obrigaria a republicar na Meta
-- a cada correção de texto. Vindo do banco, edita-se na nossa tela.
--
-- A mesma tabela passa a poder alimentar as respostas de palavra-chave da
-- Trilha A (hoje digitadas à parte em flow_palavras_chave) — uma fonte, dois
-- canais.
-- ============================================================
create table faq_itens (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  artista     text,                    -- nulo = vale para todos os artistas do tenant
  pergunta    text not null,
  resposta    text not null,
  ordem       int not null default 0,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index idx_faq_itens_consulta on faq_itens (tenant_id, artista, ordem)
  where ativo = true and deleted_at is null;

alter table faq_itens enable row level security;

-- Mesma regra da agenda: leitura para o tenant, escrita para admin e operator,
-- exclusão admin-only. FAQ é conteúdo da automação, não credencial.
create policy "tenant_read" on faq_itens for select using (
  tenant_id = my_tenant_id()
);
create policy "gestao_insert" on faq_itens for insert with check (
  tenant_id = my_tenant_id() and my_role() in ('admin', 'operator')
);
create policy "gestao_update" on faq_itens for update
  using (tenant_id = my_tenant_id() and my_role() in ('admin', 'operator'))
  with check (tenant_id = my_tenant_id() and my_role() in ('admin', 'operator'));
create policy "admin_delete" on faq_itens for delete using (
  tenant_id = my_tenant_id() and my_role() = 'admin'
);

create trigger faq_itens_set_updated_at
  before update on faq_itens
  for each row execute function set_updated_at();

-- ============================================================
-- CONSENTIMENTO VERSIONADO EM `clientes`
--
-- Sem guardar QUAL texto a pessoa aceitou, o texto legal na tela vira enfeite:
-- quando ele mudar, não há como saber a que cada um consentiu. É o complemento
-- da exclusão real de PII (migration 0029).
-- ============================================================
alter table clientes
  add column consentimento_em      timestamptz,
  add column consentimento_versao  text,
  add column consentimento_origem  text;

comment on column clientes.consentimento_versao is
  'Identificador do texto legal aceito (ex: "v1-2026-09"). Sem isto não há como auditar consentimento após uma mudança de texto.';

-- `origem` ganha duas procedências: landing (formulário do site) e flow
-- (cadastro dentro da central). Distinguir importa para auditoria de
-- consentimento.
alter table clientes drop constraint if exists clientes_origem_check;
alter table clientes add constraint clientes_origem_check
  check (origem in ('campanha', 'organico', 'landing', 'flow'));

-- ============================================================
-- TIPO DE FLOW `central`
-- O índice único (cloud_credential_id, tipo) WHERE ativo continua valendo:
-- uma central ativa por número.
-- ============================================================
alter table whatsapp_flows drop constraint if exists whatsapp_flows_tipo_check;
alter table whatsapp_flows add constraint whatsapp_flows_tipo_check
  check (tipo in ('keyword_automation', 'agenda_shows', 'central'));
