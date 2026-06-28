DO $$
BEGIN
  PERFORM cron.unschedule('process-email-outbox-every-minute');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'process-email-outbox-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/process-email-outbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2dXVrYnFjdmxudm1jdmNydWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzMzcwNDMsImV4cCI6MjA4MTkxMzA0M30.ueXyei3v_gYAISV47psLmCmHTfIgCRTfdZnFSaNAQho'
    ),
    body := jsonb_build_object('source', 'pg_cron', 'invoked_at', now())
  );
  $$
);