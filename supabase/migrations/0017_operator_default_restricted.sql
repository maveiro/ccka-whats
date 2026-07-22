-- 0017_operator_default_restricted.sql
-- Operadores convidados a partir de agora nascem com session_scope='restricted'
-- (sem nenhum número até adicionarem o próprio ou o admin liberar algum), em vez de
-- 'all'. Só afeta novos inserts — operadores existentes mantêm o valor que já têm
-- ('all'), ninguém perde acesso retroativamente. Admin sempre vê tudo independente
-- desse valor (has_session_access() checa role='admin' primeiro).
alter table operators alter column session_scope set default 'restricted';
