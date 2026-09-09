-- ============================================================
-- Migration: 0032_keyword_so_em_flow_de_palavra_chave.sql
-- Palavra-chave só faz sentido em Flow do tipo `keyword_automation`.
--
-- O motor procura o Flow ATIVO de tipo keyword_automation do número e lê as
-- keywords DELE. Uma keyword pendurada num Flow `central` ou `agenda_shows`
-- nunca dispara — é configuração morta que parece configuração boa, e a tela
-- ainda mostrava "1 palavra-chave" no card da central.
--
-- Achado em 09/09/2026: a central apareceu na tela de Automações com o editor
-- de palavras-chave, e uma keyword foi cadastrada nela.
-- ============================================================

create or replace function valida_flow_da_palavra_chave()
returns trigger language plpgsql as $$
declare
  tipo_do_flow text;
begin
  select tipo into tipo_do_flow from whatsapp_flows where id = new.flow_id;

  if tipo_do_flow is null then
    raise exception 'flow_id % não existe', new.flow_id;
  end if;

  if tipo_do_flow <> 'keyword_automation' then
    raise exception
      'palavra-chave só pode pertencer a um Flow de palavra-chave (o Flow informado é do tipo %)',
      tipo_do_flow;
  end if;

  return new;
end;
$$;

create trigger flow_palavras_chave_valida_flow
  before insert or update of flow_id on flow_palavras_chave
  for each row execute function valida_flow_da_palavra_chave();
