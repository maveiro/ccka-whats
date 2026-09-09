-- ============================================================
-- Migration: 0031_abrir_flow_aceita_central.sql
-- O trigger da 0025 só aceitava `agenda_shows` como destino de uma
-- palavra-chave `abrir_flow` — na época era o único tipo que existia.
--
-- Com a Central de Shows (migration 0030, tipo 'central'), a regra passou a
-- barrar exatamente o caso de uso principal: "menu" abrindo a central. O banco
-- recusava com "flow_destino_id deve apontar para um Flow do tipo
-- agenda_shows", e a tela oferecia a central como destino — configuração que
-- parece certa e falha na gravação.
--
-- Achado em 09/09/2026 escrevendo o teste das consultas do painel.
--
-- O que NÃO muda: o destino continua tendo que estar ATIVO e pertencer ao
-- MESMO número. Essas duas regras são o que impede abrir o Flow de outro
-- artista por engano.
-- ============================================================

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
  -- Tipos que representam um Flow publicado na Meta e abrível numa conversa.
  if destino.tipo not in ('agenda_shows', 'central') then
    raise exception 'flow_destino_id deve apontar para um Flow de agenda ou central (recebido: %)', destino.tipo;
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
