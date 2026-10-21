-- Emergency compatible stop only. Never restores the former unauthenticated
-- calls or unfenced writers. Retains runs, documents, leases and identities.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=64 AND jobname='andromeda-daily-estados')
 OR NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='andromeda-public-estados-resume') THEN
  RAISE EXCEPTION 'Cron topology changed';
 END IF;
END $$;
SELECT cron.alter_job(64,active:=false);
SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='andromeda-public-estados-resume';
COMMIT;
-- daily-sync66, pp-sync-cron, protocols0046/47/48 and all judicial data remain.
