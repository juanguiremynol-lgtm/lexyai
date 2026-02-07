
-- Phase 3.3: Register pg_cron jobs for Atenia AI supervisor and Lexy daily message
-- Atenia AI supervisor: 7:30 AM COT = 12:30 UTC
SELECT cron.schedule(
  'atenia-ai-supervisor-daily',
  '30 12 * * *',
  $$SELECT net.http_post(
    url := current_setting('supabase.url') || '/functions/v1/atenia-ai-supervisor',
    body := '{"mode": "POST_DAILY_SYNC"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key'),
      'Content-Type', 'application/json'
    )
  );$$
);

-- Lexy daily message: 7:45 AM COT = 12:45 UTC
SELECT cron.schedule(
  'lexy-daily-message-generation',
  '45 12 * * *',
  $$SELECT net.http_post(
    url := current_setting('supabase.url') || '/functions/v1/lexy-daily-message',
    body := '{"mode": "GENERATE_ALL"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key'),
      'Content-Type', 'application/json'
    )
  );$$
);
