-- Ativa o cron do session-health-check a cada 5 minutos via pg_cron + pg_net.
-- verify_jwt=false nessa função — não precisa de Authorization header.

select cron.schedule(
  'session-health-check',
  '*/5 * * * *',
  $$
    select net.http_post(
      url     := 'https://byuggqcnvezendgrcysb.supabase.co/functions/v1/session-health-check',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
