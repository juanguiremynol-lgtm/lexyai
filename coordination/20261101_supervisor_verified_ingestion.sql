-- Use the existing bounded worker; do not spend its slots duplicating the
-- independent publication monitors or re-ingesting a confirmed current read.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE TABLE IF NOT EXISTS public.supervisor_claim_backup_20261101(
 key text PRIMARY KEY,definition text NOT NULL,owner_name name,acl text,applied_md5 text);
ALTER TABLE public.supervisor_claim_backup_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supervisor_claim_backup_20261101 FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE IF NOT EXISTS public.supervisor_verified_ingestion_20261101(
 queue_id uuid PRIMARY KEY,before_image jsonb NOT NULL,timeline_id uuid NOT NULL,
 source_observed_at timestamptz NOT NULL,confirmed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.supervisor_verified_ingestion_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supervisor_verified_ingestion_20261101 FROM PUBLIC,anon,authenticated,service_role;
DO $guard$
DECLARE p regprocedure:='public.atenia_ai_claim_supported_queue(integer)'::regprocedure; prior text;
BEGIN
 prior:=md5(pg_get_functiondef(p));
 IF prior<>'c31c0aafd8195ad569fb1ad9b91a149b' AND NOT EXISTS(
  SELECT 1 FROM public.supervisor_claim_backup_20261101 WHERE key='verified-ingestion-v1' AND applied_md5=prior) THEN
   RAISE EXCEPTION 'Supervisor claim changed: reconcile before replacement';
 END IF;
 INSERT INTO public.supervisor_claim_backup_20261101(key,definition,owner_name,acl)
 SELECT 'verified-ingestion-v1',pg_get_functiondef(p),pg_get_userbyid(proowner),proacl::text FROM pg_proc WHERE oid=p
 ON CONFLICT DO NOTHING;
END $guard$;
CREATE OR REPLACE FUNCTION public.atenia_ai_claim_supported_queue(_limit integer DEFAULT 5)
 RETURNS SETOF public.atenia_ai_remediation_queue
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public'
AS $function$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
 -- A persisted successful read, not a DONE admission or an HTTP acknowledgement.
 WITH proved AS (
  SELECT q.id,to_jsonb(q) AS before_image,t.id AS timeline_id,
    (t.metadata->>'source_observed_at')::timestamptz AS source_observed_at
  FROM public.atenia_ai_remediation_queue q JOIN public.work_items w ON w.id=q.work_item_id
  JOIN LATERAL(SELECT x.id,x.metadata FROM public.work_item_sync_timeline x
    WHERE x.work_item_id=w.id AND (x.organization_id IS NULL OR x.organization_id=w.organization_id)
    AND x.operation='acts' AND x.provider IN ('cpnu','samai') AND x.status IN ('success','empty')
    AND x.metadata->>'source_complete'='true'
    AND x.metadata->>'source_observed_at' ~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$'
    AND (x.metadata->>'source_observed_at')::timestamptz BETWEEN now()-interval '24 hours' AND now()+interval '1 minute'
    AND ((x.metadata->>'source_observed_at')::timestamptz AT TIME ZONE 'America/Bogota')::date=(now() AT TIME ZONE 'America/Bogota')::date
    AND EXISTS(SELECT 1 FROM public.work_item_provider_enrollment e WHERE e.work_item_id=w.id
      AND e.provider_key=x.provider AND e.scope='ACTS' AND e.enabled)
    ORDER BY x.started_at DESC LIMIT 1)t ON true
  WHERE q.action_type='RETRY_ACTS' AND q.status='PENDING'
    AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND w.deleted_at IS NULL
    AND q.organization_id=w.organization_id AND w.radicado ~ '^\d{23}$'
  FOR UPDATE OF q SKIP LOCKED
 ), backed AS (
  INSERT INTO public.supervisor_verified_ingestion_20261101(queue_id,before_image,timeline_id,source_observed_at)
  SELECT id,before_image,timeline_id,source_observed_at FROM proved ON CONFLICT DO NOTHING RETURNING queue_id
 )
 UPDATE public.atenia_ai_remediation_queue q SET status='DONE',last_error=NULL,updated_at=now(),
  payload=coalesce(q.payload,'{}')||jsonb_build_object('completion_kind','VERIFIED_STORED_INGESTION',
   'timeline_id',p.timeline_id,'source_observed_at',p.source_observed_at)
 FROM proved p JOIN backed b ON b.queue_id=p.id WHERE q.id=p.id AND q.status='PENDING';
 RETURN QUERY
 WITH ranked AS (
  SELECT q.id,row_number() OVER(PARTITION BY q.action_type ORDER BY
   q.priority+floor(greatest(0,extract(epoch FROM(now()-q.created_at)))/3600) DESC,q.created_at,q.id) AS rn,
   q.priority+floor(greatest(0,extract(epoch FROM(now()-q.created_at)))/3600) AS aged,q.created_at AS c
  FROM public.atenia_ai_remediation_queue q
  WHERE q.status='PENDING' AND q.run_after<=now() AND q.attempts<q.max_attempts
   AND q.action_type IN ('RETRY_ACTS','RETRY_PUBS','RETRY_PUBS_HEAVY','RUN_INTEGRATION_HEALTH')
   AND (q.action_type='RUN_INTEGRATION_HEALTH' OR EXISTS(SELECT 1 FROM public.work_items active
     WHERE active.id=q.work_item_id AND active.lifecycle_state='ACTIVE' AND active.monitoring_enabled
      AND active.deleted_at IS NULL AND active.radicado ~ '^\d{23}$' AND active.organization_id=q.organization_id))
   AND NOT(q.action_type IN ('RETRY_PUBS','RETRY_PUBS_HEAVY') AND EXISTS(
    SELECT 1 FROM public.estados_monitor_run_items i JOIN public.estados_monitor_runs r ON r.id=i.run_id
    JOIN public.work_items w ON w.id=i.work_item_id
    WHERE i.work_item_id=q.work_item_id AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND w.deleted_at IS NULL
     AND r.run_date=(now() AT TIME ZONE 'America/Bogota')::date
     AND r.channel=CASE WHEN w.workflow_type='CPACA' THEN 'samai_estados' ELSE 'publicaciones' END
     AND i.status IN ('PENDING','CLAIMED','SUCCESS')))
 ), candidates AS (
  SELECT q.id FROM public.atenia_ai_remediation_queue q JOIN ranked r ON r.id=q.id
  ORDER BY r.rn,r.aged DESC,r.c,q.id LIMIT greatest(0,least(coalesce(_limit,5),5))
  FOR UPDATE OF q SKIP LOCKED
 )
 UPDATE public.atenia_ai_remediation_queue q SET status='RUNNING',attempts=q.attempts+1,updated_at=now()
 FROM candidates c WHERE q.id=c.id RETURNING q.*;
END $function$;
REVOKE ALL ON FUNCTION public.atenia_ai_claim_supported_queue(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.atenia_ai_claim_supported_queue(integer) TO service_role;
UPDATE public.supervisor_claim_backup_20261101 SET applied_md5=md5(pg_get_functiondef('public.atenia_ai_claim_supported_queue(integer)'::regprocedure))
WHERE key='verified-ingestion-v1';
COMMIT;
