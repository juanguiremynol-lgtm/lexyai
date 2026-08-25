-- ============================================================================
-- TT5 — SOURCE RUN QUALITY AS FIRST-CLASS STATE
--
-- Execution health (did the job run?) and collection quality (did we obtain
-- authoritative data?) are different dimensions. `external_sync_runs` already
-- records every provider attempt; nothing new is stored. This layer only
-- ACCOUNTS for what is already there, per source and per run date.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.classify_source_run_quality(
  _expected        int,
  _attempted       int,
  _usable          int,
  _pending         int,
  _not_found       int,
  _errors          int,
  _run_executed    boolean DEFAULT true,
  _run_failed      boolean DEFAULT false
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    -- F. no run inside the expected window: silence proves nothing.
    WHEN NOT COALESCE(_run_executed, false)          THEN 'SOURCE_STALE'
    -- E. the collection execution failed technically.
    WHEN COALESCE(_run_failed, false)                THEN 'SOURCE_RUN_FAILED'
    WHEN COALESCE(_attempted, 0) = 0                 THEN 'SOURCE_STALE'
    -- D. nothing usable came back although the provider was reached.
    WHEN COALESCE(_usable, 0) = 0
     AND (COALESCE(_pending, 0) + COALESCE(_errors, 0)) > 0
                                                     THEN 'SOURCE_DEGRADED_SYSTEMIC'
    -- C. some expected matters are unconfirmed.
    WHEN COALESCE(_pending, 0) > 0
      OR COALESCE(_errors, 0) > 0
      OR COALESCE(_attempted, 0) < COALESCE(_expected, _attempted)
                                                     THEN 'SOURCE_DEGRADED_PARTIAL'
    -- B. healthy source, exact radicados the provider does not know.
    WHEN COALESCE(_not_found, 0) > 0                 THEN 'SOURCE_HEALTHY_WITH_NOT_FOUND'
    -- A. full authoritative coverage of the expected portfolio.
    ELSE 'SOURCE_HEALTHY_COMPLETE'
  END
$$;

COMMENT ON FUNCTION public.classify_source_run_quality IS
  'TT5 — collection quality, never execution health. usable = success + success_empty + not_found.';

-- ── Per-source, per-day accounting derived from existing attempt records ────
DROP VIEW IF EXISTS public.v_source_run_coverage;
CREATE VIEW public.v_source_run_coverage AS
WITH att AS (
  SELECT
    r.id                                                        AS run_id,
    r.work_item_id,
    r.started_at,
    (timezone('America/Bogota', r.started_at))::date            AS run_date,
    lower(COALESCE(a->>'provider', 'desconocido'))              AS source,
    lower(COALESCE(a->>'status', ''))                           AS att_status,
    upper(COALESCE(a->>'error_code', r.error_code, ''))         AS err
  FROM public.external_sync_runs r
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.provider_attempts, '[]'::jsonb)) a
)
SELECT
  source,
  run_date,
  min(started_at)                                               AS first_attempt_at,
  max(started_at)                                               AS last_attempt_at,
  count(DISTINCT run_id)                                        AS run_count,
  count(DISTINCT work_item_id)                                  AS attempted_count,
  count(*) FILTER (WHERE att_status = 'success')                AS success_count,
  count(*) FILTER (WHERE att_status = 'empty')                  AS success_empty_count,
  count(*) FILTER (
    WHERE att_status = 'not_found'
       OR err IN ('NOT_FOUND', 'PROVIDER_NOT_FOUND', 'RADICADO_NOT_FOUND')
  )                                                             AS not_found_count,
  count(*) FILTER (
    WHERE att_status = 'pending_upstream' OR err = 'PENDING_UPSTREAM'
  )                                                             AS pending_upstream_count,
  count(*) FILTER (
    WHERE att_status IN ('error', 'timeout')
      AND err <> 'PENDING_UPSTREAM'
      AND err NOT IN ('NOT_FOUND', 'PROVIDER_NOT_FOUND', 'RADICADO_NOT_FOUND')
  )                                                             AS error_count
FROM att
GROUP BY source, run_date;

COMMENT ON VIEW public.v_source_run_coverage IS
  'TT5.2 — collection coverage per source per day, derived from external_sync_runs.provider_attempts.';

GRANT SELECT ON public.v_source_run_coverage TO authenticated;
GRANT SELECT ON public.v_source_run_coverage TO service_role;

-- ── Windowed quality for one source ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.source_collection_quality(
  _source text,
  _from   timestamptz,
  _to     timestamptz DEFAULT now()
) RETURNS TABLE (
  source                text,
  expected_count        int,
  attempted_count       int,
  usable_confirmed_count int,
  success_count         int,
  success_empty_count   int,
  not_found_count       int,
  pending_upstream_count int,
  error_count           int,
  coverage_ratio        numeric,
  last_attempt_at       timestamptz,
  source_quality_state  text
)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  src text := lower(_source);
  wf  text[];
BEGIN
  -- Expected portfolio: only the matters actually enrolled in this source.
  wf := CASE src
    WHEN 'cpnu'          THEN ARRAY['CGP','LABORAL','PENAL_906','EJECUTIVO','TUTELA','INDETERMINADO']
    WHEN 'publicaciones' THEN ARRAY['CGP','LABORAL','PENAL_906','EJECUTIVO','TUTELA','INDETERMINADO']
    WHEN 'samai'         THEN ARRAY['CPACA','TUTELA','INDETERMINADO']
    WHEN 'samai_estados' THEN ARRAY['CPACA','TUTELA','INDETERMINADO']
    ELSE ARRAY[]::text[]
  END;

  RETURN QUERY
  WITH expected AS (
    SELECT count(*)::int AS n
    FROM public.work_items w
    WHERE w.deleted_at IS NULL
      AND COALESCE(w.lifecycle_state::text, 'ACTIVE') = 'ACTIVE'
      AND COALESCE(w.monitoring_enabled, true)
      AND w.workflow_type::text = ANY (wf)
  ),
  cov AS (
    SELECT
      COALESCE(sum(c.attempted_count), 0)::int        AS attempted,
      COALESCE(sum(c.success_count), 0)::int          AS ok,
      COALESCE(sum(c.success_empty_count), 0)::int    AS empty,
      COALESCE(sum(c.not_found_count), 0)::int        AS nf,
      COALESCE(sum(c.pending_upstream_count), 0)::int AS pending,
      COALESCE(sum(c.error_count), 0)::int            AS errs,
      max(c.last_attempt_at)                          AS last_at
    FROM public.v_source_run_coverage c
    WHERE c.source = src
      AND c.run_date >= (timezone('America/Bogota', _from))::date
      AND c.run_date <= (timezone('America/Bogota', _to))::date
  )
  SELECT
    src,
    expected.n,
    cov.attempted,
    (cov.ok + cov.empty + cov.nf)::int,
    cov.ok, cov.empty, cov.nf, cov.pending, cov.errs,
    CASE WHEN expected.n > 0
      THEN round((cov.ok + cov.empty + cov.nf)::numeric / expected.n, 4)
      ELSE NULL END,
    cov.last_at,
    public.classify_source_run_quality(
      expected.n, cov.attempted, (cov.ok + cov.empty + cov.nf),
      cov.pending, cov.nf, cov.errs,
      cov.attempted > 0, false
    )
  FROM expected, cov;
END;
$$;

COMMENT ON FUNCTION public.source_collection_quality IS
  'TT6 — a zero novelty count is authoritative only when this returns SOURCE_HEALTHY_COMPLETE / _WITH_NOT_FOUND.';

GRANT EXECUTE ON FUNCTION public.source_collection_quality(text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.source_collection_quality(text, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.classify_source_run_quality(int,int,int,int,int,int,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.classify_source_run_quality(int,int,int,int,int,int,boolean,boolean) TO service_role;