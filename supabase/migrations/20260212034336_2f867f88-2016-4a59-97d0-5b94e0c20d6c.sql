
-- Fix: use text cast for scrape_status comparison since it's an enum
CREATE OR REPLACE FUNCTION public.atenia_assurance_gates()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_result jsonb;
  v_bogota_day_start timestamptz;
  v_daily_enqueue jsonb;
  v_watchdog_liveness jsonb;
  v_coverage jsonb;
  v_queue_bounded jsonb;
  v_heartbeat_liveness jsonb;
  v_omitido_backlog jsonb;
  v_last_watchdog_at timestamptz;
  v_last_heartbeat_at timestamptz;
  v_pending_count bigint;
  v_pending_age_minutes double precision;
  v_coverage_pct numeric;
  v_missing_count bigint;
  v_total_monitored bigint;
  v_attempted_24h bigint;
  v_omitido_count bigint;
BEGIN
  v_bogota_day_start := date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota';

  -- Gate A: DAILY_ENQUEUE
  SELECT jsonb_build_object(
    'ok', COALESCE(cr.status = 'OK', false),
    'status', COALESCE(cr.status, 'NOT_FOUND'),
    'finished_at', cr.finished_at,
    'started_at', cr.started_at
  ) INTO v_daily_enqueue
  FROM atenia_cron_runs cr
  WHERE cr.job_name = 'DAILY_ENQUEUE'
    AND cr.scheduled_for >= v_bogota_day_start
  ORDER BY cr.started_at DESC
  LIMIT 1;
  
  IF v_daily_enqueue IS NULL THEN
    v_daily_enqueue := '{"ok": false, "status": "NOT_FOUND"}'::jsonb;
  END IF;

  -- Gate B: WATCHDOG liveness
  SELECT cr.finished_at INTO v_last_watchdog_at
  FROM atenia_cron_runs cr
  WHERE cr.job_name = 'WATCHDOG' AND cr.status = 'OK'
  ORDER BY cr.finished_at DESC NULLS LAST
  LIMIT 1;

  v_watchdog_liveness := jsonb_build_object(
    'ok', v_last_watchdog_at IS NOT NULL AND v_last_watchdog_at > now() - interval '15 minutes',
    'last_ok_at', v_last_watchdog_at,
    'gap_minutes', CASE WHEN v_last_watchdog_at IS NOT NULL 
      THEN ROUND(EXTRACT(EPOCH FROM (now() - v_last_watchdog_at)) / 60)
      ELSE NULL END
  );

  -- Gate C: Coverage
  SELECT COUNT(*) INTO v_total_monitored
  FROM work_items WHERE monitoring_enabled = true;

  SELECT COUNT(DISTINCT wi.id) INTO v_attempted_24h
  FROM work_items wi
  WHERE wi.monitoring_enabled = true
    AND EXISTS (
      SELECT 1 FROM sync_traces st
      WHERE st.work_item_id = wi.id
        AND st.created_at > now() - interval '24 hours'
    );

  v_missing_count := v_total_monitored - v_attempted_24h;
  v_coverage_pct := CASE WHEN v_total_monitored > 0 
    THEN ROUND((v_attempted_24h::numeric / v_total_monitored) * 100, 1)
    ELSE 100 END;

  v_coverage := jsonb_build_object(
    'ok', v_coverage_pct >= 80,
    'coverage_pct', v_coverage_pct,
    'total_monitored', v_total_monitored,
    'attempted_24h', v_attempted_24h,
    'missing', v_missing_count
  );

  -- Gate D: Queue boundedness
  SELECT COUNT(*) INTO v_pending_count
  FROM atenia_ai_remediation_queue WHERE status = 'PENDING';

  SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at))) / 60.0
  INTO v_pending_age_minutes
  FROM atenia_ai_remediation_queue WHERE status = 'PENDING';

  v_queue_bounded := jsonb_build_object(
    'ok', v_pending_count <= 500,
    'pending', v_pending_count,
    'oldest_age_minutes', ROUND(COALESCE(v_pending_age_minutes, 0))
  );

  -- Gate E: OMITIDO backlog — items never truly synced but marked as attempted
  -- Use text comparison to avoid enum issues
  SELECT COUNT(*) INTO v_omitido_count
  FROM work_items wi
  WHERE wi.monitoring_enabled = true
    AND wi.scrape_status::text IN ('NOT_ATTEMPTED', 'FAILED')
    AND (wi.last_synced_at IS NULL OR wi.last_synced_at < now() - interval '48 hours');

  v_omitido_backlog := jsonb_build_object(
    'ok', v_omitido_count = 0,
    'count', v_omitido_count
  );

  -- Gate F: HEARTBEAT liveness
  SELECT cr.finished_at INTO v_last_heartbeat_at
  FROM atenia_cron_runs cr
  WHERE cr.job_name = 'HEARTBEAT' AND cr.status = 'OK'
  ORDER BY cr.finished_at DESC NULLS LAST
  LIMIT 1;

  v_heartbeat_liveness := jsonb_build_object(
    'ok', v_last_heartbeat_at IS NOT NULL AND v_last_heartbeat_at > now() - interval '35 minutes',
    'last_ok_at', v_last_heartbeat_at,
    'gap_minutes', CASE WHEN v_last_heartbeat_at IS NOT NULL
      THEN ROUND(EXTRACT(EPOCH FROM (now() - v_last_heartbeat_at)) / 60)
      ELSE NULL END
  );

  v_result := jsonb_build_object(
    'computed_at', now(),
    'all_ok', (v_daily_enqueue->>'ok')::boolean
      AND (v_watchdog_liveness->>'ok')::boolean
      AND (v_coverage->>'ok')::boolean
      AND (v_queue_bounded->>'ok')::boolean
      AND (v_omitido_backlog->>'ok')::boolean
      AND (v_heartbeat_liveness->>'ok')::boolean,
    'gates', jsonb_build_object(
      'A_daily_enqueue', v_daily_enqueue,
      'B_watchdog_liveness', v_watchdog_liveness,
      'C_coverage', v_coverage,
      'D_queue_bounded', v_queue_bounded,
      'E_omitido_backlog', v_omitido_backlog,
      'F_heartbeat_liveness', v_heartbeat_liveness
    )
  );

  RETURN v_result;
END;
$$;
