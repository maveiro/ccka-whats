-- ============================================================
-- Migration: 0036_central_consentimento.sql
-- Texto e versão do consentimento da CENTRAL, para o cadastro dentro do Flow.
--
-- Mesma razão de FAQ e agenda virarem dado: Flow publicado na Meta é imutável.
-- Texto legal escrito no JSON do Flow só mudaria republicando — e a versão
-- ficaria presa a uma constante no código, que é justamente o que tornaria
-- falso o consentimento já registrado quando alguém trocasse a frase.
--
-- Com o texto aqui, o endpoint envia para a tela e carimba a versão junto no
-- registro. Trocar o texto no painel muda a versão registrada dali em diante.
-- ============================================================

alter table whatsapp_flows
  add column texto_consentimento  text,
  add column versao_consentimento text;

comment on column whatsapp_flows.texto_consentimento is
  'Texto de LGPD mostrado no cadastro dentro do Flow (tipo central). Vem do banco porque Flow publicado é imutável.';
comment on column whatsapp_flows.versao_consentimento is
  'Versão registrada em clientes.consentimento_versao para quem se cadastrar por este Flow. Trocar o texto sem trocar a versão torna falso o consentimento anterior.';
