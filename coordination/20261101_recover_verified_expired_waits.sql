-- Thirteen false source-failure budgets: each exact backend run was
-- independently verified live in Cloud SQL. No source success is asserted.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE TABLE IF NOT EXISTS public.monitor_expired_wait_recovery_20261101(
 run_id uuid NOT NULL,work_item_id uuid NOT NULL,native_run_id uuid NOT NULL,
 item_before jsonb NOT NULL,gate_before jsonb NOT NULL,recovered_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,work_item_id));
ALTER TABLE public.monitor_expired_wait_recovery_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monitor_expired_wait_recovery_20261101 FROM PUBLIC,anon,authenticated,service_role;
DO $lock$ BEGIN PERFORM id FROM estados_monitor_runs
 WHERE id='dbaa52fe-0216-405e-8d1b-a2b89736a1fb'::uuid FOR UPDATE; END $lock$;
WITH expected(work_item_id,radicado,native_run_id) AS (VALUES
 ('27db2525-f5a4-4a3d-abdc-9ca465b1aa72'::uuid,'05001311000220260018500','5e104f56-fdc3-4ad1-be6b-d8ea5090d8a2'::uuid),
 ('5840084b-6d52-47f4-b138-87006ae87f6f'::uuid,'05001400301020260148700','a4ac0192-a094-4367-8a42-0612408ffd08'::uuid),
 ('853993b2-74ec-41fa-8fcc-7cf500d1ffe0'::uuid,'05001400301020260153500','2ef6d766-dccc-4a89-b9b9-a419564fb423'::uuid),
 ('d5d846a3-673e-4969-b7ea-9cfc49d613c4'::uuid,'05001400301120260144800','2550b6c8-1ecd-4d9e-887e-fe53fbc7c0bc'::uuid),
 ('ee87cd05-dc97-41d5-af5d-2d1afc99839d'::uuid,'05001400302020260045500','97d85147-bac2-4e5b-8f4b-be0cd140a9a4'::uuid),
 ('ca792477-aa85-4972-a9c4-5bbf896fbfa4'::uuid,'05001400302620260116600','0cb3e335-6cb9-48d5-b52b-6ca9e9c967c2'::uuid),
 ('fa39cbe7-3611-4b7d-ad70-23af45df6acd'::uuid,'05001400302820260075400','8b18cfab-d787-45e7-9829-7e2165edb8d6'::uuid),
 ('0f5a49e9-d6d3-46d0-a992-1a38d3f3d9d4'::uuid,'05001418900920260066300','0335bbfc-3ce6-4076-99a3-0d618b90017e'::uuid),
 ('d0cbff02-fc40-4af1-b1a9-cb41d5f6a995'::uuid,'05088400300520230119400','907be34d-770a-409a-b122-90520c2e5d3f'::uuid),
 ('987c2074-1c70-450f-8aa2-11b9b951439b'::uuid,'05607408900120230027900','6fc635bc-889a-4ed5-81e2-d4a56d8d957b'::uuid),
 ('9802f7f6-d2c4-40b1-a15f-d07f0ca135dd'::uuid,'05615400300220260036600','fd774ef1-67bc-49a2-9bd0-42569e25700c'::uuid),
 ('ea6a804b-0380-4a22-b257-0ba306b8b044'::uuid,'11001311001320240075200','7b938fe7-8b0f-4491-92a5-d67e2310af64'::uuid),
 ('ebc63f0a-d27e-4916-9750-1e51c22eb883'::uuid,'11001418904220250174801','5e2b6f07-0e56-4109-93f3-a0723b946a63'::uuid)
), eligible AS (
 SELECT i.*,x.native_run_id,to_jsonb(c) AS gate_before
 FROM estados_monitor_run_items i JOIN estados_monitor_runs r ON r.id=i.run_id
 JOIN expected x ON x.work_item_id=i.work_item_id
 JOIN work_items w ON w.id=x.work_item_id AND w.radicado=x.radicado
 JOIN cron_state c ON c.key='pub_rescrape:'||w.id::text
 WHERE r.id='dbaa52fe-0216-405e-8d1b-a2b89736a1fb'::uuid AND r.channel='publicaciones'
 AND r.run_date='2026-11-01' AND r.status='PARTIAL'
 AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND w.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM work_item_provider_enrollment e WHERE e.work_item_id=w.id
 AND e.provider_key='publicaciones' AND e.enabled AND e.scope='PUBS')
 AND i.status='FAILED' AND i.attempts=3 AND i.error_code='PENDING_UPSTREAM'
 AND i.result->>'pending_upstream'='true'
 AND i.result#>>'{backend_trace,estado}' IN ('ADMITIDA','EN_CURSO')
 AND i.result#>>'{backend_trace,run_status_http}'='200'
 AND i.result#>>'{backend_trace,followup_expired_needs_intervention}'='true'
 AND i.result#>>'{backend_trace,backend_run_id}'=x.native_run_id::text
 AND c.value->>'backend_run_id'=x.native_run_id::text AND c.value->>'followup_closed'='false'
 FOR UPDATE OF i,c
), backed AS (
 INSERT INTO monitor_expired_wait_recovery_20261101(run_id,work_item_id,native_run_id,item_before,gate_before)
 SELECT run_id,work_item_id,native_run_id,to_jsonb(e)-'gate_before'-'native_run_id',gate_before FROM eligible e
 ON CONFLICT DO NOTHING RETURNING run_id,work_item_id
), recovered AS (
 UPDATE estados_monitor_run_items i SET status='PENDING',attempts=i.attempts-1,
 claimed_at=NULL,lease_token=NULL,finished_at=NULL,next_attempt_at=least(i.next_attempt_at,now()),
 error_code='BACKEND_WAIT_BUDGET_EXHAUSTED',result=i.result||jsonb_build_object(
 'monitor_expired_wait_recovered_at',now(),'waiting_claim_credit',1,
 'monitor_requires_intervention',true,'monitor_next_state_check_seconds',3600)
 FROM backed b WHERE i.run_id=b.run_id AND i.work_item_id=b.work_item_id
 RETURNING i.run_id,i.work_item_id
), counts AS (
 UPDATE estados_monitor_runs r SET attempted_count=greatest(0,r.attempted_count-n.n),
 failed_count=greatest(0,r.failed_count-n.n)
 FROM (SELECT run_id,count(*)::int AS n FROM recovered GROUP BY run_id) n
 WHERE r.id=n.run_id RETURNING r.id
)
SELECT work_item_id,run_id FROM recovered;
COMMIT;
