-- LW1 — the denominator is the chain, not the portfolio.
--
-- A routing skip is not a missed read: it is a read that should never have
-- happened. It must not appear in the numerator, the denominator, or the
-- "sin confirmar" residue. Attempts carrying ROUTING_SKIP% were already
-- filtered out of the attempt set; the remaining defect was the denominator,
-- which still contained matters outside the source's chain, and the grading,
-- which treated a definitive "proceso privado" answer as a missing read.
--
-- Chains, declared once:
--   cpnu, publicaciones        CGP, EJECUTIVO, LABORAL, PENAL_906, TUTELA
--   samai, samai_estados       CPACA
-- INDETERMINADO stays with the CPNU/PP chain: those are the fallback readers
-- for a matter whose workflow has not yet been established.
CREATE OR REPLACE FUNCTION public.source_chain(_source text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE lower(_source)
    WHEN 'cpnu'          THEN ARRAY['CGP','LABORAL','PENAL_906','EJECUTIVO','TUTELA','INDETERMINADO']
    WHEN 'publicaciones' THEN ARRAY['CGP','LABORAL','PENAL_906','EJECUTIVO','TUTELA','INDETERMINADO']
    WHEN 'samai'         THEN ARRAY['CPACA']
    WHEN 'samai_estados' THEN ARRAY['CPACA']
    ELSE ARRAY[]::text[] END;
$$;

DROP FUNCTION IF EXISTS public.source_collection_quality(text, timestamptz, timestamptz);
CREATE FUNCTION public.source_collection_quality(
  _source text,
  _from timestamptz DEFAULT (now() - '24:00:00'::interval),
  _to timestamptz DEFAULT now())
RETURNS TABLE(
  source text, expected_count integer, attempted_count integer,
  usable_confirmed_count integer, success_count integer, success_empty_count integer,
  not_found_count integer, restricted_count integer, pending_upstream_count integer,
  error_count integer, coverage_ratio numeric, last_attempt_at timestamptz,
  source_quality_state text,
  answered_count integer, restricted_matter_count integer,
  routing_skipped_count integer, chain text[])
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE src text := lower(_source); wf text[];
BEGIN
  wf := public.source_chain(src);
  RETURN QUERY
  WITH skipped AS (
    -- matters this source was correctly NOT asked about
    SELECT DISTINCT r.work_item_id
    FROM public.external_sync_runs r
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.provider_attempts,'[]'::jsonb)) a(value)
    WHERE lower(coalesce(a.value->>'provider','')) = src
      AND r.started_at BETWEEN _from AND _to
      AND (upper(coalesce(a.value->>'outcome','')) LIKE 'ROUTING_SKIP%'
        OR upper(coalesce(a.value->>'result_code','')) LIKE 'ROUTING_SKIP%')
  ), expected AS (
    SELECT count(*)::int n FROM public.work_items w
    WHERE w.deleted_at IS NULL
      AND coalesce(w.lifecycle_state::text,'ACTIVE') = 'ACTIVE'
      AND coalesce(w.monitoring_enabled,true)
      AND w.workflow_type::text = ANY(wf)
      -- LW1: a skipped matter leaves the denominator entirely.
      AND w.id NOT IN (SELECT work_item_id FROM skipped)
      AND NOT (src IN ('publicaciones','samai_estados') AND (
        upper(coalesce(w.stage,'')) ~ 'ARCHIV|FINALIZ|PRECLUID'
        OR upper(coalesce(w.ubicacion_expediente,'')) ~ 'AL[[:space:]]+DESPACHO.*SENTENCIA|PARA[[:space:]]+SENTENCIA'
        OR (w.fecha_para_sentencia IS NOT NULL AND upper(coalesce(w.ubicacion_expediente,'')) ~ 'DESPACHO')))
  ), att AS (
    SELECT r.work_item_id, r.started_at,
           lower(coalesce(a.value->>'status','')) att_status,
           upper(coalesce(a.value->>'outcome', a.value->>'error_code', r.error_code,'')) outcome
    FROM public.external_sync_runs r
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.provider_attempts,'[]'::jsonb)) a(value)
    WHERE lower(coalesce(a.value->>'provider','')) = src
      AND r.started_at BETWEEN _from AND _to
      AND lower(coalesce(a.value->>'status','')) <> 'skipped'
      AND upper(coalesce(a.value->>'outcome','')) NOT LIKE 'ROUTING_SKIP%'
      AND upper(coalesce(a.value->>'result_code','')) NOT LIKE 'ROUTING_SKIP%'
  ), graded AS (
    SELECT *, CASE
      WHEN outcome = 'RUN_SUCCESS_WITH_DATA' THEN 1
      WHEN outcome = 'RUN_SUCCESS_EMPTY' THEN 2
      WHEN outcome IN ('RUN_SUCCESS_NOT_FOUND','NOT_FOUND','PROVIDER_NOT_FOUND','RADICADO_NOT_FOUND') THEN 3
      WHEN outcome = 'PROCESO_PRIVADO' THEN 4
      WHEN outcome IN ('PENDING_UPSTREAM','SCRAPING_INITIATED','SOURCE_STALE') THEN 5
      WHEN outcome = 'RUN_FAILED' THEN 6
      WHEN att_status = 'success' THEN 1
      WHEN att_status = 'empty' THEN 2
      WHEN att_status = 'not_found' THEN 3
      ELSE 6 END grade
    FROM att
  ), best AS (
    SELECT DISTINCT ON (work_item_id) work_item_id, grade FROM graded ORDER BY work_item_id, grade
  ), cov AS (
    SELECT count(*)::int attempted,
           count(*) FILTER (WHERE grade=1)::int ok,
           count(*) FILTER (WHERE grade=2)::int empty,
           count(*) FILTER (WHERE grade=3)::int nf,
           count(*) FILTER (WHERE grade=4)::int restricted,
           count(*) FILTER (WHERE grade=5)::int pending,
           count(*) FILTER (WHERE grade=6)::int errs,
           (SELECT max(started_at) FROM graded) last_at
    FROM best
  ), skips AS (SELECT count(*)::int n FROM skipped)
  SELECT src, expected.n, cov.attempted,
         (cov.ok + cov.empty + cov.nf)::int,
         cov.ok, cov.empty, cov.nf, cov.restricted, cov.pending, cov.errs,
         CASE WHEN expected.n > 0
              THEN round(least((cov.ok + cov.empty + cov.nf + cov.restricted)::numeric / expected.n, 1), 4)
         END,
         cov.last_at,
         public.classify_source_run_quality(
           expected.n, cov.attempted,
           -- LW2: a "proceso privado" answer IS an answer. The source reached the
           -- matter; what it refused was the content, and that refusal is reported
           -- on its own line. It is not a hole in coverage.
           (cov.ok + cov.empty + cov.nf + cov.restricted),
           cov.pending, cov.nf, cov.errs, cov.attempted > 0, false),
         (cov.ok + cov.empty + cov.nf + cov.restricted)::int,
         cov.restricted,
         skips.n,
         wf
  FROM expected, cov, skips;
END; $function$;

-- LW3/LW4 — name them. A count he cannot act on is noise; a radicado he can
-- check at the portal is a task. One row per matter, never per attempt.
CREATE OR REPLACE FUNCTION public.source_coverage_exceptions(
  _source text,
  _from timestamptz DEFAULT (now() - '24:00:00'::interval),
  _to timestamptz DEFAULT now())
RETURNS TABLE(
  source text, kind text, work_item_id uuid, radicado text, title text,
  despacho text, attempts integer, last_attempt_at timestamptz)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH att AS (
    SELECT r.work_item_id, r.started_at,
           upper(coalesce(a.value->>'outcome', a.value->>'error_code', r.error_code,'')) outcome
    FROM public.external_sync_runs r
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.provider_attempts,'[]'::jsonb)) a(value)
    WHERE lower(coalesce(a.value->>'provider','')) = lower(_source)
      AND r.started_at BETWEEN _from AND _to
      AND lower(coalesce(a.value->>'status','')) <> 'skipped'
      AND upper(coalesce(a.value->>'outcome','')) NOT LIKE 'ROUTING_SKIP%'
      AND upper(coalesce(a.value->>'result_code','')) NOT LIKE 'ROUTING_SKIP%'
  ), kinds AS (
    SELECT work_item_id,
           CASE
             WHEN bool_or(outcome IN ('RUN_SUCCESS_WITH_DATA','RUN_SUCCESS_EMPTY','RUN_SUCCESS_NOT_FOUND','NOT_FOUND')) THEN NULL
             WHEN bool_or(outcome = 'PROCESO_PRIVADO') THEN 'RESTRICTED'
             WHEN bool_or(outcome IN ('PENDING_UPSTREAM','SCRAPING_INITIATED','SOURCE_STALE')) THEN 'PENDING_UPSTREAM'
             WHEN bool_or(outcome = 'RUN_FAILED') THEN 'READ_FAILED'
             ELSE NULL END AS kind,
           count(*)::int attempts, max(started_at) last_at
    FROM att GROUP BY work_item_id
  )
  SELECT lower(_source), k.kind, w.id, w.radicado, w.title, w.despacho_competencia, k.attempts, k.last_at
  FROM kinds k JOIN public.work_items w ON w.id = k.work_item_id
  WHERE k.kind IS NOT NULL AND w.deleted_at IS NULL
    AND w.workflow_type::text = ANY(public.source_chain(_source))
  ORDER BY k.kind, w.radicado;
$$;

GRANT EXECUTE ON FUNCTION public.source_chain(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.source_coverage_exceptions(text, timestamptz, timestamptz) TO authenticated, service_role;