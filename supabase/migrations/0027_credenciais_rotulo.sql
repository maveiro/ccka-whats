-- ============================================================
-- Migration: 0027_credenciais_rotulo.sql
-- Cadastro self-service de número Cloud API (Sprint A2 do PRD
-- docs/prd/prd-automacao-flows-whatsapp.md): "nome amigável do número,
-- associação a artista".
--
-- Atenção ao numerário: supabase/tests/0027_* e 0028_* são arquivos de TESTE,
-- não migrations — a convenção de nomear o teste pelo número da migration que
-- ele cobre valeu até a 0026 e se perdeu depois. Esta é a migration 0027, e
-- não tem relação com o teste 0027.
--
-- Por que na credencial e não em wa_sessions.label: a credencial é a
-- identidade do número (o webhook resolve por phone_number_id -> credencial);
-- a sessão é a caixa de entrada dele. Um rótulo em wa_sessions morreria se a
-- sessão fosse recriada, e não estaria disponível onde a UI de campanhas e de
-- Flows escolhe o número.
-- ============================================================

alter table whatsapp_cloud_credentials
  add column label   text,
  add column artista text;

comment on column whatsapp_cloud_credentials.label is
  'Nome amigável do número na UI (ex: "Comercial — turnê 2026"). Cai para display_phone_number quando nulo.';
comment on column whatsapp_cloud_credentials.artista is
  'Artista dono deste número, texto escopado por tenant — mesma razão de whatsapp_flows.artista não referenciar o app "artists" do plauz-core: o wa-intelligence é multi-tenant e atende clientes fora da Plauz.';
