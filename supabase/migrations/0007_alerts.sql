create table alerts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  session_id  uuid references wa_sessions(id) on delete cascade,
  name        text not null,
  keywords    text[] not null,
  active      boolean default true,
  created_at  timestamptz default now()
);

create table alert_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  alert_id         uuid not null references alerts(id) on delete cascade,
  message_id       uuid not null references messages(id) on delete cascade,
  matched_keyword  text not null,
  seen             boolean default false,
  created_at       timestamptz default now()
);

alter table alerts enable row level security;
alter table alert_events enable row level security;

create policy "tenant_isolation" on alerts for all using (
  tenant_id = (select tenant_id from operators where id = auth.uid())
);

create policy "tenant_isolation" on alert_events for all using (
  tenant_id = (select tenant_id from operators where id = auth.uid())
);

alter publication supabase_realtime add table alert_events;
