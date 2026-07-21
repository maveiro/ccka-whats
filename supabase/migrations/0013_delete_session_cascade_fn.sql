-- 0013_delete_session_cascade_fn.sql
-- Corrige timeout ao excluir sessões com histórico grande (30k+ mensagens).
-- DELETE direto via PostgREST estoura o statement_timeout da API ao percorrer
-- o cascade (messages, media_files, chats). Esta função roda com um
-- statement_timeout local elevado, evitando o limite padrão da API.

create or replace function delete_session_cascade(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  set local statement_timeout = '120s';
  delete from wa_sessions where id = p_session_id;
end;
$$;

comment on function delete_session_cascade(uuid) is
  'Exclui wa_sessions (+ cascade messages/chats/media_files/alerts) com statement_timeout elevado. Usado por DELETE /api/sessions/[id] para sessões com histórico grande.';
