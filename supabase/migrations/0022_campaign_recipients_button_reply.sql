-- ============================================================
-- Migration: 0022_campaign_recipients_button_reply.sql
-- Rastreia clique em QUALQUER botão de template de campanha (não só o de
-- opt-out) — o payload inbound do Meta carrega context.id apontando pro
-- wamid da mensagem original, o que permite ligar o clique de volta ao
-- destinatário exato sem precisar hardcodar o texto de cada botão. Usado
-- pra relatórios tipo "quem clicou 'Já comprei!'", genérico pra qualquer
-- template futuro com botão de quick-reply.
-- ============================================================

alter table campaign_recipients
  add column button_reply text,
  add column button_reply_at timestamptz;
