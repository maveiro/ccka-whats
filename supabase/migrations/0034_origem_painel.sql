-- ============================================================
-- Migration: 0034_origem_painel.sql
-- `clientes.origem` passa a aceitar 'painel'.
--
-- A lista de origens cresceu junto com as portas de cadastro: campanha e
-- organico (Trilha A), landing e flow (0030), e agora painel — cadastro manual
-- feito por um admin. Cada origem existe para auditoria de consentimento: sem
-- ela, não dá para saber por onde o dado entrou nem que texto a pessoa viu.
--
-- Achado ao ligar a primeira porta fora do motor: a rota do painel chamava
-- registrar_cliente com origem 'painel' e o insert batia no check constraint.
-- ============================================================

alter table clientes drop constraint if exists clientes_origem_check;
alter table clientes add constraint clientes_origem_check
  check (origem in ('campanha', 'organico', 'landing', 'flow', 'painel'));
