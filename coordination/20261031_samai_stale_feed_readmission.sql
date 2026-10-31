-- Explicit compatible SQL release; does not require publishing Edge Functions.
-- A stale stored SAMAI feed is not a completed public-source consultation.
-- Preserve the failed attempt and allow one fenced recovery after the daily
-- backend refresh window (03:00 Bogota) and at least 30 minutes of backoff.
BEGIN;
DO $$ BEGIN
  IF md5(pg_get_functiondef('public.admit_daily_update(uuid,text,text,text,text,boolean)'::regprocedure))
       <> 'e456f160a0015262dc8f77f07b6853b7'
     AND COALESCE(obj_description('public.admit_daily_update(uuid,text,text,text,text,boolean)'::regprocedure), '')
       NOT LIKE '20261031_samai_stale_feed_readmission:%' THEN
    RAISE EXCEPTION 'daily admission changed; reconcile before deployment';
  END IF;
END $$;
-- Private, retained before-image. Reapplying never replaces it.
CREATE TABLE IF NOT EXISTS public.monitor_gate_backup_20261031 AS
  SELECT d.*,pg_get_functiondef('public.admit_daily_update(uuid,text,text,text,text,boolean)'::regprocedure)
    AS prior_function_definition
  FROM public.daily_update_cycles d
  WHERE d.run_date=(now() AT TIME ZONE 'America/Bogota')::date
    AND d.channels->'acts'->>'error_code'='SAMAI_SOURCE_OBSERVATION_STALE';
REVOKE ALL ON public.monitor_gate_backup_20261031 FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.admit_daily_update(
  _work_item_id uuid, _channel text, _invoker text DEFAULT NULL,
  _trace_id text DEFAULT NULL, _retry_task_id text DEFAULT NULL,
  _continuation boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d date := (now() AT TIME ZONE 'America/Bogota')::date;
  result jsonb; c public.daily_update_cycles; prior jsonb;
  ready_at timestamptz; tok uuid;
BEGIN
  IF _continuation THEN
    RETURN jsonb_build_object('admitted',false,'reason','CONTINUATION_REQUIRES_JOB');
  END IF;
  result := public._admit_daily_update_at(d, _work_item_id, _channel,
                                        _invoker, _trace_id, _retry_task_id);
  IF result->>'admitted' = 'true' OR _channel <> 'acts'
     OR result->>'reason' IS DISTINCT FROM 'DAILY_UPDATE_ALREADY_STARTED' THEN
    RETURN result;
  END IF;
  SELECT * INTO c FROM public.daily_update_cycles
    WHERE run_date=d AND work_item_id=_work_item_id FOR UPDATE;
  prior := c.channels->'acts';
  IF prior->>'status' IS DISTINCT FROM 'FAILED'
     OR prior->>'error_code' IS DISTINCT FROM 'SAMAI_SOURCE_OBSERVATION_STALE'
     OR COALESCE(prior->>'stale_feed_recovery','false') = 'true'
     OR NOT EXISTS (SELECT 1 FROM public.work_items w
       JOIN public.work_item_provider_enrollment e ON e.work_item_id=w.id
       WHERE w.id=_work_item_id AND w.workflow_type='CPACA'
         AND w.monitoring_enabled IS TRUE AND w.deleted_at IS NULL
         AND w.lifecycle_state='ACTIVE' AND w.radicado ~ '^[0-9]{23}$'
         AND e.provider_key='samai' AND e.enabled IS TRUE) THEN
    RETURN result;
  END IF;
  ready_at := GREATEST((d::timestamp AT TIME ZONE 'America/Bogota') + interval '3 hours',
                       (prior->>'started_at')::timestamptz + interval '30 minutes');
  IF now() < ready_at THEN
    RETURN result || jsonb_build_object('next_eligible_at',ready_at);
  END IF;
  tok := gen_random_uuid();
  UPDATE public.daily_update_cycles SET updated_at=now(),
    channels=jsonb_set(channels,ARRAY['acts'],jsonb_build_object(
      'status','STARTED','token',tok,'started_at',now(),
      'invoker',_invoker,'trace_id',_trace_id,'retry_task_id',_retry_task_id,
      'stale_feed_recovery',true,'previous_attempt',prior-'token'))
    WHERE run_date=d AND work_item_id=_work_item_id;
  RETURN jsonb_build_object('admitted',true,'mode','new','run_date',d,
    'channel','acts','token',tok,'reason','STALE_FEED_RECOVERY');
END $$;
REVOKE ALL ON FUNCTION public.admit_daily_update(uuid,text,text,text,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_daily_update(uuid,text,text,text,text,boolean)
  TO service_role;
COMMENT ON FUNCTION public.admit_daily_update(uuid,text,text,text,text,boolean)
  IS '20261031_samai_stale_feed_readmission: one bounded recovery of stale stored SAMAI feed; prior attempt preserved; token fenced; no credential or provider eligibility bypass';
COMMIT;
