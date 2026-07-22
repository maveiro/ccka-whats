-- 0016_operator_session_access.sql
-- Governança de acesso por número: admin sempre vê todas as sessões do tenant;
-- um operador pode ser restrito a um subconjunto específico (many-to-many).
--
-- Achado na auditoria: a única tentativa anterior de RLS por sessão
-- (`operator_own_session` em messages, 0001_initial.sql) nunca funcionou — Postgres
-- combina múltiplas policies permissivas com OR, e como `tenant_isolation` já libera
-- acesso irrestrito ao tenant inteiro, a policy por sessão nunca chegava a restringir
-- nada. Esta migration substitui (não soma) as policies afetadas, evitando repetir o
-- bug.

-- Escopo padrão do operador: 'all' preserva o comportamento atual — ninguém perde
-- acesso no deploy, restrição é opt-in por operador.
alter table operators
  add column if not exists session_scope text not null default 'all'
  check (session_scope in ('all', 'restricted'));

create table operator_session_access (
  operator_id  uuid not null references operators(id) on delete cascade,
  session_id   uuid not null references wa_sessions(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  created_at   timestamptz default now(),
  primary key (operator_id, session_id)
);

create index idx_operator_session_access_operator on operator_session_access(operator_id);
create index idx_operator_session_access_session  on operator_session_access(session_id);

alter table operator_session_access enable row level security;

create policy "admin_manage" on operator_session_access for all using (
  tenant_id = my_tenant_id() and my_role() = 'admin'
);
create policy "operator_read_own" on operator_session_access for select using (
  operator_id = auth.uid()
);

-- Reaproveitada pelas 4 policies abaixo — mesmo padrão security definer de
-- my_tenant_id()/my_role(), pra não recursar nem depender da RLS do caller.
create or replace function has_session_access(p_session_id uuid)
returns boolean language sql stable security definer as $$
  select
    my_role() = 'admin'
    or (select session_scope from operators where id = auth.uid()) = 'all'
    or exists (
      select 1 from operator_session_access
      where operator_id = auth.uid() and session_id = p_session_id
    )
$$;

drop policy "tenant_isolation" on wa_sessions;
create policy "tenant_and_session_scope" on wa_sessions for all using (
  tenant_id = my_tenant_id() and has_session_access(id)
);

drop policy "tenant_isolation" on chats;
create policy "tenant_and_session_scope" on chats for all using (
  tenant_id = my_tenant_id() and has_session_access(session_id)
);

drop policy "tenant_isolation" on messages;
drop policy "operator_own_session" on messages; -- morta (ver nota acima), substituída
create policy "tenant_and_session_scope" on messages for all using (
  tenant_id = my_tenant_id() and has_session_access(session_id)
);

drop policy "tenant_isolation" on media_files;
create policy "tenant_and_session_scope" on media_files for all using (
  tenant_id = my_tenant_id() and has_session_access(
    (select session_id from messages where id = media_files.message_id)
  )
);
