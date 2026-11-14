-- Restore the exact live function captured at 0cc6c674 before the stale-lease
-- recovery migration. Existing cycle rows and execution grants are untouched.
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';

CREATE OR REPLACE FUNCTION public._admit_daily_update_at(_d date, _work_item_id uuid, _channel text, _invoker text, _trace_id text, _retry_task_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE w record; c public.daily_update_cycles; tok uuid := gen_random_uuid();
BEGIN
  IF _channel NOT IN ('acts','pubs') THEN RAISE EXCEPTION 'INVALID_CHANNEL' USING ERRCODE='22023'; END IF;
  SELECT id, owner_id, organization_id INTO w FROM work_items WHERE id=_work_item_id;
  IF w.id IS NULL OR w.owner_id IS NULL THEN RETURN jsonb_build_object('admitted',false,'reason','WORK_ITEM_UNRESOLVED'); END IF;
  INSERT INTO daily_update_cycles(run_date, work_item_id, owner_id, organization_id) VALUES (_d, _work_item_id, w.owner_id, w.organization_id) ON CONFLICT DO NOTHING;
  SELECT * INTO c FROM daily_update_cycles WHERE run_date=_d AND work_item_id=_work_item_id FOR UPDATE;
  IF c.channels ? _channel THEN
    UPDATE daily_update_cycles SET duplicate_requests=duplicate_requests+1, updated_at=now(),
      last_duplicate=jsonb_build_object('channel',_channel,'invoker',_invoker,'trace_id',_trace_id,'retry_task_id',_retry_task_id,'at',now())
      WHERE run_date=_d AND work_item_id=_work_item_id;
    RETURN jsonb_build_object('admitted',false,'reason','DAILY_UPDATE_ALREADY_STARTED','run_date',_d,'channel',_channel,
      'existing',((c.channels->_channel) - 'token'),'next_eligible_at',bogota_next_midnight(_d));
  END IF;
  UPDATE daily_update_cycles SET updated_at=now(), channels = channels || jsonb_build_object(_channel, jsonb_build_object(
    'status','STARTED','token',tok,'started_at',now(),'invoker',_invoker,'trace_id',_trace_id,'retry_task_id',_retry_task_id))
    WHERE run_date=_d AND work_item_id=_work_item_id;
  RETURN jsonb_build_object('admitted',true,'mode','new','run_date',_d,'channel',_channel,'token',tok);
END $function$;
