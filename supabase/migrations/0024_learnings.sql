-- ============================================================
-- Migration: 0024_learnings.sql
-- Registro de aprendizados operacionais (bugs reais encontrados em
-- produção, decisões, achados de comportamento externo como Meta/Graph
-- API) — página própria no app, não fica só em CLAUDE.md/commits.
-- ============================================================

create table learnings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  created_by  uuid references operators(id) on delete set null,
  title       text not null,
  description text not null,
  category    text default 'geral', -- bug|decisao|comportamento_externo|geral (texto livre, sem enum)
  created_at  timestamptz default now()
);

alter table learnings enable row level security;
create policy "tenant_isolation" on learnings
  for all using (tenant_id = my_tenant_id());

create index idx_learnings_tenant on learnings(tenant_id, created_at desc);
