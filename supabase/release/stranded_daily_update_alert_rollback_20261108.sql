-- Remove only the watchdog job and its function; preserve event history.
BEGIN;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='andromeda-stranded-update-watchdog-v1';
DROP FUNCTION IF EXISTS public.alert_stranded_daily_updates_20261108();
COMMIT;
