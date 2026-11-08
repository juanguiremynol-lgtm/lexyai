-- Run inside the release transaction, then ROLLBACK. This fixture only changes
-- an existing historical cycle in the transaction and produces no lasting data.
DO $test$
DECLARE v_work uuid; v_date date; v_org uuid; v_workflow text; v_count integer;
BEGIN
  SELECT c.work_item_id,c.run_date,c.organization_id,w.workflow_type::text
    INTO v_work,v_date,v_org,v_workflow
  FROM public.daily_update_cycles c JOIN public.work_items w ON w.id=c.work_item_id
  WHERE c.run_date=(now() AT TIME ZONE 'America/Bogota')::date-1
    AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND w.deleted_at IS NULL
    AND c.organization_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.work_item_sync_timeline t WHERE t.work_item_id=c.work_item_id
      AND t.operation='acts' AND t.status='success' AND t.finished_at>now()-interval '31 minutes')
    LIMIT 1 FOR UPDATE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'no isolated fixture cycle available'; END IF;
  UPDATE public.daily_update_cycles SET channels=jsonb_build_object(
    'acts',jsonb_build_object('status','STARTED','started_at',now()-interval '31 minutes','trace_id','test-watchdog-old'),
    'pubs',jsonb_build_object('status','STARTED','started_at',now()-interval '5 minutes','trace_id','test-watchdog-young'))
    WHERE work_item_id=v_work AND run_date=v_date;
  PERFORM public.alert_stranded_daily_updates_20261108();
  PERFORM public.alert_stranded_daily_updates_20261108();
  SELECT count(*) INTO v_count FROM public.system_health_events
    WHERE metadata->>'trace_id'='test-watchdog-old' AND metadata->>'work_item_id'=v_work::text
      AND service='DAILY_UPDATE_WATCHDOG' AND status='WARN';
  IF v_count<>1 THEN RAISE EXCEPTION 'old started attempt must alert exactly once: %',v_count; END IF;
  IF EXISTS(SELECT 1 FROM public.system_health_events WHERE metadata->>'trace_id'='test-watchdog-young') THEN
    RAISE EXCEPTION 'young attempt must not alert';
  END IF;
  UPDATE public.daily_update_cycles SET channels=jsonb_build_object(
    'acts',jsonb_build_object('status','SUCCESS','started_at',now()-interval '31 minutes','trace_id','test-watchdog-success'))
    WHERE work_item_id=v_work AND run_date=v_date;
  PERFORM public.alert_stranded_daily_updates_20261108();
  IF EXISTS(SELECT 1 FROM public.system_health_events WHERE metadata->>'trace_id'='test-watchdog-success') THEN
    RAISE EXCEPTION 'completed attempt must not alert';
  END IF;
  UPDATE public.daily_update_cycles SET channels=jsonb_build_object(
    'acts',jsonb_build_object('status','STARTED','started_at','invalid','trace_id','test-watchdog-invalid')),
    updated_at=now()-interval '31 minutes' WHERE work_item_id=v_work AND run_date=v_date;
  PERFORM public.alert_stranded_daily_updates_20261108();
  IF NOT EXISTS(SELECT 1 FROM public.system_health_events WHERE metadata->>'trace_id'='test-watchdog-invalid'
    AND metadata->>'reference_kind'='last_update' AND status='WARN') THEN
    RAISE EXCEPTION 'invalid start timestamp must use the older update timestamp';
  END IF;
  -- An incomplete later read does not suppress the alert.
  INSERT INTO public.work_item_sync_timeline(work_item_id,organization_id,provider,operation,status,
    function_name,started_at,finished_at,metadata)
  VALUES(v_work,v_org,CASE WHEN v_workflow='CPACA' THEN 'samai' ELSE 'cpnu' END,'acts','success',
    'watchdog-test',now()-interval '2 minutes',now()-interval '1 minute',
    jsonb_build_object('source_complete',false,'source_observed_at',now()-interval '1 minute'));
  UPDATE public.daily_update_cycles SET channels=jsonb_build_object(
    'acts',jsonb_build_object('status','STARTED','started_at',now()-interval '31 minutes','trace_id','test-watchdog-incomplete'))
    WHERE work_item_id=v_work AND run_date=v_date;
  PERFORM public.alert_stranded_daily_updates_20261108();
  IF NOT EXISTS(SELECT 1 FROM public.system_health_events WHERE metadata->>'trace_id'='test-watchdog-incomplete') THEN
    RAISE EXCEPTION 'incomplete later source read must not suppress alert';
  END IF;
  -- A later complete observation by the applicable provider does supersede it.
  INSERT INTO public.work_item_sync_timeline(work_item_id,organization_id,provider,operation,status,
    function_name,started_at,finished_at,metadata)
  VALUES(v_work,v_org,CASE WHEN v_workflow='CPACA' THEN 'samai' ELSE 'cpnu' END,'acts','success',
    'watchdog-test',now()-interval '2 minutes',now()-interval '1 minute',
    jsonb_build_object('source_complete',true,'source_observed_at',now()-interval '1 minute'));
  UPDATE public.daily_update_cycles SET channels=jsonb_build_object(
    'acts',jsonb_build_object('status','STARTED','started_at',now()-interval '31 minutes','trace_id','test-watchdog-superseded'))
    WHERE work_item_id=v_work AND run_date=v_date;
  PERFORM public.alert_stranded_daily_updates_20261108();
  IF EXISTS(SELECT 1 FROM public.system_health_events WHERE metadata->>'trace_id'='test-watchdog-superseded') THEN
    RAISE EXCEPTION 'a certified later source observation must supersede the warning';
  END IF;
  IF has_function_privilege('anon','public.alert_stranded_daily_updates_20261108()','execute')
    OR has_function_privilege('authenticated','public.alert_stranded_daily_updates_20261108()','execute')
    OR NOT has_function_privilege('service_role','public.alert_stranded_daily_updates_20261108()','execute') THEN
    RAISE EXCEPTION 'watchdog execute grants are wrong';
  END IF;
END
$test$;
