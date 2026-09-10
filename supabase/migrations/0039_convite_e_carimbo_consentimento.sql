-- ============================================================
-- Migration: 0039_convite_e_carimbo_consentimento.sql
-- Dois acertos vistos no primeiro teste real de ponta a ponta (10/09/2026).
-- ============================================================

-- ============================================================
-- 1. CONVITE DO FLOW
--
-- A mensagem que abre um Flow ia com `whatsapp_flows.nome` no corpo — e `nome`
-- é o rótulo que o admin usa para se achar no painel, não texto escrito para o
-- fã. Na prática o balão chegou com "Central de shows" e um botão, sem dizer o
-- que há do outro lado.
-- ============================================================
alter table whatsapp_flows add column mensagem_convite text;

comment on column whatsapp_flows.mensagem_convite is
  'Corpo da mensagem que oferece o Flow ao contato. Vazio cai em `nome`, que é rótulo interno — preencher sempre que o Flow for visto por um fã.';

-- ============================================================
-- 2. CARIMBO DE CONSENTIMENTO
--
-- `consentimento_em` era reescrito a cada chamada que trazia uma versão, mesmo
-- sendo a MESMA versão. No gate isso já apareceu: o aceite aconteceu ao
-- responder o nome (13:44:09) e o campo terminou marcando a resposta do e-mail
-- (13:44:18). Para auditoria o que vale é quando aquele texto foi aceito pela
-- primeira vez; reforço do mesmo texto não é aceite novo.
--
-- Versão DIFERENTE continua carimbando agora: aí houve mesmo um aceite novo,
-- de um texto novo.
-- ============================================================
create or replace function registrar_cliente(
  p_tenant_id             uuid,
  p_telefone              text,
  p_nome                  text default null,
  p_email                 text default null,
  p_origem                text default 'organico',
  p_consentimento_versao  text default null,
  p_consentimento_origem  text default null
)
returns clientes
language plpgsql
security definer
set search_path = public
as $$
declare
  telefone_norm text;
  chave         text;
  existente     clientes;
  resultado     clientes;
  nome_novo     text;
  email_novo    text;
  trocou_nome   boolean := false;
  trocou_email  boolean := false;
  aceite_novo   boolean := false;
begin
  telefone_norm := normalizar_telefone(p_telefone);
  if telefone_norm is null then
    raise exception 'telefone inválido: %', p_telefone;
  end if;
  chave := chave_telefone(telefone_norm);

  nome_novo  := nullif(btrim(coalesce(p_nome, '')), '');
  email_novo := lower(nullif(btrim(coalesce(p_email, '')), ''));

  select * into existente
  from clientes
  where tenant_id = p_tenant_id and telefone_chave = chave;

  if existente.id is null then
    insert into clientes (
      tenant_id, telefone, nome, email, origem, cadastro_completo,
      consentimento_em, consentimento_versao, consentimento_origem
    ) values (
      p_tenant_id, telefone_norm, nome_novo, email_novo, p_origem,
      (p_origem = 'campanha') or (nome_novo is not null and email_novo is not null),
      case when p_consentimento_versao is not null then now() end,
      p_consentimento_versao,
      p_consentimento_origem
    )
    returning * into resultado;

    insert into events_log (tenant_id, session_id, event_type, payload)
    values (p_tenant_id, null, 'cliente_cadastrado',
            jsonb_build_object('telefone', telefone_norm, 'origem', p_origem,
                               'consentimento', p_consentimento_versao));
    return resultado;
  end if;

  if existente.pii_apagada_em is not null then
    insert into events_log (tenant_id, session_id, event_type, payload)
    values (p_tenant_id, null, 'cliente_cadastro_ignorado_pii_apagada',
            jsonb_build_object('telefone', telefone_norm, 'origem', p_origem));
    return existente;
  end if;

  trocou_nome  := nome_novo  is not null and existente.nome  is distinct from nome_novo;
  trocou_email := email_novo is not null and existente.email is distinct from email_novo;

  -- Aceite novo = versão informada e diferente da que já estava registrada
  -- (inclui o caso de nunca ter havido consentimento nenhum).
  aceite_novo := p_consentimento_versao is not null
             and existente.consentimento_versao is distinct from p_consentimento_versao;

  update clientes set
    nome  = coalesce(nome_novo,  nome),
    email = coalesce(email_novo, email),
    cadastro_completo = cadastro_completo
      or (p_origem = 'campanha')
      or (coalesce(nome_novo, nome) is not null and coalesce(email_novo, email) is not null),
    aguardando_campo = case
      when cadastro_completo
        or (p_origem = 'campanha')
        or (coalesce(nome_novo, nome) is not null and coalesce(email_novo, email) is not null)
      then null else aguardando_campo end,
    consentimento_em     = case when aceite_novo then now() else consentimento_em end,
    consentimento_versao = coalesce(p_consentimento_versao, consentimento_versao),
    consentimento_origem = case when aceite_novo then p_consentimento_origem else consentimento_origem end,
    updated_at = now()
  where id = existente.id
  returning * into resultado;

  if trocou_nome or trocou_email then
    insert into events_log (tenant_id, session_id, event_type, payload)
    values (p_tenant_id, null, 'cliente_dado_atualizado',
            jsonb_build_object('telefone', telefone_norm, 'origem', p_origem,
                               'trocou_nome', trocou_nome, 'trocou_email', trocou_email));
  end if;

  return resultado;
end;
$$;

comment on function registrar_cliente is
  'Porta única de cadastro: normaliza telefone, deduplica pela chave (ignora o nono dígito), preenche lacunas sem sobrescrever com vazio, respeita pii_apagada_em e carimba consentimento apenas quando a VERSÃO aceita muda — reforço do mesmo texto não reescreve a data do aceite.';
