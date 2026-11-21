BEGIN;

SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.enqueue_daily_sync_continuation_20261120(uuid,text,text,uuid,integer,jsonb)'::regprocedure))
      IS DISTINCT FROM '9645d8104fd144338114959529623ae2' THEN
    RAISE EXCEPTION 'Unexpected installed daily continuation definition';
  END IF;
END
$guard$;

-- A caller retry in the same PostgreSQL session epoch keeps its existing
-- receipt. A restart can discard the unlogged pg_net request and response.
CREATE FUNCTION public.daily_sync_continuation_lost_on_restart(_receipt jsonb, _queued_at timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog
AS $function$
  SELECT _queued_at < pg_postmaster_start_time()
    AND now() >= pg_postmaster_start_time() + interval '90 seconds'
    AND now() >= _queued_at + interval '3 minutes'
    AND _receipt->'enqueued' = 'true'::jsonb
    AND coalesce(jsonb_array_length(_receipt->'previous_request_ids'), 0) < 2
    AND prior.request_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM net.http_request_queue q WHERE q.id = prior.request_id)
    AND NOT EXISTS (SELECT 1 FROM net._http_response r WHERE r.id = prior.request_id)
  FROM (
    SELECT CASE WHEN _receipt->>'request_id' ~ '^[1-9][0-9]{0,17}$'
      THEN (_receipt->>'request_id')::bigint END AS request_id
  ) prior;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_daily_sync_continuation_20261120(
  _parent_id uuid, _run_id text, _chain_id text, _resume_after_id uuid,
  _continuation_count integer, _item_timeout_counts jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_now timestamptz := now();
  v_day date := (v_now AT TIME ZONE 'America/Bogota')::date;
  v_parent public.auto_sync_daily_ledger%ROWTYPE;
  v_key text;
  v_receipt jsonb;
  v_previous jsonb;
  v_queued_at timestamptz;
  v_request bigint;
  v_base text;
  v_secret text;
BEGIN
  IF _parent_id IS NULL OR _resume_after_id IS NULL
    OR coalesce(length(_run_id), 0) NOT BETWEEN 1 AND 100
    OR coalesce(length(_chain_id), 0) NOT BETWEEN 1 AND 100
    OR _continuation_count IS NULL OR _continuation_count NOT BETWEEN 1 AND 15
    OR jsonb_typeof(_item_timeout_counts) IS DISTINCT FROM 'object'
    OR octet_length(_item_timeout_counts::text) > 32768 THEN
    RETURN jsonb_build_object('enqueued', false, 'code', 'INVALID_CONTINUATION');
  END IF;

  SELECT * INTO v_parent FROM public.auto_sync_daily_ledger WHERE id = _parent_id FOR UPDATE;
  IF NOT FOUND OR v_parent.run_date IS DISTINCT FROM v_day
    OR v_parent.run_id IS DISTINCT FROM _run_id OR v_parent.chain_id IS DISTINCT FROM _chain_id
    OR v_parent.cursor_last_work_item_id IS DISTINCT FROM _resume_after_id
    OR v_parent.run_cutoff_time IS NULL OR v_parent.run_cutoff_time > v_now
    OR v_parent.organization_id IS NULL THEN
    RETURN jsonb_build_object('enqueued', false, 'code', 'STALE_PARENT');
  END IF;

  v_key := 'daily_sync_continuation:' || jsonb_build_array(_parent_id, _chain_id, _run_id)::text;
  SELECT value, updated_at INTO v_previous, v_queued_at FROM public.cron_state WHERE key = v_key;
  IF FOUND THEN
    IF public.daily_sync_continuation_lost_on_restart(v_previous, v_queued_at) IS NOT TRUE
      OR v_previous->>'cursor' IS DISTINCT FROM _resume_after_id::text
      OR v_previous->>'continuation_count' IS DISTINCT FROM _continuation_count::text
      OR v_parent.trigger_source IS DISTINCT FROM 'CRON' THEN
      RETURN v_previous || jsonb_build_object('replayed', true);
    END IF;
    IF jsonb_typeof(v_previous->'item_timeout_counts') = 'object' THEN
      _item_timeout_counts := v_previous->'item_timeout_counts';
    ELSIF v_parent.continuation_of IS NULL AND v_parent.metadata->>'timeout_count' = '0' THEN
      _item_timeout_counts := '{}'::jsonb;
    ELSE
      RETURN jsonb_build_object('enqueued', false, 'code', 'MISSING_TIMEOUT_HISTORY');
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.auto_sync_daily_ledger child
    WHERE child.continuation_of = _parent_id AND child.chain_id = _chain_id AND child.run_date = v_day) THEN
    RETURN jsonb_build_object('enqueued', false, 'code', 'CHILD_ALREADY_STARTED');
  END IF;
  IF ((v_parent.status::text IN ('PARTIAL', 'CONTINUING') OR v_parent.status::text = 'FAILED')
    AND (coalesce(v_parent.failure_reason, '') = 'BUDGET_EXHAUSTED'
      OR (v_parent.status::text IN ('PARTIAL', 'CONTINUING') AND coalesce(v_parent.items_skipped, 0) > 0))) IS NOT TRUE THEN
    RETURN jsonb_build_object('enqueued', false, 'code', 'NO_PENDING_WORK');
  END IF;

  SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SERVICE_KEY' LIMIT 1;
  IF coalesce(v_base, '') = '' OR coalesce(v_secret, '') = '' THEN
    RAISE EXCEPTION 'Daily sync continuation requires the existing Vault credentials';
  END IF;
  SELECT net.http_post(
    url := rtrim(v_base, '/') || '/functions/v1/scheduled-daily-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', v_secret,
      'x-invoker-function', 'scheduled-daily-sync'),
    body := jsonb_build_object(
      'org_id', v_parent.organization_id, 'resume_after_id', v_parent.cursor_last_work_item_id,
      'is_continuation', true, 'continuation_of', v_parent.id, 'continuation_count', _continuation_count,
      'continuation_parent_run_id', v_parent.run_id, 'continuation_queued_day', v_day,
      'run_cutoff_time', v_parent.run_cutoff_time, 'chain_id', v_parent.chain_id,
      'trigger_source', v_parent.trigger_source, 'manual_initiator_user_id', v_parent.manual_initiator_user_id,
      'is_overflow', coalesce(v_parent.metadata->'is_overflow' = 'true'::jsonb, false),
      'item_timeout_counts', _item_timeout_counts),
    timeout_milliseconds := 135000
  ) INTO v_request;
  IF v_request IS NULL THEN RAISE EXCEPTION 'Daily continuation queue did not return a request ID'; END IF;

  v_receipt := jsonb_build_object('enqueued', true, 'request_id', v_request,
    'run_date', v_day, 'parent_id', _parent_id, 'run_id', _run_id, 'chain_id', _chain_id,
    'cursor', _resume_after_id, 'continuation_count', _continuation_count, 'replayed', false,
    'item_timeout_counts', _item_timeout_counts,
    'previous_request_ids', CASE WHEN v_previous IS NULL THEN '[]'::jsonb ELSE
      coalesce(v_previous->'previous_request_ids', '[]'::jsonb) || jsonb_build_array(v_previous->'request_id') END);
  INSERT INTO public.cron_state(key, value, updated_at) VALUES (v_key, v_receipt, v_now)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
  UPDATE public.auto_sync_daily_ledger SET continuation_enqueued = true, continuation_block_reason = NULL
    WHERE id = _parent_id;
  RETURN v_receipt;
END
$function$;

CREATE FUNCTION public.recover_daily_sync_after_restart_20261121(_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_day date := (now() AT TIME ZONE 'America/Bogota')::date;
  candidate record;
  result jsonb;
  checked integer := 0;
  requested integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('andromeda-daily-sync-restart-recovery-20261121')) THEN
    RETURN jsonb_build_object('state', 'busy', 'requested', 0);
  END IF;
  FOR candidate IN
    SELECT l.id, l.run_id, l.chain_id, l.cursor_last_work_item_id,
      (s.value->>'continuation_count')::integer AS continuation_count
    FROM public.auto_sync_daily_ledger l
    JOIN public.cron_state s
      ON s.key = 'daily_sync_continuation:' || jsonb_build_array(l.id, l.chain_id, l.run_id)::text
    WHERE l.run_date = v_day AND l.trigger_source = 'CRON' AND l.continuation_enqueued IS TRUE
      AND l.cursor_last_work_item_id::text = s.value->>'cursor'
      AND (s.value->>'continuation_count') ~ '^(?:[1-9]|1[0-5])$'
      AND l.status::text IN ('PARTIAL', 'CONTINUING', 'FAILED')
      AND (l.failure_reason = 'BUDGET_EXHAUSTED' OR
        (l.status::text IN ('PARTIAL', 'CONTINUING') AND l.items_skipped > 0))
      AND (jsonb_typeof(s.value->'item_timeout_counts') = 'object' OR
        (l.continuation_of IS NULL AND l.metadata->>'timeout_count' = '0'))
      AND NOT EXISTS (SELECT 1 FROM public.auto_sync_daily_ledger child
        WHERE child.run_date = v_day AND child.continuation_of = l.id AND child.chain_id = l.chain_id)
      AND public.daily_sync_continuation_lost_on_restart(s.value, s.updated_at)
    ORDER BY s.updated_at LIMIT 4
  LOOP
    checked := checked + 1;
    IF _dry_run IS FALSE THEN
      result := public.enqueue_daily_sync_continuation_20261120(candidate.id, candidate.run_id,
        candidate.chain_id, candidate.cursor_last_work_item_id, candidate.continuation_count);
      IF result->'enqueued' = 'true'::jsonb AND result->'replayed' = 'false'::jsonb THEN
        requested := requested + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('date', v_day, 'dry_run', _dry_run,
    'eligible', checked, 'requested', requested);
END
$function$;

REVOKE ALL ON FUNCTION public.daily_sync_continuation_lost_on_restart(jsonb,timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_daily_sync_after_restart_20261121(boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_daily_sync_after_restart_20261121(boolean) TO service_role;

COMMIT;
