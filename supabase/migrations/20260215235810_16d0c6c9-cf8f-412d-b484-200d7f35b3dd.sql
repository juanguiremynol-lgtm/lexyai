
-- Consolidated Daily Sync Health Snapshot function
-- Returns platform summary + problem orgs for a given date range
CREATE OR REPLACE FUNCTION public.daily_sync_health_snapshot(
  p_days integer DEFAULT 7,
  p_target_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_platform_summary jsonb;
  v_problem_orgs jsonb;
  v_start_date date;
BEGIN
  v_start_date := p_target_date - p_days;

  -- PLATFORM SUMMARY (per day)
  WITH base AS (
    SELECT *
    FROM auto_sync_daily_ledger
    WHERE run_date >= v_start_date AND run_date <= p_target_date
  ),
  chain_agg AS (
    SELECT
      organization_id,
      run_date,
      chain_id,
      MIN(started_at) AS chain_start,
      MAX(finished_at) AS chain_end,
      COUNT(*) AS chain_length,
      SUM(COALESCE(items_succeeded, 0)) AS total_succeeded,
      SUM(COALESCE(items_failed, 0)) AS total_failed,
      SUM(COALESCE(items_skipped, 0)) AS total_skipped,
      SUM(COALESCE(dead_letter_count, 0)) AS total_dead_lettered,
      SUM(COALESCE(timeout_count, 0)) AS total_timeouts,
      MAX(created_at) AS last_row_created_at
    FROM base
    GROUP BY organization_id, run_date, chain_id
  ),
  chain_last AS (
    SELECT DISTINCT ON (b.organization_id, b.run_date, b.chain_id)
      b.organization_id,
      b.run_date,
      b.chain_id,
      b.status AS last_status,
      b.failure_reason AS last_failure_reason
    FROM base b
    JOIN chain_agg a
      ON a.organization_id = b.organization_id
     AND a.run_date = b.run_date
     AND a.chain_id = b.chain_id
     AND a.last_row_created_at = b.created_at
  ),
  per_org_day AS (
    SELECT
      a.organization_id,
      a.run_date,
      a.chain_id,
      a.chain_start,
      a.chain_end,
      EXTRACT(EPOCH FROM (a.chain_end - a.chain_start)) / 60.0 AS convergence_minutes,
      a.chain_length,
      a.total_succeeded,
      a.total_failed,
      a.total_skipped,
      a.total_dead_lettered,
      a.total_timeouts,
      l.last_status,
      l.last_failure_reason,
      (l.last_status = 'SUCCESS' AND a.total_skipped = 0) AS fully_synced
    FROM chain_agg a
    JOIN chain_last l USING (organization_id, run_date, chain_id)
  ),
  first_sync AS (
    SELECT
      organization_id,
      run_date,
      MIN(chain_start) AS first_sync_at
    FROM per_org_day
    GROUP BY organization_id, run_date
  ),
  platform_day AS (
    SELECT
      p.run_date,
      COUNT(DISTINCT p.organization_id) AS orgs_seen,
      COUNT(*) FILTER (WHERE p.fully_synced) AS orgs_fully_synced,
      ROUND(100.0 * COUNT(*) FILTER (WHERE p.fully_synced) / NULLIF(COUNT(*), 0), 1) AS pct_fully_synced,
      ROUND(CAST(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY p.convergence_minutes) AS numeric), 1) AS p95_convergence_min,
      ROUND(CAST(AVG(p.chain_length) AS numeric), 1) AS avg_chain_length,
      SUM(p.total_dead_lettered) AS total_dead_lettered,
      SUM(p.total_timeouts) AS total_timeouts,
      COUNT(*) FILTER (WHERE p.chain_length >= 8) AS orgs_long_chains
    FROM per_org_day p
    GROUP BY p.run_date
  ),
  first_sync_day AS (
    SELECT
      run_date,
      ROUND(CAST(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM first_sync_at::time) / 60.0) AS numeric), 1) AS p95_first_sync_min_after_midnight
    FROM first_sync
    GROUP BY run_date
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'run_date', pd.run_date,
      'orgs_seen', pd.orgs_seen,
      'orgs_fully_synced', pd.orgs_fully_synced,
      'pct_fully_synced', pd.pct_fully_synced,
      'p95_convergence_min', pd.p95_convergence_min,
      'avg_chain_length', pd.avg_chain_length,
      'total_dead_lettered', pd.total_dead_lettered,
      'total_timeouts', pd.total_timeouts,
      'orgs_long_chains', pd.orgs_long_chains,
      'p95_first_sync_min_after_midnight', fsd.p95_first_sync_min_after_midnight
    ) ORDER BY pd.run_date DESC
  )
  INTO v_platform_summary
  FROM platform_day pd
  LEFT JOIN first_sync_day fsd USING (run_date);

  -- PROBLEM ORGS (today only)
  WITH base AS (
    SELECT *
    FROM auto_sync_daily_ledger
    WHERE run_date = p_target_date
  ),
  chain_agg AS (
    SELECT
      organization_id,
      chain_id,
      MIN(started_at) AS chain_start,
      MAX(finished_at) AS chain_end,
      COUNT(*) AS chain_length,
      SUM(COALESCE(items_succeeded, 0)) AS total_succeeded,
      SUM(COALESCE(items_failed, 0)) AS total_failed,
      SUM(COALESCE(items_skipped, 0)) AS total_skipped,
      SUM(COALESCE(dead_letter_count, 0)) AS total_dead_lettered,
      SUM(COALESCE(timeout_count, 0)) AS total_timeouts,
      MAX(created_at) AS last_row_created_at
    FROM base
    GROUP BY organization_id, chain_id
  ),
  chain_last AS (
    SELECT DISTINCT ON (b.organization_id, b.chain_id)
      b.organization_id,
      b.chain_id,
      b.status AS last_status,
      b.failure_reason AS last_failure_reason
    FROM base b
    JOIN chain_agg a
      ON a.organization_id = b.organization_id
     AND a.chain_id = b.chain_id
     AND a.last_row_created_at = b.created_at
  ),
  per_org AS (
    SELECT
      a.organization_id,
      a.chain_id,
      EXTRACT(EPOCH FROM (a.chain_end - a.chain_start)) / 60.0 AS convergence_minutes,
      a.chain_length,
      a.total_succeeded,
      a.total_failed,
      a.total_skipped,
      a.total_dead_lettered,
      a.total_timeouts,
      l.last_status,
      l.last_failure_reason,
      (l.last_status = 'SUCCESS' AND a.total_skipped = 0) AS fully_synced
    FROM chain_agg a
    JOIN chain_last l USING (organization_id, chain_id)
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'organization_id', organization_id,
      'chain_id', chain_id,
      'last_status', last_status,
      'last_failure_reason', last_failure_reason,
      'fully_synced', fully_synced,
      'convergence_minutes', ROUND(convergence_minutes::numeric, 1),
      'chain_length', chain_length,
      'total_succeeded', total_succeeded,
      'total_failed', total_failed,
      'total_skipped', total_skipped,
      'total_dead_lettered', total_dead_lettered,
      'total_timeouts', total_timeouts
    ) ORDER BY fully_synced ASC, total_skipped DESC, total_dead_lettered DESC, chain_length DESC
  ), '[]'::jsonb)
  INTO v_problem_orgs
  FROM per_org
  WHERE fully_synced = false
     OR total_skipped > 0
     OR total_dead_lettered > 0
     OR total_timeouts > 0
     OR chain_length >= 8;

  v_result := jsonb_build_object(
    'generated_at', now(),
    'target_date', p_target_date,
    'lookback_days', p_days,
    'platform_summary', COALESCE(v_platform_summary, '[]'::jsonb),
    'problem_orgs_today', v_problem_orgs
  );

  RETURN v_result;
END;
$function$;
