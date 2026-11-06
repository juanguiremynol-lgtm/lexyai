-- One bounded release recovery of twelve gate-blocked SAMAI Estados reads.
-- Retain the prior cycle, item, attempts and all judicial data. No portal call
-- occurs here; the existing authenticated monitor/cron performs each read.
BEGIN;
CREATE TABLE IF NOT EXISTS public.samai_monitor_contract_recovery_20261101 (
  run_id uuid NOT NULL,work_item_id uuid NOT NULL,
  cycle_before jsonb NOT NULL,item_before jsonb NOT NULL,
  source_revision text NOT NULL,recovered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,work_item_id)
);
ALTER TABLE public.samai_monitor_contract_recovery_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.samai_monitor_contract_recovery_20261101 FROM PUBLIC,anon,authenticated,service_role;
WITH eligible AS (
  SELECT i.run_id,i.work_item_id,to_jsonb(d) AS cycle_before,to_jsonb(i) AS item_before
  FROM public.estados_monitor_run_items i
  JOIN public.estados_monitor_runs r ON r.id=i.run_id
  JOIN public.work_items w ON w.id=i.work_item_id
  JOIN public.daily_update_cycles d ON d.work_item_id=i.work_item_id AND d.run_date=r.run_date
  WHERE i.run_id='68f2c917-02ca-4bcd-931c-b912f88f4891'::uuid
    AND r.channel='samai_estados' AND r.run_date='2026-10-31'
    AND r.status IN ('PARTIAL','RUNNING')
    AND i.status='PENDING' AND i.error_code='DAILY_UPDATE_ALREADY_STARTED'
    AND i.lease_token IS NULL
    AND d.channels->'pubs'->>'status' IN ('DONE','PENDING_UPSTREAM')
    AND (d.channels->'pubs'->>'started_at')::timestamptz < '2026-11-01 00:08Z'
    AND w.workflow_type='CPACA' AND w.lifecycle_state='ACTIVE'
    AND w.monitoring_enabled IS TRUE AND w.deleted_at IS NULL
    AND w.radicado ~ '^[0-9]{23}$'
    AND EXISTS (SELECT 1 FROM public.work_item_provider_enrollment e
      WHERE e.work_item_id=w.id AND e.provider_key='samai_estados' AND e.scope='PUBS' AND e.enabled IS TRUE)
    AND NOT EXISTS (SELECT 1 FROM public.samai_monitor_contract_recovery_20261101 a
      WHERE a.run_id=i.run_id AND a.work_item_id=i.work_item_id)
  FOR UPDATE OF i,d
), audited AS (
  INSERT INTO public.samai_monitor_contract_recovery_20261101
    (run_id,work_item_id,cycle_before,item_before,source_revision)
  SELECT run_id,work_item_id,cycle_before,item_before,'lexyai:cb5275382dff98de8e73f151e095165491a877e9' FROM eligible
  ON CONFLICT DO NOTHING RETURNING run_id,work_item_id
), cycles AS (
  UPDATE public.daily_update_cycles d SET
    channels=jsonb_set(d.channels-'pubs',ARRAY['pubs_before_source_contract_20261101'],d.channels->'pubs'),
    updated_at=now()
  FROM audited a WHERE d.work_item_id=a.work_item_id AND d.run_date='2026-10-31'
  RETURNING d.work_item_id
), awakened AS (
  UPDATE public.estados_monitor_run_items i SET next_attempt_at=now(),
    result=COALESCE(i.result,'{}'::jsonb)||jsonb_build_object('read_contract_recovery_at',now())
  FROM audited a,cycles c WHERE i.run_id=a.run_id AND i.work_item_id=a.work_item_id
    AND c.work_item_id=i.work_item_id
  RETURNING i.work_item_id,i.attempts
)
SELECT count(*) AS recovered,count(*) FILTER(WHERE attempts>0) AS attempts_preserved FROM awakened;
COMMIT;
