-- Função de busca semântica por similaridade de embedding
-- Filtra automaticamente pelo tenant do operador autenticado via auth.uid()

create or replace function search_messages_semantic(
  query_embedding vector(1536),
  match_threshold float default 0.5,
  match_count int default 20
)
returns table (
  id uuid,
  body text,
  caption text,
  chat_id uuid,
  from_me boolean,
  timestamp timestamptz,
  similarity float
)
language sql
stable
as $$
  select
    m.id,
    m.body,
    m.caption,
    m.chat_id,
    m.from_me,
    m.timestamp,
    1 - (m.embedding <=> query_embedding) as similarity
  from messages m
  where m.embedding is not null
    and 1 - (m.embedding <=> query_embedding) > match_threshold
    and m.tenant_id = (select tenant_id from operators where id = auth.uid())
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- Grant execute para usuários autenticados (RLS garante isolamento por tenant)
grant execute on function search_messages_semantic(vector, float, int) to authenticated;
