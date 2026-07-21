-- 0014_delete_session_cascade_batched.sql
-- 0013 ainda estourava statement_timeout (~9s) mesmo com SET LOCAL elevado —
-- algo no ambiente gerenciado do Supabase limita a duração por statement
-- individual abaixo do que um SET LOCAL alcança de forma confiável. Solução:
-- apagar em lotes (mesmo padrão de history-sync, ver regra 11 do CLAUDE.md),
-- já que cada DELETE em lote é um statement curto e independente.

create or replace function delete_session_cascade(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  set local statement_timeout = '30s';

  -- mensagens em lotes (cascade remove media_files via FK)
  loop
    delete from messages
    where id in (
      select id from messages where session_id = p_session_id limit 2000
    );
    get diagnostics deleted_count = row_count;
    exit when deleted_count = 0;
  end loop;

  delete from chats where session_id = p_session_id;
  delete from wa_sessions where id = p_session_id;
end;
$$;
