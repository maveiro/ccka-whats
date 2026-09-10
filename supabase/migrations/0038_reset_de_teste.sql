-- ============================================================
-- Migration: 0038_reset_de_teste.sql
-- Comando "/reset" para quem está testando a automação.
--
-- Testar o cadastro exige voltar a ser desconhecido do sistema, e hoje isso
-- depende de alguém apagar linhas à mão no banco. O comando resolve — com um
-- risco óbvio: um fã de verdade digitando "/reset" apagaria o próprio
-- cadastro sem entender o que fez.
--
-- Por isso a autorização mora AQUI, não no motor: a função só age sobre
-- números que estejam explicitamente na lista de teste. Um bug no código do
-- flow-engine não vira apagamento de dado de cliente real.
-- ============================================================

create table numeros_de_teste (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  telefone       text not null,
  telefone_chave text generated always as (chave_telefone(telefone)) stored,
  nota           text,
  created_at     timestamptz not null default now()
);

-- Mesma chave de identidade dos clientes (ignora o nono dígito): cadastrar
-- "41998839193" precisa liberar quem o WhatsApp identifica como "554198839193".
create unique index numeros_de_teste_chave_key on numeros_de_teste (tenant_id, telefone_chave);

alter table numeros_de_teste enable row level security;

create policy "admin_only" on numeros_de_teste for all using (
  tenant_id = my_tenant_id() and my_role() = 'admin'
);

-- ============================================================
-- RESET
--
-- Apaga o cadastro e o estado de conversa daquele número, devolvendo-o à
-- condição de visitante desconhecido. NÃO apaga mensagens: o histórico da
-- conversa é governança e não é dado de teste.
--
-- Devolve false quando o número não está na lista — o motor usa isso para
-- ignorar o comando em silêncio, sem revelar que ele existe.
-- ============================================================
create or replace function resetar_cadastro_teste(p_tenant_id uuid, p_telefone text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  chave      text;
  autorizado boolean;
begin
  chave := chave_telefone(p_telefone);
  if chave is null then return false; end if;

  select exists (
    select 1 from numeros_de_teste
    where tenant_id = p_tenant_id and telefone_chave = chave
  ) into autorizado;

  if not autorizado then return false; end if;

  delete from clientes where tenant_id = p_tenant_id and telefone_chave = chave;
  delete from flow_contato_estado where tenant_id = p_tenant_id and chave_telefone(contato_telefone) = chave;
  delete from flow_sessoes where tenant_id = p_tenant_id and chave_telefone(telefone) = chave;

  insert into events_log (tenant_id, session_id, event_type, payload)
  values (p_tenant_id, null, 'reset_de_teste',
          jsonb_build_object('telefone', chave, 'motivo', 'comando /reset'));

  return true;
end;
$$;

comment on function resetar_cadastro_teste is
  'Devolve um número de teste à condição de desconhecido (apaga cadastro, estado de conversa e sessões de Flow). Só age sobre números listados em numeros_de_teste — a autorização fica no banco para que um bug no motor não apague dado de cliente real.';
