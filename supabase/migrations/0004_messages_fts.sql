-- Coluna gerada para full-text search em messages
alter table messages
  add column if not exists search_vector tsvector
    generated always as (
      to_tsvector('portuguese', coalesce(body, '') || ' ' || coalesce(caption, ''))
    ) stored;

-- Índice GIN para performance em buscas tsvector
create index if not exists messages_search_vector_idx
  on messages using gin(search_vector);

-- Índice também em chats.name para busca por contato
create index if not exists chats_name_idx
  on chats using gin(to_tsvector('portuguese', coalesce(name, '') || ' ' || coalesce(jid, '')));
