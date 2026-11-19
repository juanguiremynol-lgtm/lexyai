-- Two delivery recoveries. Their recent windows and commit receipts were
-- verified against the exact-case PP reader on 2026-11-01. No source POST,
-- no judicial data update, no retry counter reset, no historical certification.
BEGIN;
CREATE TABLE IF NOT EXISTS public.monitor_pp_reader_recovery_20261101 (
 run_id uuid NOT NULL,work_item_id uuid NOT NULL,backend_run_id uuid NOT NULL,
 gate_before jsonb NOT NULL,item_before jsonb NOT NULL,
 recovered_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(run_id,work_item_id)
);
ALTER TABLE public.monitor_pp_reader_recovery_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monitor_pp_reader_recovery_20261101 FROM PUBLIC,anon,authenticated,service_role;
WITH expected(work_item_id,radicado,backend_run_id,trace_id) AS (VALUES
 ('75b1625c-69e4-40f7-849f-63f6a9b775e6'::uuid,'05030318900120250000200','1eddbd28-202a-4f94-b7be-260705f7858a'::uuid,'345626db-4cd5-4974-bd7c-8b38874db0d8'),
 ('72381c1f-c6d8-46ec-b300-b6121c558fe8'::uuid,'05761318900120230003800','4a9ee8f1-c377-498c-ade0-dc0cf7283230'::uuid,'f384de2f-5343-4480-b774-e9c86beb8674')
), eligible AS (
 SELECT i.run_id,i.work_item_id,x.backend_run_id,x.radicado,to_jsonb(c) AS gate_before,to_jsonb(i) AS item_before
 FROM public.estados_monitor_run_items i JOIN public.estados_monitor_runs r ON r.id=i.run_id
 JOIN expected x ON x.work_item_id=i.work_item_id
 JOIN public.work_items w ON w.id=i.work_item_id AND w.radicado=x.radicado
 JOIN public.cron_state c ON c.key='pub_rescrape:'||i.work_item_id::text
 WHERE r.run_date='2026-10-31' AND r.channel='publicaciones'
  AND i.status='PENDING' AND i.error_code='DAILY_UPDATE_ALREADY_STARTED' AND i.lease_token IS NULL
  AND c.value->>'followup_closed'='true' AND c.value->>'trazabilidad_id'=x.trace_id
  AND c.value->>'backend_run_id'<>x.backend_run_id::text
  AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled IS TRUE AND w.deleted_at IS NULL
  AND EXISTS(SELECT 1 FROM public.work_item_provider_enrollment e WHERE e.work_item_id=w.id
    AND e.provider_key='publicaciones' AND e.scope='PUBS' AND e.enabled IS TRUE)
  AND NOT EXISTS(SELECT 1 FROM public.monitor_pp_reader_recovery_20261101 a
    WHERE a.run_id=i.run_id AND a.work_item_id=i.work_item_id)
 FOR UPDATE OF i,c
), audited AS (
 INSERT INTO public.monitor_pp_reader_recovery_20261101(run_id,work_item_id,backend_run_id,gate_before,item_before)
 SELECT run_id,work_item_id,backend_run_id,gate_before,item_before FROM eligible
 ON CONFLICT DO NOTHING RETURNING *
), gates AS (
 UPDATE public.cron_state c SET value=c.value || jsonb_build_object(
  'backend_run_id',a.backend_run_id,'backend_admitted_at',now(),'followup_closed',false,
  'poll_count',0,'next_poll_at',now(),'reader_recovery_at',now(),
  'reader_recovery_reason','CERTIFIED_RECENT_WINDOW_DELIVERY',
  'previous_run_id',c.value->>'backend_run_id'),updated_at=now()
 FROM audited a WHERE c.key='pub_rescrape:'||a.work_item_id::text
 RETURNING a.work_item_id
), awakened AS (
 UPDATE public.estados_monitor_run_items i SET next_attempt_at=now(),
  result=COALESCE(i.result,'{}'::jsonb)||jsonb_build_object('certified_reader_recovery_at',now())
 FROM audited a,gates g WHERE i.run_id=a.run_id AND i.work_item_id=a.work_item_id AND g.work_item_id=i.work_item_id
 RETURNING i.work_item_id,i.attempts
)
SELECT count(*) AS recovered,count(*) FILTER(WHERE attempts>0) AS attempt_histories_preserved FROM awakened;
COMMIT;
