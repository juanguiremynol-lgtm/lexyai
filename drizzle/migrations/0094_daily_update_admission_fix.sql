CREATE OR REPLACE FUNCTION public.admit_daily_update(_work_item_id uuid, _channel text, _invoker text DEFAULT NULL,
  _trace_id text DEFAULT NULL, _retry_task_id text DEFAULT NULL, _continuation boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d date := (now() AT TIME ZONE 'America/Bogota')::date; w record; c public.daily_update_cycles; tok uuid := gen_random_uuid();
BEGIN
  IF _channel NOT IN ('acts','pubs') THEN RAISE EXCEPTION 'INVALID_CHANNEL' USING ERRCODE='22023'; END IF;
  SELECT id, owner_id, organization_id INTO w FROM work_items WHERE id=_work_item_id;
  IF w.id IS NULL OR w.owner_id IS NULL THEN RETURN jsonb_build_object('admitted',false,'reason','WORK_ITEM_UNRESOLVED'); END IF;
  IF _continuation THEN
    SELECT * INTO c FROM daily_update_cycles WHERE work_item_id=_work_item_id AND run_date IN (d, d-1)
      AND channels ? _channel AND (channels->_channel->>'status') IN ('STARTED','PARTIAL','PENDING_UPSTREAM')
      ORDER BY run_date DESC LIMIT 1 FOR UPDATE;
    IF c.run_date IS NULL THEN RETURN jsonb_build_object('admitted',false,'reason','NO_OPEN_CYCLE','run_date',d,'next_eligible_at',bogota_next_midnight(d)); END IF;
    UPDATE daily_update_cycles SET continuations=continuations+1, updated_at=now() WHERE run_date=c.run_date AND work_item_id=_work_item_id;
    RETURN jsonb_build_object('admitted',true,'mode','continuation','run_date',c.run_date,'channel',_channel);
  END IF;
  INSERT INTO daily_update_cycles(run_date, work_item_id, owner_id, organization_id) VALUES (d, _work_item_id, w.owner_id, w.organization_id) ON CONFLICT DO NOTHING;
  SELECT * INTO c FROM daily_update_cycles WHERE run_date=d AND work_item_id=_work_item_id FOR UPDATE;
  IF c.channels ? _channel THEN
    UPDATE daily_update_cycles SET duplicate_requests=duplicate_requests+1, updated_at=now(),
      last_duplicate=jsonb_build_object('channel',_channel,'invoker',_invoker,'trace_id',_trace_id,'retry_task_id',_retry_task_id,'at',now())
      WHERE run_date=d AND work_item_id=_work_item_id;
    RETURN jsonb_build_object('admitted',false,'reason','DAILY_UPDATE_ALREADY_STARTED','run_date',d,'channel',_channel,
      'existing',((c.channels->_channel) - 'token'),'next_eligible_at',bogota_next_midnight(d));
  END IF;
  UPDATE daily_update_cycles SET updated_at=now(), channels = channels || jsonb_build_object(_channel, jsonb_build_object(
    'status','STARTED','token',tok,'started_at',now(),'invoker',_invoker,'trace_id',_trace_id,'retry_task_id',_retry_task_id))
    WHERE run_date=d AND work_item_id=_work_item_id;
  RETURN jsonb_build_object('admitted',true,'mode','new','run_date',d,'channel',_channel,'token',tok);
END $$;
REVOKE ALL ON FUNCTION public.admit_daily_update(uuid,text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_daily_update(uuid,text,text,text,text,boolean) TO service_role;