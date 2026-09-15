-- ============================================================
-- Migration: 20260915112526_campanha_abre_flow.sql
-- Sprint C4 da Central de Shows: uma campanha cujo template tem botão de
-- FLOW abre a central já sabendo quem é a pessoa.
-- PRD: docs/prd/prd-central-de-shows.md
--
-- Por que precisa de schema novo: a Meta NUNCA manda o telefone para o
-- flow-endpoint (regra 28 do CLAUDE.md) — quem é a pessoa vem de
-- `flow_sessoes`, encontrada pelo `flow_token`. No caminho de palavra-chave
-- o flow-engine cria a sessão no momento em que oferece o Flow; no caminho
-- de campanha não existia nada equivalente, então cada destinatário abriria
-- a central como desconhecido e cairia no cadastro — o pior resultado
-- possível para uma base que JÁ está cadastrada.
--
-- Duas peças: de qual Flow nosso é o botão do template (campaigns.flow_id) e
-- qual token pertence a cada destinatário (campaign_recipients.flow_token).
-- ============================================================

-- Qual Flow NOSSO corresponde ao botão do template.
--
-- O Flow da Meta está congelado dentro do template (o botão carrega o
-- `flow_id` publicado); esta coluna é o outro lado da ponte — é dela que
-- saem o `whatsapp_flows.id` e a credencial gravados em `flow_sessoes`, e
-- sem isso o endpoint não saberia de qual central é a sessão.
--
-- `on delete restrict`: apagar o Flow deixaria campanha enviada sem como
-- reconstruir o que o fã abriu. Mesmo espírito da FK que já impede apagar
-- um Flow que é destino de palavra-chave ("Armadilhas já pagas" no
-- CLAUDE.md) — a campanha sai primeiro, o Flow depois.
alter table campaigns
  add column flow_id uuid references whatsapp_flows(id) on delete restrict;

comment on column campaigns.flow_id is
  'Flow (whatsapp_flows) que o botão de FLOW do template abre. Null em campanha sem botão de Flow.';

-- Token por destinatário, gerado pelo BANCO via default — mesma decisão do
-- click_token (migration campanhas_clique_rastreado) e pelos mesmos dois
-- motivos: há mais de um caminho de criação de destinatário, e
-- gen_random_uuid() é do pg_catalog, então o default não depende de
-- search_path (regra 35).
--
-- UUID aleatório, nunca derivado do telefone: o token trafega pelo aparelho
-- do fã dentro do Flow, e telefone ali seria PII num campo que não
-- controlamos (regra 28).
--
-- Existe para TODO destinatário, inclusive de campanha sem Flow: uma coluna
-- nullable preenchida só num caminho é exatamente onde nasce a falha
-- silenciosa. `flow_sessoes` só é criada no envio, e só quando há Flow.
alter table campaign_recipients
  add column flow_token uuid not null default gen_random_uuid();

comment on column campaign_recipients.flow_token is
  'Token que liga este destinatário à sessão em flow_sessoes quando o template abre um Flow. Sempre preenchido; só vira sessão no envio.';

-- ============================================================
-- VALIDAÇÃO DO FLOW ESCOLHIDO
--
-- Mesmas três regras que valida_flow_destino() (0031) aplica a uma
-- palavra-chave, pelos mesmos motivos: tipo abrível, ativo e MESMO número.
-- A do número é a que importa aqui — campanha disparada pelo número do
-- artista A abrindo a central do artista B é erro de cadastro que a Graph
-- API aceitaria sem reclamar, entregando a agenda errada para a base
-- inteira.
--
-- Trigger e não check: as regras moram em outra tabela.
-- ============================================================
create or replace function valida_campanha_flow()
returns trigger language plpgsql as $$
declare
  destino record;
begin
  if new.flow_id is null then
    return new;
  end if;

  select tipo, ativo, deleted_at, tenant_id, cloud_credential_id
    into destino
    from whatsapp_flows where id = new.flow_id;

  if not found then
    raise exception 'flow_id % não existe', new.flow_id;
  end if;
  if destino.tenant_id is distinct from new.tenant_id then
    raise exception 'flow_id deve pertencer ao mesmo tenant da campanha';
  end if;
  -- Tipos que representam um Flow publicado na Meta e abrível numa conversa
  -- (mesma lista da 0031).
  if destino.tipo not in ('agenda_shows', 'central') then
    raise exception 'flow_id deve apontar para um Flow de agenda ou central (recebido: %)', destino.tipo;
  end if;
  if destino.ativo is not true or destino.deleted_at is not null then
    raise exception 'flow_id deve apontar para um Flow ativo';
  end if;
  if destino.cloud_credential_id is distinct from new.credential_id then
    raise exception 'flow_id deve pertencer ao mesmo número (credential_id) da campanha';
  end if;

  return new;
end;
$$;

create trigger valida_campanha_flow_trigger
  before insert or update of flow_id, credential_id on campaigns
  for each row execute function valida_campanha_flow();
