BEGIN;

-- The existing restart recovery handles deliveries without a child. A started
-- child with a persisted checkpoint must continue from its own cursor.
DO $patch$
DECLARE
  definition text := pg_get_functiondef(
    'public.enqueue_daily_sync_continuation_20261120(uuid,text,text,uuid,integer,jsonb)'::regprocedure
  );
  old_condition text := $condition$coalesce(v_parent.failure_reason, '') = 'BUDGET_EXHAUSTED'$condition$;
  new_condition text := $condition$(coalesce(v_parent.failure_reason, '') = 'BUDGET_EXHAUSTED'
      OR (v_parent.failure_reason = 'STALE_STARTED_CONTINUATION'
        AND v_parent.status::text = 'FAILED'
        AND v_parent.is_continuation IS TRUE
        AND v_parent.trigger_source = 'CRON'))$condition$;
BEGIN
  IF strpos(definition, new_condition) = 0 THEN
    IF length(definition) - length(replace(definition, old_condition, '')) <> length(old_condition) THEN
      RAISE EXCEPTION 'Unexpected daily continuation admission definition';
    END IF;
    EXECUTE replace(definition, old_condition, new_condition);
  END IF;
END;
$patch$;

CREATE OR REPLACE FUNCTION public.recover_interrupted_daily_sync_child_20261124(
  _dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  checked_at timestamptz := now();
  local_time timestamp := checked_at AT TIME ZONE 'America/Bogota';
  restarted_at timestamptz := pg_postmaster_start_time();
  candidate record;
  receipt jsonb;
  eligible integer := 0;
  requested integer := 0;
  refused integer := 0;
BEGIN
  IF local_time::time < time '07:00' OR local_time::time >= time '11:00' THEN
    RETURN jsonb_build_object('state', 'outside_continuation_window', 'eligible', 0, 'requested', 0);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('andromeda-daily-sync-restart-recovery-20261121')) THEN
    RETURN jsonb_build_object('state', 'busy', 'eligible', 0, 'requested', 0);
  END IF;

  FOR candidate IN
    SELECT child.id, child.run_id, child.chain_id, child.cursor_last_work_item_id,
      (state.value->>'continuation_count')::integer + 1 AS next_count,
      state.value->'item_timeout_counts' AS timeout_history
    FROM public.auto_sync_daily_ledger child
    JOIN public.auto_sync_daily_ledger parent ON parent.id = child.continuation_of
    JOIN public.cron_state state
      ON state.key = 'daily_sync_continuation:' || jsonb_build_array(parent.id, parent.chain_id, parent.run_id)::text
    CROSS JOIN LATERAL (
      SELECT CASE WHEN state.value->>'request_id' ~ '^[1-9][0-9]{0,17}$'
        THEN (state.value->>'request_id')::bigint END AS id
    ) request
    LEFT JOIN net._http_response response ON response.id = request.id
    WHERE child.run_date = local_time::date
      AND child.trigger_source = 'CRON'
      AND child.status = 'RUNNING'
      AND child.is_continuation IS TRUE
      AND child.finished_at IS NULL AND child.completed_at IS NULL
      AND child.scheduled_for IS NOT NULL
      AND child.started_at <= child.last_heartbeat_at
      AND child.last_heartbeat_at <= checked_at - interval '15 minutes'
      AND child.run_cutoff_time = parent.run_cutoff_time
      AND child.organization_id = parent.organization_id
      AND child.chain_id = parent.chain_id AND child.run_date = parent.run_date
      AND child.cursor_last_work_item_id > parent.cursor_last_work_item_id
      AND child.timeout_count = 0
      AND coalesce(child.metadata->>'is_overflow', 'false') = 'false'
      AND child.continuation_enqueued IS NOT TRUE
      AND parent.continuation_enqueued IS TRUE
      AND state.value->'enqueued' = 'true'::jsonb
      AND state.value->>'cursor' = parent.cursor_last_work_item_id::text
      AND state.value->>'continuation_count' ~ '^(?:[1-9]|1[0-3])$'
      AND jsonb_typeof(state.value->'item_timeout_counts') = 'object'
      AND request.id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM net.http_request_queue q WHERE q.id = request.id)
      AND (
        response.timed_out IS TRUE
        OR response.status_code IN (408, 500, 502, 503, 504)
        OR (response.id IS NULL AND child.last_heartbeat_at < restarted_at
          AND checked_at >= restarted_at + interval '90 seconds')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.auto_sync_daily_ledger other
        WHERE other.continuation_of = child.id
           OR (other.id <> child.id AND other.organization_id = child.organization_id
             AND other.run_date = child.run_date AND other.status = 'RUNNING'
             AND (other.chain_id = child.chain_id
               OR other.last_heartbeat_at > checked_at - interval '15 minutes'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.cron_state prior
        WHERE prior.key = 'daily_sync_continuation:' || jsonb_build_array(child.id, child.chain_id, child.run_id)::text
      )
    ORDER BY child.last_heartbeat_at, child.id
    LIMIT 4
    FOR UPDATE OF child SKIP LOCKED
  LOOP
    eligible := eligible + 1;
    IF _dry_run IS DISTINCT FROM false THEN
      CONTINUE;
    END IF;

    -- The ledger transition and pg_net enqueue must commit together.
    BEGIN
      UPDATE public.auto_sync_daily_ledger
      SET status = 'FAILED', failure_reason = 'STALE_STARTED_CONTINUATION',
        finished_at = checked_at, updated_at = checked_at
      WHERE id = candidate.id;

      receipt := public.enqueue_daily_sync_continuation_20261120(
        candidate.id, candidate.run_id, candidate.chain_id,
        candidate.cursor_last_work_item_id, candidate.next_count, candidate.timeout_history
      );
      IF NOT (receipt->'enqueued' = 'true'::jsonb AND receipt->'replayed' = 'false'::jsonb) IS TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'P2401', MESSAGE = 'Continuation enqueue refused';
      END IF;
      requested := requested + 1;
    EXCEPTION WHEN SQLSTATE 'P2401' THEN
      refused := refused + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('date', local_time::date, 'dry_run', _dry_run,
    'eligible', eligible, 'requested', requested, 'refused', refused);
END;
$function$;

REVOKE ALL ON FUNCTION public.recover_interrupted_daily_sync_child_20261124(boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_interrupted_daily_sync_child_20261124(boolean) TO service_role;

DO $cron$
DECLARE
  prior text := 'SELECT public.recover_daily_sync_after_restart_20261121(false), public.enqueue_stale_started_acts_20261121(false);';
  updated text := 'SELECT public.recover_daily_sync_after_restart_20261121(false), public.enqueue_stale_started_acts_20261121(false), public.recover_interrupted_daily_sync_child_20261124(false);';
  current_command text;
BEGIN
  SELECT command INTO current_command FROM cron.job WHERE jobid = 110 AND active;
  IF current_command = prior THEN
    PERFORM cron.alter_job(110, command := updated);
  ELSIF current_command IS DISTINCT FROM updated THEN
    RAISE EXCEPTION 'Restart recovery schedule no longer matches the expected configuration';
  END IF;
END;
$cron$;

COMMIT;
