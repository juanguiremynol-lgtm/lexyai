SELECT cron.schedule(
  'andromeda-daily-sync-after-restart',
  '23,53 0,12-23 * * *',
  $cron$SELECT public.recover_daily_sync_after_restart_20261121(false);$cron$
);
