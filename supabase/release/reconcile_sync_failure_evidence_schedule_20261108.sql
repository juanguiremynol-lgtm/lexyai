DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='sync-failure-evidence-recovery-v1') THEN
    RAISE EXCEPTION 'recovery cron name already exists';
  END IF;
  PERFORM cron.schedule('sync-failure-evidence-recovery-v1','40 * * * *',
    'SELECT public.reconcile_sync_failure_evidence_20261108(false,20)');
END
$schedule$;
