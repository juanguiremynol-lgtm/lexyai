-- Fix get_adapter_performance_comparison to cover BOTH built-in providers 
-- (via external_sync_run_attempts) AND dynamic providers (via external_sync_runs.provider_attempts JSONB)
CREATE OR REPLACE FUNCTION public.get_adapter_performance_comparison()
RETURNS TABLE(
  provider TEXT,
  recent_p50_ms NUMERIC,
  baseline_p50_ms NUMERIC,
  recent_error_rate NUMERIC,
  baseline_error_rate NUMERIC,
  recent_count BIGINT,
  baseline_count BIGINT
) AS $$
WITH all_attempts AS (
  -- Source 1: structured per-attempt rows (built-in providers via orchestrator)
  SELECT 
    a.provider,
    a.latency_ms,
    a.status,
    a.recorded_at AS ts
  FROM external_sync_run_attempts a
  WHERE a.recorded_at > NOW() - INTERVAL '8 days'

  UNION ALL

  -- Source 2: JSONB provider_attempts from external_sync_runs (covers dynamic providers)
  SELECT
    (attempt->>'provider')::TEXT AS provider,
    (attempt->>'latency_ms')::INT AS latency_ms,
    LOWER(attempt->>'status') AS status,
    r.created_at AS ts
  FROM external_sync_runs r,
       jsonb_array_elements(r.provider_attempts) AS attempt
  WHERE r.created_at > NOW() - INTERVAL '8 days'
    AND r.provider_attempts IS NOT NULL
    -- Exclude rows already captured in external_sync_run_attempts to avoid double-counting
    AND NOT EXISTS (
      SELECT 1 FROM external_sync_run_attempts ea
      WHERE ea.sync_run_id = r.id AND ea.provider = (attempt->>'provider')::TEXT
    )
)
SELECT
  a.provider,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY a.latency_ms) 
    FILTER (WHERE a.ts > NOW() - INTERVAL '24 hours') as recent_p50_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY a.latency_ms) 
    FILTER (WHERE a.ts BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '1 day') as baseline_p50_ms,
  COUNT(*) FILTER (WHERE a.status IN ('error','timeout') AND a.ts > NOW() - INTERVAL '24 hours')::NUMERIC /
    NULLIF(COUNT(*) FILTER (WHERE a.ts > NOW() - INTERVAL '24 hours'), 0) as recent_error_rate,
  COUNT(*) FILTER (WHERE a.status IN ('error','timeout') AND a.ts BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '1 day')::NUMERIC /
    NULLIF(COUNT(*) FILTER (WHERE a.ts BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '1 day'), 0) as baseline_error_rate,
  COUNT(*) FILTER (WHERE a.ts > NOW() - INTERVAL '24 hours') as recent_count,
  COUNT(*) FILTER (WHERE a.ts BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '1 day') as baseline_count
FROM all_attempts a
GROUP BY a.provider;
$$ LANGUAGE sql STABLE SECURITY DEFINER;