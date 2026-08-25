-- TT5.2 — COVERAGE IS COUNTED PER MATTER, NEVER PER ATTEMPT.
-- The first cut summed attempt rows against a distinct-matter denominator,
-- which produced ratios above 1 (cpnu 82/38) and made the numbers unusable as
-- evidence. Coverage answers exactly one question: of the matters we were
-- supposed to read, how many produced an authoritative determination?
-- A matter read five times in a day is ONE matter. Its verdict for the window
-- is its BEST outcome: an answered read anywhere in the window means the matter
-- was covered, regardless of how many attempts failed around it.

DROP VIEW IF EXISTS public.v_source_run_coverage;

CREATE VIEW public.v_source_run_coverage
WITH (security_invoker = on) AS
WITH att AS (
  SELECT
    r.work_item_id,
    r.started_at,
    (timezone('America/Bogota', r.started_at))::date AS run_date,
    lower(COALESCE(a.value ->> 'provider', 'desconocido')) AS source,
    lower(COALESCE(a.value ->> 'status', '')) AS att_status,
    upper(COALESCE(a.value ->> 'error_code', r.error_code, '')) AS err,
    r.id AS run_id
  FROM public.external_sync_runs r
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.provider_attempts, '[]'::jsonb)) a(value)
),
graded AS (
  -- Rank of the outcome, best first. PENDING_UPSTREAM outranks a hard error
  -- (the provider did answer) but is NEVER coverage.
  SELECT
    source, run_date, work_item_id, run_id, started_at,
    CASE
      WHEN att_status = 'success' THEN 1
      WHEN att_status = 'empty' THEN 2
      WHEN att_status = 'not_found'
        OR err IN ('NOT_FOUND','PROVIDER_NOT_FOUND','RADICADO_NOT_FOUND') THEN 3
      WHEN att_status = 'pending_upstream' OR err = 'PENDING_UPSTREAM' THEN 4
      ELSE 5
    END AS grade
  FROM att
),
best AS (
  SELECT DISTINCT ON (source, run_date, work_item_id)
    source, run_date, work_item_id, grade
  FROM graded
  ORDER BY source, run_date, work_item_id, grade
)
SELECT
  b.source,
  b.run_date,
  min(g.started_at) AS first_attempt_at,
  max(g.started_at) AS last_attempt_at,
  count(DISTINCT g.run_id) AS run_count,
  count(DISTINCT b.work_item_id)::int AS attempted_count,
  count(DISTINCT b.work_item_id) FILTER (WHERE b.grade = 1)::int AS success_count,
  count(DISTINCT b.work_item_id) FILTER (WHERE b.grade = 2)::int AS success_empty_count,
  count(DISTINCT b.work_item_id) FILTER (WHERE b.grade = 3)::int AS not_found_count,
  count(DISTINCT b.work_item_id) FILTER (WHERE b.grade = 4)::int AS pending_upstream_count,
  count(DISTINCT b.work_item_id) FILTER (WHERE b.grade = 5)::int AS error_count
FROM best b
JOIN graded g ON g.source = b.source AND g.run_date = b.run_date AND g.work_item_id = b.work_item_id
GROUP BY b.source, b.run_date;

GRANT SELECT ON public.v_source_run_coverage TO authenticated;
GRANT SELECT ON public.v_source_run_coverage TO service_role;

-- The window function must do its own per-matter rollup: summing two Bogotá
-- days would count a matter twice and re-open the same ratio defect.
DROP FUNCTION IF EXISTS public.source_collection_quality(text, timestamptz, timestamptz);

CREATE FUNCTION public.source_collection_quality(
  _source text,
  _from timestamptz DEFAULT now() - interval '24 hours',
  _to timestamptz DEFAULT now()
)
RETURNS TABLE (
  source text,
  expected_count int,
  attempted_count int,
  usable_confirmed_count int,
  success_count int,
  success_empty_count int,
  not_found_count int,
  pending_upstream_count int,
  error_count int,
  coverage_ratio numeric,
  last_attempt_at timestamptz,
  source_quality_state text
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  src text := lower(_source);
  wf  text[];
BEGIN
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
  att AS (
    SELECT
      r.work_item_id,
      r.started_at,
      lower(COALESCE(a.value ->> 'status', '')) AS att_status,
      upper(COALESCE(a.value ->> 'error_code', r.error_code, '')) AS err
    FROM public.external_sync_runs r
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.provider_attempts, '[]'::jsonb)) a(value)
    WHERE lower(COALESCE(a.value ->> 'provider', '')) = src
      AND r.started_at >= _from
      AND r.started_at <= _to
  ),
  graded AS (
    SELECT work_item_id, started_at,
      CASE
        WHEN att_status = 'success' THEN 1
        WHEN att_status = 'empty' THEN 2
        WHEN att_status = 'not_found'
          OR err IN ('NOT_FOUND','PROVIDER_NOT_FOUND','RADICADO_NOT_FOUND') THEN 3
        WHEN att_status = 'pending_upstream' OR err = 'PENDING_UPSTREAM' THEN 4
        ELSE 5
      END AS grade
    FROM att
  ),
  best AS (
    SELECT DISTINCT ON (work_item_id) work_item_id, grade
    FROM graded ORDER BY work_item_id, grade
  ),
  cov AS (
    SELECT
      (SELECT count(*) FROM best)::int AS attempted,
      (SELECT count(*) FROM best WHERE grade = 1)::int AS ok,
      (SELECT count(*) FROM best WHERE grade = 2)::int AS empty,
      (SELECT count(*) FROM best WHERE grade = 3)::int AS nf,
      (SELECT count(*) FROM best WHERE grade = 4)::int AS pending,
      (SELECT count(*) FROM best WHERE grade = 5)::int AS errs,
      (SELECT max(started_at) FROM graded) AS last_at
  )
  SELECT
    src,
    expected.n,
    cov.attempted,
    (cov.ok + cov.empty + cov.nf)::int,
    cov.ok, cov.empty, cov.nf, cov.pending, cov.errs,
    CASE WHEN expected.n > 0
      THEN round(LEAST((cov.ok + cov.empty + cov.nf)::numeric / expected.n, 1), 4)
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