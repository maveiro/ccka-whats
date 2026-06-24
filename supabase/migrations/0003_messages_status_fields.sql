-- Migration: 0003_messages_status_fields.sql
-- Campos de status de entrega, deleção e edição de mensagens

alter table messages
  add column if not exists delivery_status text default 'pending',
  add column if not exists deleted_at      timestamptz,
  add column if not exists edited_at       timestamptz;

comment on column messages.delivery_status is 'ACK do WhatsApp: pending|sent|delivered|read|played|error';
comment on column messages.deleted_at      is 'Preenchido quando mensagem foi apagada para todos';
comment on column messages.edited_at       is 'Preenchido quando mensagem foi editada';
