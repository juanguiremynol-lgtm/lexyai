-- Stop future reconciliation first. Retain the audit permanently. Restore only
-- rows untouched since this routine reset them; never overwrite newer failures.
BEGIN;
DO $stop$
DECLARE v_job bigint;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname='sync-failure-evidence-recovery-v1';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
END
$stop$;
WITH latest AS (
  SELECT DISTINCT ON (work_item_id) *
  FROM public.sync_failure_evidence_recovery_audit_20261108
  ORDER BY work_item_id,recovered_at DESC,id DESC
)
UPDATE public.sync_item_failure_tracker t SET
  consecutive_failures=(a.prior_tracker->>'consecutive_failures')::integer,
  dead_lettered=true,
  dead_lettered_at=(a.prior_tracker->>'dead_lettered_at')::timestamptz,
  dead_lettered_run_id=a.prior_tracker->>'dead_lettered_run_id',
  reset_at=(a.prior_tracker->>'reset_at')::timestamptz
FROM latest a
WHERE t.work_item_id=a.work_item_id AND t.organization_id=a.organization_id
  AND t.dead_lettered=false AND t.consecutive_failures=0 AND t.reset_at=a.recovered_at
  AND t.last_failure_at IS NOT DISTINCT FROM (a.prior_tracker->>'last_failure_at')::timestamptz
  AND t.last_failure_reason IS NOT DISTINCT FROM a.prior_tracker->>'last_failure_reason';
REVOKE EXECUTE ON FUNCTION public.reconcile_sync_failure_evidence_20261108(boolean,integer) FROM service_role;
COMMIT;
