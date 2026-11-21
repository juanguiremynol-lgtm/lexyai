DO $test$
DECLARE
  v_parent uuid := '10000000-0000-4000-8000-000000000011';
  v_child uuid := '10000000-0000-4000-8000-000000000012';
  v_cursor uuid := '20000000-0000-4000-8000-000000000011';
  v_org uuid := '30000000-0000-4000-8000-000000000011';
  v_day date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_key text := 'daily_sync_continuation:' || jsonb_build_array(v_parent, 'restart-chain', 'restart-run')::text;
  old_id bigint;
  new_id bigint;
  expected_body jsonb;
  result jsonb;
BEGIN
  IF has_function_privilege('anon','public.recover_daily_sync_after_restart_20261121(boolean)','EXECUTE')
    OR has_function_privilege('authenticated','public.recover_daily_sync_after_restart_20261121(boolean)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.recover_daily_sync_after_restart_20261121(boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Recovery privileges must be service-role only';
  END IF;
  INSERT INTO public.auto_sync_daily_ledger(id,organization_id,run_date,run_id,chain_id,
    cursor_last_work_item_id,run_cutoff_time,status,failure_reason,items_skipped,trigger_source,metadata)
  VALUES (v_parent,v_org,v_day,'restart-run','restart-chain',v_cursor,now()-interval '1 hour',
    'PARTIAL','BUDGET_EXHAUSTED',3,'CRON','{"timeout_count":2}');
  result := public.enqueue_daily_sync_continuation_20261120(v_parent,'restart-run','restart-chain',v_cursor,1,'{"case":2}');
  old_id := (result->>'request_id')::bigint;
  SELECT body INTO STRICT expected_body FROM net.mock_queue WHERE id=old_id;
  UPDATE public.cron_state SET updated_at=now()-interval '1 hour' WHERE key=v_key;
  IF (public.recover_daily_sync_after_restart_20261121(true)->>'eligible')::integer <> 0 THEN
    RAISE EXCEPTION 'A pending request was considered lost';
  END IF;
  DELETE FROM net.mock_queue WHERE id=old_id;
  INSERT INTO net._http_response(id) VALUES (old_id);
  IF (public.recover_daily_sync_after_restart_20261121(true)->>'eligible')::integer <> 0 THEN
    RAISE EXCEPTION 'A request with a response was considered lost';
  END IF;
  DELETE FROM net._http_response WHERE id=old_id;
  INSERT INTO public.auto_sync_daily_ledger(id,run_date,chain_id,continuation_of)
    VALUES(v_child,v_day,'restart-chain',v_parent);
  IF (public.recover_daily_sync_after_restart_20261121(true)->>'eligible')::integer <> 0 THEN
    RAISE EXCEPTION 'A continuation with an admitted child was considered lost';
  END IF;
  DELETE FROM public.auto_sync_daily_ledger WHERE id=v_child;

  UPDATE public.cron_state SET value=value-'item_timeout_counts' WHERE key=v_key;
  IF (public.recover_daily_sync_after_restart_20261121(true)->>'eligible')::integer <> 0 THEN
    RAISE EXCEPTION 'Missing timeout history was accepted';
  END IF;
  UPDATE public.cron_state SET value=value||'{"item_timeout_counts":{"case":2}}'::jsonb WHERE key=v_key;
  result := public.recover_daily_sync_after_restart_20261121();
  IF NOT result @> '{"eligible":1,"requested":0,"dry_run":true}'::jsonb
    OR EXISTS (SELECT 1 FROM net.mock_queue) THEN
    RAISE EXCEPTION 'Dry run changed the transport or missed an eligible continuation: %',result;
  END IF;

  result := public.recover_daily_sync_after_restart_20261121(false);
  SELECT (value->>'request_id')::bigint INTO STRICT new_id FROM public.cron_state WHERE key=v_key;
  IF NOT result @> '{"eligible":1,"requested":1}'::jsonb OR new_id IS NOT DISTINCT FROM old_id
    OR (SELECT body FROM net.mock_queue WHERE id=new_id) IS DISTINCT FROM expected_body
    OR (SELECT value->'previous_request_ids' FROM public.cron_state WHERE key=v_key) IS DISTINCT FROM jsonb_build_array(old_id) THEN
    RAISE EXCEPTION 'Recovery did not preserve the exact payload and receipt history: %',result;
  END IF;
  DELETE FROM net.mock_queue WHERE id=new_id;
  result := public.recover_daily_sync_after_restart_20261121(false);
  IF NOT result @> '{"eligible":0,"requested":0}'::jsonb OR EXISTS (SELECT 1 FROM net.mock_queue) THEN
    RAISE EXCEPTION 'A repeat in the same PostgreSQL boot sent a duplicate: %',result;
  END IF;
END
$test$;
