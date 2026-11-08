-- A missed 07:20 snapshot can be seeded from 07:40 onward after a restart.
-- The dispatcher enforces local hours, per-channel daily existence, a cooldown,
-- a three-request limit, downstream admission limits and a dry-run option.
DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='andromeda-state-run-catchup-v1') THEN
    RAISE EXCEPTION 'State-run recovery cron already exists; refusing to overwrite it';
  END IF;
  PERFORM cron.schedule('andromeda-state-run-catchup-v1', '*/20 0-1,12-23 * * *',
    'SELECT public.dispatch_missing_state_runs_20261107(false)');
END
$schedule$;
