-- ============================================================
-- Migration: 0033_registrar_cliente.sql
-- Porta única de cadastro de cliente.
--
-- Cadastro chega por muitos canais — gate por chat, formulário do Flow,
-- landing page, painel administrativo, importação de campanha — e cada um
-- reimplementava o mesmo trabalho. O resultado já apareceu em produção
-- (09/09/2026): o gate gravou um cliente real SEM registrar consentimento,
-- porque as colunas de consentimento foram criadas pensando na central e o
-- gate ficou para trás.
--
-- Por que no BANCO e não em TypeScript: as Edge Functions rodam em Deno e o
-- painel em Next, sem módulo compartilhado entre os dois (foi o que obrigou a
-- duplicar o graphClient). O banco é a única camada que ambos enxergam — uma
-- implementação, N chamadores.
-- ============================================================

-- ============================================================
-- NORMALIZAÇÃO DE TELEFONE (Brasil)
--
-- É o ponto que quebra em silêncio: a landing manda "(41) 99999-9999", o
-- WhatsApp identifica "5541999999999". Sem convergir para a mesma chave, a
-- mesma pessoa vira dois cadastros e a central nunca reconhece quem se
-- cadastrou — que é justamente o caso de uso.
-- ============================================================
create or replace function normalizar_telefone(p_telefone text)
returns text
language plpgsql
immutable
as $$
declare
  digitos text;
begin
  if p_telefone is null then return null; end if;

  digitos := regexp_replace(p_telefone, '\D', '', 'g');
  if digitos = '' then return null; end if;

  -- Já veio com DDI 55 e comprimento plausível (12 = fixo, 13 = celular).
  if left(digitos, 2) = '55' and length(digitos) in (12, 13) then
    return digitos;
  end if;

  -- Sem DDI: 10 dígitos (fixo com DDD) ou 11 (celular com DDD).
  if length(digitos) in (10, 11) then
    return '55' || digitos;
  end if;

  -- Qualquer outro formato volta como veio (só dígitos): melhor guardar algo
  -- reconhecível do que descartar um cadastro real por causa do formato.
  return digitos;
end;
$$;

-- ============================================================
-- REGISTRAR CLIENTE
--
-- Regras, todas aprendidas de problemas reais deste projeto:
--   * upsert por (tenant, telefone) — corrida entre duas mensagens quase
--     simultâneas não pode criar dois cadastros;
--   * NÃO sobrescrever dado bom com vazio — um canal que só sabe o telefone
--     não pode apagar o nome que outro já coletou;
--   * valor novo e não-vazio VENCE o antigo (decisão do fundador,
--     09/09/2026), e a troca fica registrada em events_log;
--   * consentimento só é gravado quando a versão é informada — assim não se
--     inventa aceite que não houve;
--   * cliente com pii_apagada_em NUNCA volta a receber nome/e-mail: seria
--     desfazer pela porta dos fundos o direito que a pessoa exerceu.
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
  existente     clientes;
  resultado     clientes;
  nome_novo     text;
  email_novo    text;
  trocou_nome   boolean := false;
  trocou_email  boolean := false;
begin
  telefone_norm := normalizar_telefone(p_telefone);
  if telefone_norm is null then
    raise exception 'telefone inválido: %', p_telefone;
  end if;

  nome_novo  := nullif(btrim(coalesce(p_nome, '')), '');
  email_novo := lower(nullif(btrim(coalesce(p_email, '')), ''));

  select * into existente
  from clientes
  where tenant_id = p_tenant_id and telefone = telefone_norm;

  -- Contato vindo de CAMPANHA já é conhecido do negócio (estava numa lista),
  -- então nunca passa pelo gate de cadastro — regra do PRD da Trilha A. Como é
  -- regra de cadastro, mora aqui e não em cada chamador.
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

  -- Dado apagado a pedido do titular não volta por outro canal.
  if existente.pii_apagada_em is not null then
    insert into events_log (tenant_id, session_id, event_type, payload)
    values (p_tenant_id, null, 'cliente_cadastro_ignorado_pii_apagada',
            jsonb_build_object('telefone', telefone_norm, 'origem', p_origem));
    return existente;
  end if;

  trocou_nome  := nome_novo  is not null and existente.nome  is distinct from nome_novo;
  trocou_email := email_novo is not null and existente.email is distinct from email_novo;

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
    -- Consentimento novo substitui o antigo (é o mais recente que vale para
    -- auditoria); sem versão informada, o registro anterior é preservado.
    consentimento_em     = case when p_consentimento_versao is not null then now() else consentimento_em end,
    consentimento_versao = coalesce(p_consentimento_versao, consentimento_versao),
    consentimento_origem = coalesce(p_consentimento_origem, consentimento_origem),
    updated_at = now()
  where id = existente.id
  returning * into resultado;

  if trocou_nome or trocou_email then
    -- Registra QUE mudou e por qual canal, nunca os valores — o log não é
    -- lugar de guardar PII (mesma regra da exclusão em /api/clientes).
    insert into events_log (tenant_id, session_id, event_type, payload)
    values (p_tenant_id, null, 'cliente_dado_atualizado',
            jsonb_build_object('telefone', telefone_norm, 'origem', p_origem,
                               'trocou_nome', trocou_nome, 'trocou_email', trocou_email));
  end if;

  return resultado;
end;
$$;

comment on function registrar_cliente is
  'Porta única de cadastro: normaliza telefone, deduplica por (tenant, telefone), preenche lacunas sem sobrescrever com vazio, registra consentimento versionado e respeita pii_apagada_em. Chamada por gate, Flow, landing, painel e campanha.';
