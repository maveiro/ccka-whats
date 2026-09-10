-- ============================================================
-- Migration: 0035_formularios_cadastro.sql
-- Formulários de cadastro criados no painel e embutidos em qualquer site.
--
-- Decisão do fundador (10/09/2026): em vez de uma rota pública genérica com
-- chave por tenant, o painel cria FORMULÁRIOS. Cada um é uma linha aqui, com
-- seu próprio texto de consentimento e versão — e isso resolve de graça o
-- problema que vinha atrás: o carimbo de consentimento deixa de ser constante
-- no código (como `gate-v1-2026-09` e `painel-v1-2026-09`) e passa a ser dado
-- do formulário. Trocar o texto na tela já muda a versão registrada.
--
-- Duas formas de usar a MESMA definição:
--   * <iframe src="/f/{slug}">  — zero código na landing
--   * POST /api/public/cadastro/{slug} — formulário próprio, no design do site
--
-- Sobre segurança: formulário público é público. Não há segredo a proteger
-- (uma chave estaria no HTML da página). A defesa é limite por IP, honeypot,
-- lista de domínios, resposta sempre idêntica e poder desligar o formulário.
-- O estrago possível é lixo na base, não vazamento — e por isso `ativo` e
-- `dominios_permitidos` existem.
-- ============================================================

create table formularios_cadastro (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  slug                  text not null,
  nome                  text not null,
  artista               text,

  -- Conteúdo mostrado a quem preenche
  titulo                text not null default 'Cadastre-se',
  descricao             text,
  texto_consentimento   text not null,
  versao_consentimento  text not null,
  mensagem_sucesso      text not null default 'Pronto! Seu cadastro foi confirmado.',

  -- Campos fixos nesta versão (nome, e-mail, telefone); só a obrigatoriedade
  -- varia. Construtor de campos genérico é outro projeto, e o dado que a
  -- central usa é esse.
  exige_nome            boolean not null default true,
  exige_email           boolean not null default true,

  -- Vazio = qualquer origem. Preenchido, só estes domínios podem enviar pelo
  -- navegador (o Referer/Origin é conferido); não impede um script fora do
  -- navegador, e por isso não é a única defesa.
  dominios_permitidos   text[] not null default '{}',

  ativo                 boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,

  constraint formularios_cadastro_slug_key unique (slug)
);

-- Slug entra na URL pública: sem espaço, sem acento, minúsculo.
alter table formularios_cadastro add constraint formularios_cadastro_slug_formato
  check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$');

create index idx_formularios_tenant on formularios_cadastro (tenant_id) where deleted_at is null;

alter table formularios_cadastro enable row level security;

-- Leitura para o tenant; escrita admin-only (o formulário define o texto legal
-- que será mostrado a terceiros e a versão que fica registrada no consentimento
-- — não é conteúdo operacional como FAQ ou agenda).
create policy "tenant_read" on formularios_cadastro for select using (
  tenant_id = my_tenant_id()
);
create policy "admin_write" on formularios_cadastro for all using (
  tenant_id = my_tenant_id() and my_role() = 'admin'
);

create trigger formularios_cadastro_set_updated_at
  before update on formularios_cadastro
  for each row execute function set_updated_at();

-- ============================================================
-- CONTROLE DE ABUSO
-- Uma linha por envio aceito, para limitar por IP sem depender de
-- infraestrutura externa. Guarda hash do IP, não o IP: é dado pessoal, e o que
-- precisamos é contar, não identificar.
-- ============================================================
create table formulario_envios (
  id             uuid primary key default gen_random_uuid(),
  formulario_id  uuid not null references formularios_cadastro(id) on delete cascade,
  ip_hash        text not null,
  created_at     timestamptz not null default now()
);

create index idx_formulario_envios_janela on formulario_envios (formulario_id, ip_hash, created_at);

alter table formulario_envios enable row level security;
create policy "admin_only" on formulario_envios for all using (false) with check (false);

comment on table formulario_envios is
  'Registro mínimo para limite por IP. Guarda hash do IP (contar, não identificar) e é limpo por janela de tempo.';
