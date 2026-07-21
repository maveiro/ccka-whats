-- 0015_drop_unused_delete_session_cascade_fn.sql
-- delete_session_cascade (0013/0014) foi superada pela Edge Function
-- delete-session (bypassa o teto de statement_timeout do role authenticator
-- fazendo deletes em lotes por chamadas HTTP separadas). Função morta.

drop function if exists delete_session_cascade(uuid);
