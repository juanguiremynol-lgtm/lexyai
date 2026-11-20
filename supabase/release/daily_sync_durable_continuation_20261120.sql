BEGIN;

-- pg_net starts delivery only after commit. The queue entry, the receipt and
-- the parent ledger acknowledgment therefore survive or roll back together.
CREATE FUNCTION public.enqueue_daily_sync_continuation_20261120(
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
  SELECT value INTO v_receipt FROM public.cron_state WHERE key = v_key;
  IF FOUND THEN
    RETURN v_receipt || jsonb_build_object('replayed', true);
  END IF;

  -- An earlier dispatcher may already have delivered this exact child.
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
  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Daily sync continuation queue did not return a request ID';
  END IF;

  v_receipt := jsonb_build_object('enqueued', true, 'request_id', v_request,
    'run_date', v_day, 'parent_id', _parent_id, 'run_id', _run_id, 'chain_id', _chain_id,
    'cursor', _resume_after_id, 'continuation_count', _continuation_count, 'replayed', false);
  INSERT INTO public.cron_state(key, value, updated_at) VALUES (v_key, v_receipt, v_now);
  UPDATE public.auto_sync_daily_ledger SET continuation_enqueued = true, continuation_block_reason = NULL
    WHERE id = _parent_id;
  RETURN v_receipt;
END
$function$;

REVOKE ALL ON FUNCTION public.enqueue_daily_sync_continuation_20261120(uuid,text,text,uuid,integer,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_daily_sync_continuation_20261120(uuid,text,text,uuid,integer,jsonb)
  TO service_role;

COMMIT;
