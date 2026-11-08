-- Disable the owner-only schedule in the same transaction that installs the
-- preference-aware schedule. The old job remains available for rollback.
BEGIN;
SELECT cron.alter_job(job_id:=jobid, active:=false)
FROM cron.job WHERE jobname='andromeda-owner-digest-catchup-v1';
SELECT cron.schedule('andromeda-eligible-digest-catchup-v2',
  '*/20 0-1,13-23 * * *',
  $cron$SELECT public.dispatch_missing_eligible_digests_20261107(false);$cron$);
COMMIT;
