-- ============================================================
-- Migration: 0037_chave_telefone.sql
-- O nono dígito brasileiro estava criando cadastros duplicados.
--
-- Achado em produção (10/09/2026) buscando um cliente pelo painel: o telefone
-- digitado como "41998839193" normaliza para 5541998839193 (13 dígitos), mas o
-- WhatsApp identifica a MESMA pessoa como 554198839193 (12 dígitos, sem o 9).
-- A busca não achava — e, pior, um cadastro pela landing com o 9 criaria uma
-- segunda linha para quem já conversava no WhatsApp. Justamente o que a
-- normalização existia para impedir.
--
-- Por que não basta "sempre tirar o 9" ou "sempre pôr o 9": o wa_id do WhatsApp
-- inclui o nono dígito em algumas contas e não em outras (depende de quando o
-- número foi registrado). Não há forma canônica única que sirva para os dois
-- lados — então a identidade passa a ser uma CHAVE que ignora o nono dígito,
-- enquanto `telefone` continua guardando o que cada canal informou.
-- ============================================================

-- 55 + DDD + os 8 últimos dígitos. Tanto 5541998839193 quanto 554198839193
-- resultam em 554198839193 — a mesma pessoa, uma chave só.
create or replace function chave_telefone(p_telefone text)
returns text
language plpgsql
immutable
as $$
declare
  digitos text;
  ddd     text;
begin
  digitos := normalizar_telefone(p_telefone);
  if digitos is null then return null; end if;

  -- Fora do padrão brasileiro (55 + DDD + 8 ou 9): usa como está. Números
  -- internacionais não têm o problema do nono dígito.
  if left(digitos, 2) <> '55' or length(digitos) not in (12, 13) then
    return digitos;
  end if;

  ddd := substr(digitos, 3, 2);
  return '55' || ddd || right(digitos, 8);
end;
$$;

-- Coluna gerada: não há como ficar dessincronizada do telefone.
alter table clientes
  add column telefone_chave text generated always as (chave_telefone(telefone)) stored;

-- A identidade passa a ser a chave. O índice antigo por telefone sai: manter os
-- dois permitiria exatamente a duplicata que esta migration corrige.
alter table clientes drop constraint if exists clientes_tenant_telefone_key;
create unique index clientes_tenant_chave_key on clientes (tenant_id, telefone_chave);

comment on column clientes.telefone_chave is
  'Identidade do cliente, ignorando o nono dígito brasileiro. `telefone` guarda o formato que o canal informou; a chave é o que deduplica.';

-- ============================================================
-- BUSCA POR TELEFONE — uma implementação para os dois runtimes
--
-- Edge Functions (Deno) e painel (Next) não compartilham módulo, e recalcular
-- a chave em TypeScript nos dois lados é como o gate acabou gravando sem
-- consentimento: a mesma regra escrita duas vezes diverge.
-- ============================================================
create or replace function buscar_cliente(p_tenant_id uuid, p_telefone text)
returns clientes
language sql
stable
security definer
set search_path = public
as $$
  select * from clientes
  where tenant_id = p_tenant_id
    and telefone_chave = chave_telefone(p_telefone)
    and deleted_at is null
  limit 1;
$$;

-- ============================================================
-- registrar_cliente passa a deduplicar pela CHAVE
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
    consentimento_em     = case when p_consentimento_versao is not null then now() else consentimento_em end,
    consentimento_versao = coalesce(p_consentimento_versao, consentimento_versao),
    consentimento_origem = coalesce(p_consentimento_origem, consentimento_origem),
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
