
SELECT public.emit_appellate_blindspot_alerts();

SELECT cron.unschedule('appellate-blindspot-sweep')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='appellate-blindspot-sweep');

SELECT cron.schedule(
  'appellate-blindspot-sweep',
  '20 12 * * *',
  $$SELECT public.emit_appellate_blindspot_alerts();$$
);
