-- Run inside the release transaction, then ROLLBACK. This fixture only changes
-- an existing historical cycle in the transaction and produces no lasting data.
DO $test$
DECLARE v_work uuid; v_date date; v_count integer;
BEGIN
  SELECT c.work_item_id,c.run_date INTO v_work,v_date
  FROM public.daily_update_cycles c JOIN public.work_items w ON w.id=c.work_item_id
  WHERE c.run_date=(now() AT TIME ZONE 'America/Bogota')::date-1
    AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND w.deleted_at IS NULL
    AND c.organization_id IS NOT NULL LIMIT 1 FOR UPDATE OF c;
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
  IF has_function_privilege('anon','public.alert_stranded_daily_updates_20261108()','execute')
    OR has_function_privilege('authenticated','public.alert_stranded_daily_updates_20261108()','execute')
    OR NOT has_function_privilege('service_role','public.alert_stranded_daily_updates_20261108()','execute') THEN
    RAISE EXCEPTION 'watchdog execute grants are wrong';
  END IF;
END
$test$;
