-- Qual tela o Flow espera receber na abertura.
--
-- O endpoint é um só para todos os Flows do mesmo número (mesma chave, mesmo
-- tenant), e no `INIT` a Meta não diz QUAL Flow foi aberto — manda só o
-- flow_token. Até aqui, a regra era "se o número tem central, INIT é da
-- central", o que basta enquanto há um Flow abrível por número.
--
-- Deixa de bastar com o Flow paralelo de avaliação (lista em Dropdown, telas
-- AGENDA_LONGA/DETALHE_LONGO): os dois convivem no mesmo número, e sem esta coluna
-- abrir o paralelo devolveria a apresentação da central — sem erro, só a tela
-- errada. A sessão (flow_sessoes.flow_id) diz qual Flow é; esta coluna diz
-- por onde ele começa.
--
-- Null = comportamento de sempre. Nenhum Flow existente muda.
alter table whatsapp_flows
  add column if not exists tela_inicial text;

comment on column whatsapp_flows.tela_inicial is
  'Tela devolvida no INIT deste Flow (ex.: AGENDA_LONGA). Null usa a regra padrão: central quando o número tem central, agenda quando não tem.';
