-- One exhausted wait now has a certified, exact-case current daily result.
-- Retain the old historical run/gate and every poll; credit only its final
-- waiting claim, so the ordinary monitor can read the completed daily reference.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE TABLE IF NOT EXISTS public.pp_completed_reader_recovery_20261101(
 run_id uuid NOT NULL,work_item_id uuid NOT NULL,native_run_id uuid NOT NULL,
 native_observed_at timestamptz NOT NULL,run_before jsonb NOT NULL,item_before jsonb NOT NULL,
 gate_before jsonb NOT NULL,recovered_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,work_item_id));
ALTER TABLE public.pp_completed_reader_recovery_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pp_completed_reader_recovery_20261101 FROM PUBLIC,anon,authenticated,service_role;
DO $lock$ BEGIN
 PERFORM id FROM estados_monitor_runs WHERE id='dbaa52fe-0216-405e-8d1b-a2b89736a1fb'::uuid FOR UPDATE;
END $lock$;
WITH eligible AS (
 SELECT i.run_id,i.work_item_id,to_jsonb(r) AS run_before,to_jsonb(i) AS item_before,to_jsonb(c) AS gate_before
 FROM estados_monitor_run_items i JOIN estados_monitor_runs r ON r.id=i.run_id
 JOIN work_items w ON w.id=i.work_item_id
 JOIN cron_state c ON c.key='pub_rescrape:'||w.id::text
 WHERE r.id='dbaa52fe-0216-405e-8d1b-a2b89736a1fb'::uuid AND r.channel='publicaciones'
 AND r.run_date='2026-11-01' AND r.status='PARTIAL'
 AND w.id='b422bbc4-23ca-4b18-9e7b-c2b067272cd2'::uuid AND w.radicado='66001418900120260088600'
 AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND w.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM work_item_provider_enrollment e WHERE e.work_item_id=w.id
 AND e.provider_key='publicaciones' AND e.enabled AND e.scope='PUBS')
 AND i.status='FAILED' AND i.attempts=3 AND i.error_code='PENDING_UPSTREAM'
 AND i.result->>'pending_upstream'='true'
 AND i.result#>>'{backend_trace,estado}'='ADMITIDA'
 AND i.result#>>'{backend_trace,backend_run_id}'='7d2bdcd0-13f9-4b62-9489-79a562e5c677'
 AND i.result#>>'{backend_trace,run_status_http}'='200'
 AND c.value->>'backend_run_id'='7d2bdcd0-13f9-4b62-9489-79a562e5c677'
 AND c.value->>'followup_closed'='false'
 AND '2026-11-01T14:54:55.045503Z'::timestamptz>now()-interval '24 hours'
 FOR UPDATE OF i,c
), backed AS (
 INSERT INTO pp_completed_reader_recovery_20261101(run_id,work_item_id,native_run_id,native_observed_at,run_before,item_before,gate_before)
 SELECT run_id,work_item_id,'6e0bd7f6-a9ac-4010-9fdf-d8f49458a08a'::uuid,
 '2026-11-01T14:54:55.045503Z'::timestamptz,run_before,item_before,gate_before FROM eligible
 ON CONFLICT DO NOTHING RETURNING run_id,work_item_id
), restored AS (
 UPDATE estados_monitor_run_items i SET status='PENDING',attempts=i.attempts-1,
 claimed_at=NULL,lease_token=NULL,finished_at=NULL,next_attempt_at=least(i.next_attempt_at,now()),
 result=i.result||jsonb_build_object('completed_daily_reader_recovery_at',now(),
 'certified_daily_run_id','6e0bd7f6-a9ac-4010-9fdf-d8f49458a08a','waiting_claim_credit',1)
 FROM backed b WHERE i.run_id=b.run_id AND i.work_item_id=b.work_item_id
 RETURNING i.run_id,i.work_item_id
), refreshed AS (
 UPDATE estados_monitor_runs r SET attempted_count=greatest(0,r.attempted_count-1),
 failed_count=greatest(0,r.failed_count-1)
 WHERE r.id='dbaa52fe-0216-405e-8d1b-a2b89736a1fb'::uuid AND EXISTS(SELECT 1 FROM restored)
 RETURNING r.id
)
SELECT work_item_id,run_id FROM restored;
COMMIT;
