-- Run once after deploying and validating the guarded queue function.
-- cron uses UTC; 14:50 UTC is 09:50 in Bogota.
BEGIN;
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='guarded-missing-acts-queue-v1') THEN
    RAISE EXCEPTION 'guarded queue job already exists';
  END IF;
END
$check$;
SELECT cron.schedule('guarded-missing-acts-queue-v1','50 14 * * *',
  $command$SELECT public.enqueue_guarded_missing_acts_20261108(false,10)$command$);
COMMIT;
