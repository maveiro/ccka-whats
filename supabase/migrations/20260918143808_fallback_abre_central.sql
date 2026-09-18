-- ============================================================
-- Resposta padrão pode abrir a central, não só mandar texto.
--
-- Pedido do fundador (18/09/2026): "para qualquer interação do cliente eu
-- poderia responder com um texto e chamando a central de shows, sem depender
-- de palavra-chave?".
--
-- O caminho já existia pela metade: quando nenhuma palavra-chave bate, o
-- motor manda `mensagem_fallback`. Agora ele pode abrir um Flow junto.
--
-- O que NÃO muda, de propósito:
--
--   * palavra-chave continua tendo prioridade — quem escreve "ingresso"
--     recebe a resposta específica, não o balão genérico;
--   * a PAUSA por 3 fallbacks consecutivos continua valendo. Ela existe para
--     o robô calar quando claramente não está ajudando, e abrir a central
--     indefinidamente seria exatamente a repetição que ela impede — com o
--     agravante de balão interativo chamar mais atenção que texto.
-- ============================================================

alter table whatsapp_flows
  add column fallback_flow_destino_id uuid references whatsapp_flows(id) on delete set null;

comment on column whatsapp_flows.fallback_flow_destino_id is
  'Flow aberto junto da mensagem_fallback quando nenhuma palavra-chave bate. Null = fallback só de texto. Sujeito à pausa por fallbacks consecutivos.';

-- ============================================================
-- MESMAS TRÊS REGRAS DO DESTINO DE PALAVRA-CHAVE
--
-- Tipo abrível, ativo e MESMO número — idênticas às de valida_flow_destino
-- (0031), e pelos mesmos motivos. A do número é a que importa: abrir a
-- central de outro artista entregaria a agenda errada, e a Graph API
-- aceitaria sem reclamar.
--
-- Mais uma que só existe aqui: um Flow não pode ser o próprio fallback. Seria
-- um Flow de palavra-chave se oferecendo, o que não faz sentido nenhum e
-- geraria balão de um Flow sem `meta_flow_id`.
-- ============================================================
create or replace function valida_fallback_destino()
returns trigger language plpgsql as $$
declare
  destino record;
begin
  if new.fallback_flow_destino_id is null then
    return new;
  end if;

  if new.fallback_flow_destino_id = new.id then
    raise exception 'um Flow não pode ser o destino do próprio fallback';
  end if;

  select tipo, ativo, deleted_at, cloud_credential_id, meta_flow_id
    into destino
    from whatsapp_flows where id = new.fallback_flow_destino_id;

  if not found then
    raise exception 'fallback_flow_destino_id % não existe', new.fallback_flow_destino_id;
  end if;
  if destino.tipo not in ('agenda_shows', 'central') then
    raise exception 'o fallback só pode abrir Flow de agenda ou central (recebido: %)', destino.tipo;
  end if;
  if destino.ativo is not true or destino.deleted_at is not null then
    raise exception 'o Flow do fallback precisa estar ativo';
  end if;
  if destino.cloud_credential_id is distinct from new.cloud_credential_id then
    raise exception 'o Flow do fallback precisa ser do mesmo número (cloud_credential_id)';
  end if;

  return new;
end;
$$;

create trigger valida_fallback_destino_trigger
  before insert or update of fallback_flow_destino_id, cloud_credential_id on whatsapp_flows
  for each row execute function valida_fallback_destino();
