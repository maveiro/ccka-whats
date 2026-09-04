-- ============================================================
-- Migration: 0026_flow_engine_suporte.sql
-- Estruturas que o flow-engine (Trilha A) exige e que a 0025 não criou:
-- a 0025 seguiu a seção "Modelo de dados" do PRD, e estas duas só aparecem
-- no "Fluxo técnico" (passos 0 e 5).
-- PRD: docs/prd/prd-automacao-flows-whatsapp.md
-- ============================================================

-- ============================================================
-- IDEMPOTÊNCIA (passo 0)
-- Reentrega de webhook do Meta é esperada (mesmo raciocínio de
-- recompute_campaign_counters na 0019: nunca incrementar por evento).
-- Sem isto, uma reentrega manda boas-vindas/resposta duas vezes.
--
-- O uso é claim atômico, não consulta-depois-insere: o flow-engine faz
-- `insert ... on conflict do nothing` + `.select()`; retorno vazio significa
-- "outra invocação já pegou esta mensagem" e encerra. Consultar antes de
-- inserir perderia a corrida entre duas entregas simultâneas.
-- ============================================================
create table flow_mensagens_processadas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  message_id  text not null,              -- wamid do WhatsApp
  flow_id     uuid references whatsapp_flows(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint flow_mensagens_processadas_tenant_message_key unique (tenant_id, message_id)
);

create index idx_flow_mensagens_processadas_created on flow_mensagens_processadas (created_at);

alter table flow_mensagens_processadas enable row level security;

-- Só o flow-engine (service role) escreve; leitura humana é de auditoria.
create policy "admin_only" on flow_mensagens_processadas for all using (
  tenant_id = my_tenant_id() and my_role() = 'admin'
);

-- ============================================================
-- LOCK DO GATE DE CADASTRO (passo 5)
-- O PRD sugere "lock consultivo do Postgres por telefone (ou um campo
-- `processando` com timeout curto)". Advisory lock NÃO funciona por aqui:
-- pg_advisory_xact_lock morre no fim da transação (cada chamada PostgREST/RPC
-- é sua própria transação) e o lock de sessão não sobrevive ao pool de
-- conexões do Supabase. Fica a segunda opção — um campo com timeout curto,
-- adquirido por UPDATE condicional, que é atômico num único statement.
--
-- Quem não consegue o lock nunca descarta a mensagem: concatena em
-- mensagem_pendente e sai. A próxima mensagem (ou a que segura o lock)
-- retoma o gate com o texto preservado.
-- ============================================================
alter table clientes add column gate_lock_ate timestamptz;

comment on column clientes.gate_lock_ate is
  'Lock de curta duração do gate de cadastro (passo 5 do fluxo). Ver try_lock_gate().';

-- Adquire o lock se estiver livre ou expirado. Um único UPDATE condicional:
-- duas invocações simultâneas nunca recebem true as duas (a segunda não
-- encontra linha para atualizar, porque a primeira já moveu gate_lock_ate
-- para o futuro).
create or replace function try_lock_gate(
  p_tenant_id uuid,
  p_telefone  text,
  p_segundos  int default 30
)
returns boolean
language sql
security definer
set search_path = public
as $$
  update clientes
  set gate_lock_ate = now() + make_interval(secs => p_segundos)
  where tenant_id = p_tenant_id
    and telefone = p_telefone
    and (gate_lock_ate is null or gate_lock_ate < now())
  returning true;
$$;

-- Libera explicitamente ao terminar o passo do gate — sem isso o próximo
-- turno da conversa esperaria o timeout à toa.
create or replace function unlock_gate(
  p_tenant_id uuid,
  p_telefone  text
)
returns void
language sql
security definer
set search_path = public
as $$
  update clientes
  set gate_lock_ate = null
  where tenant_id = p_tenant_id and telefone = p_telefone;
$$;

-- ============================================================
-- AJUSTE EM set_updated_at() (criada na 0025)
-- Como estava, o trigger sobrescrevia SEMPRE — inclusive quando o UPDATE
-- informava updated_at de propósito. Isso quebra o reset de boas-vindas por
-- 14 dias, que depende de o flow-engine poder gravar o carimbo do turno, e
-- torna o comportamento impossível de testar (qualquer data escrita vira
-- now() na hora).
--
-- Agora: escrita explícita vence; o trigger continua preenchendo automaticamente
-- todo UPDATE que não menciona a coluna — que é a garantia que motivou o
-- trigger (não depender de o flow-engine lembrar).
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  if new.updated_at is distinct from old.updated_at then
    return new; -- quem escreveu sabia o que estava fazendo
  end if;
  new.updated_at = now();
  return new;
end;
$$;
