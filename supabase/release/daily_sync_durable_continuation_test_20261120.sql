-- Run in a disposable PostgreSQL instance. The runner inserts the release DDL
-- verbatim (without its outer transaction) at the INSTALL marker.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.auto_sync_daily_ledger') IS NOT NULL THEN
    RAISE EXCEPTION 'This test requires an empty database';
  END IF;
END $$;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA net;
CREATE SCHEMA vault;
CREATE TABLE public.auto_sync_daily_ledger (
  id uuid PRIMARY KEY, organization_id uuid, run_date date, run_id text, chain_id text,
  cursor_last_work_item_id uuid, run_cutoff_time timestamptz, continuation_of uuid,
  status text, failure_reason text, items_skipped integer, trigger_source text,
  manual_initiator_user_id uuid, metadata jsonb, continuation_enqueued boolean,
  continuation_block_reason text
);
CREATE TABLE public.cron_state (key text PRIMARY KEY, value jsonb, updated_at timestamptz);
CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('SUPABASE_URL', 'https://example.invalid/'), ('CRON_SERVICE_KEY', 'mock-key');
CREATE TABLE net.mock_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, url text, headers jsonb, body jsonb, timeout_ms integer
);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO net.mock_queue(url,headers,body,timeout_ms) VALUES ($1,$2,$3,$4) RETURNING id;
$$;
-- INSTALL

DO $test$
DECLARE
  v_parent uuid := '10000000-0000-4000-8000-000000000001';
  v_child uuid := '10000000-0000-4000-8000-000000000002';
  v_cursor uuid := '20000000-0000-4000-8000-000000000001';
  v_org uuid := '30000000-0000-4000-8000-000000000001';
  v_day date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_cutoff timestamptz := now() - interval '10 minutes';
  v_signature text := 'public.enqueue_daily_sync_continuation_20261120(uuid,text,text,uuid,integer,jsonb)';
  v_result jsonb;
  v_request net.mock_queue%ROWTYPE;
BEGIN
  IF has_function_privilege('anon',v_signature,'EXECUTE') OR has_function_privilege('authenticated',v_signature,'EXECUTE')
    OR NOT has_function_privilege('service_role',v_signature,'EXECUTE') THEN
    RAISE EXCEPTION 'Function privileges are not service-role only';
  END IF;
  INSERT INTO public.auto_sync_daily_ledger(id,organization_id,run_date,run_id,chain_id,cursor_last_work_item_id,
    run_cutoff_time,status,failure_reason,items_skipped,trigger_source,metadata)
  VALUES (v_parent,v_org,v_day,'run','chain',v_cursor,v_cutoff,'PARTIAL','BUDGET_EXHAUSTED',2,'CRON','{"is_overflow":true}');

  v_result := public.enqueue_daily_sync_continuation_20261120(v_parent,'stale','chain',v_cursor,1);
  IF v_result->>'code' IS DISTINCT FROM 'STALE_PARENT' THEN RAISE EXCEPTION 'Stale run accepted'; END IF;
  v_result := public.enqueue_daily_sync_continuation_20261120(v_parent,'run','stale',v_cursor,1);
  IF v_result->>'code' IS DISTINCT FROM 'STALE_PARENT' THEN RAISE EXCEPTION 'Stale chain accepted'; END IF;
  v_result := public.enqueue_daily_sync_continuation_20261120(v_parent,'run','chain',v_child,1);
  IF v_result->>'code' IS DISTINCT FROM 'STALE_PARENT' THEN RAISE EXCEPTION 'Unexpected cursor accepted'; END IF;
  v_result := public.enqueue_daily_sync_continuation_20261120(v_parent,'run','chain',v_cursor,16);
  IF v_result->>'code' IS DISTINCT FROM 'INVALID_CONTINUATION' THEN RAISE EXCEPTION 'Unbounded continuation'; END IF;
  UPDATE public.auto_sync_daily_ledger SET run_date = v_day - 1 WHERE id = v_parent;
  v_result := public.enqueue_daily_sync_continuation_20261120(v_parent,'run','chain',v_cursor,1);
  IF v_result->>'code' IS DISTINCT FROM 'STALE_PARENT' THEN RAISE EXCEPTION 'Previous day accepted'; END IF;
  UPDATE public.auto_sync_daily_ledger SET run_date = v_day, status = 'SUCCESS' WHERE id = v_parent;
  v_result := public.enqueue_daily_sync_continuation_20261120(v_parent,'run','chain',v_cursor,1);
  IF v_result->>'code' IS DISTINCT FROM 'NO_PENDING_WORK' THEN RAISE EXCEPTION 'Finished parent replayed'; END IF;
  UPDATE public.auto_sync_daily_ledger SET status = 'PARTIAL' WHERE id = v_parent;
  INSERT INTO public.auto_sync_daily_ledger(id,run_date,chain_id,continuation_of) VALUES (v_child,v_day,'chain',v_parent);
  v_result := public.enqueue_daily_sync_continuation_20261120(v_parent,'run','chain',v_cursor,1);
  IF v_result->>'code' IS DISTINCT FROM 'CHILD_ALREADY_STARTED' THEN RAISE EXCEPTION 'Existing continuation restarted'; END IF;
  DELETE FROM public.auto_sync_daily_ledger WHERE id = v_child;
  IF EXISTS (SELECT 1 FROM net.mock_queue) THEN RAISE EXCEPTION 'Rejected requests changed the queue'; END IF;

  BEGIN
    PERFORM public.enqueue_daily_sync_continuation_20261120(v_parent,'run','chain',v_cursor,1,'{"case":2}');
    RAISE EXCEPTION USING ERRCODE = 'P9010', MESSAGE = 'Roll back enqueue test';
  EXCEPTION WHEN SQLSTATE 'P9010' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM net.mock_queue) OR EXISTS (SELECT 1 FROM public.cron_state)
    OR EXISTS (SELECT 1 FROM public.auto_sync_daily_ledger WHERE continuation_enqueued) THEN
    RAISE EXCEPTION 'Transport, receipt and parent did not roll back together';
  END IF;

  v_result := public.enqueue_daily_sync_continuation_20261120(v_parent,'run','chain',v_cursor,1,'{"case":2}');
  IF v_result->'enqueued' IS DISTINCT FROM 'true'::jsonb OR v_result->'replayed' IS DISTINCT FROM 'false'::jsonb
    OR NOT EXISTS (SELECT 1 FROM public.auto_sync_daily_ledger WHERE id = v_parent AND continuation_enqueued) THEN
    RAISE EXCEPTION 'Queue acceptance was not acknowledged by the ledger: %',v_result;
  END IF;
  SELECT * INTO STRICT v_request FROM net.mock_queue;
  IF (v_result->>'request_id')::bigint IS DISTINCT FROM v_request.id
    OR v_request.url IS DISTINCT FROM 'https://example.invalid/functions/v1/scheduled-daily-sync'
    OR v_request.timeout_ms IS DISTINCT FROM 135000 OR v_request.headers->>'x-cron-key' IS DISTINCT FROM 'mock-key'
    OR NOT (v_request.body @> jsonb_build_object('org_id',v_org,'resume_after_id',v_cursor,'continuation_of',v_parent,
      'run_cutoff_time',v_cutoff,'is_continuation',true,'is_overflow',true,'trigger_source','CRON','chain_id','chain',
      'continuation_count',1,'continuation_parent_run_id','run','continuation_queued_day',v_day,
      'item_timeout_counts','{"case":2}'::jsonb)) THEN
    RAISE EXCEPTION 'Queue request invalid';
  END IF;
  -- A lost HTTP response leaves a usable receipt. Simulate pg_net purging its
  -- request row after delivery, then ensure the producer cannot redispatch.
  DELETE FROM net.mock_queue;
  v_result := public.enqueue_daily_sync_continuation_20261120(v_parent,'run','chain',v_cursor,1,'{}');
  IF (v_result->>'request_id')::bigint IS DISTINCT FROM v_request.id OR v_result->'replayed' IS DISTINCT FROM 'true'::jsonb
    OR EXISTS (SELECT 1 FROM net.mock_queue) OR (SELECT count(*) FROM public.cron_state) <> 1 THEN
    RAISE EXCEPTION 'An unconfirmed caller response caused re-enqueue';
  END IF;
  RAISE NOTICE 'PASS: privileges, fences, bounded attempts, child dedupe, atomic rollback, durable replay';
END
$test$;
ROLLBACK;
