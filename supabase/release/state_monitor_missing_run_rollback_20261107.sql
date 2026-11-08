-- Stop new recovery dispatches without deleting, resetting or replaying runs.
DO $rollback$
DECLARE job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname='andromeda-state-run-catchup-v1';
  IF job_id IS NOT NULL THEN PERFORM cron.unschedule(job_id); END IF;
END
$rollback$;
