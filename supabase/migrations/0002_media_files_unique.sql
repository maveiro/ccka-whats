-- Adiciona unique constraint em media_files.message_id
-- Necessário para upsert idempotente
alter table media_files add constraint media_files_message_id_key unique (message_id);
