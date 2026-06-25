alter table chats
  add column if not exists last_message_body text;
