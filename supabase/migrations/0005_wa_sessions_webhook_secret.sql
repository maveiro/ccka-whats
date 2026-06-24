alter table wa_sessions
  add column if not exists webhook_secret text;

update wa_sessions
  set webhook_secret = encode(gen_random_bytes(32), 'hex')
  where webhook_secret is null;

alter table wa_sessions
  alter column webhook_secret set default encode(gen_random_bytes(32), 'hex');
