-- Performance comparison RPC for adapter-level regression detection
-- Uses external_sync_run_attempts which has the per-provider data

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
SELECT
  a.provider,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY a.latency_ms) 
    FILTER (WHERE a.recorded_at > NOW() - INTERVAL '24 hours') as recent_p50_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY a.latency_ms) 
    FILTER (WHERE a.recorded_at BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '1 day') as baseline_p50_ms,
  COUNT(*) FILTER (WHERE a.status IN ('error','timeout') AND a.recorded_at > NOW() - INTERVAL '24 hours')::NUMERIC /
    NULLIF(COUNT(*) FILTER (WHERE a.recorded_at > NOW() - INTERVAL '24 hours'), 0) as recent_error_rate,
  COUNT(*) FILTER (WHERE a.status IN ('error','timeout') AND a.recorded_at BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '1 day')::NUMERIC /
    NULLIF(COUNT(*) FILTER (WHERE a.recorded_at BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '1 day'), 0) as baseline_error_rate,
  COUNT(*) FILTER (WHERE a.recorded_at > NOW() - INTERVAL '24 hours') as recent_count,
  COUNT(*) FILTER (WHERE a.recorded_at BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '1 day') as baseline_count
FROM external_sync_run_attempts a
WHERE a.recorded_at > NOW() - INTERVAL '8 days'
GROUP BY a.provider;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
