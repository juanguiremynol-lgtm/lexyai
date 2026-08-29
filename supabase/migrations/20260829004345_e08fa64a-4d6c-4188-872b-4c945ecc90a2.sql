select cron.schedule(
  'andromeda-daily-estados',
  '20 12 * * *',
  $$
  select net.http_post(
    url := 'https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/scheduled-daily-estados',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('trigger','cron')
  );
  $$
);