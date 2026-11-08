-- UTC cron times correspond to the function's 08:20–21:00 Bogotá guard.
-- This schedule can recover only the owner's own existing daily digest.
SELECT cron.schedule(
  'andromeda-owner-digest-catchup-v1',
  '*/20 0-1,13-23 * * *',
  $cron$SELECT public.dispatch_missing_daily_digests_20261107(false, 'c64c2ca1-436a-44ee-a6ae-69bb19dfdc3a'::uuid);$cron$
);
