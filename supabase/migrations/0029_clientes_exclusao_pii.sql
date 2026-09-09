-- ============================================================
-- Migration: 0029_clientes_exclusao_pii.sql
-- Exclusão real de PII em `clientes` — requisito do PRD
-- (docs/prd/prd-automacao-flows-whatsapp.md, "Modelo de dados"), não dívida
-- futura: soft-delete não satisfaz um pedido de exclusão sob LGPD, porque o
-- dado continua existindo.
--
-- O que a ação de admin faz: zera `nome` e `email` (e a mensagem pendente, que
-- é texto livre do titular) e carimba `pii_apagada_em`. `telefone` permanece —
-- é a chave que liga a conversa ao histórico de mensagens, que segue a
-- governança do resto do produto.
--
-- O carimbo não é enfeite: sem ele, o gate de cadastro pediria o nome de novo
-- no próximo contato, revertendo na prática o direito que a pessoa exerceu.
-- ============================================================

alter table clientes
  add column pii_apagada_em timestamptz;

comment on column clientes.pii_apagada_em is
  'Quando os dados pessoais foram apagados a pedido do titular. Preenchido => o gate nunca volta a pedir nome/e-mail.';

create index idx_clientes_pii_apagada on clientes (tenant_id) where pii_apagada_em is not null;
