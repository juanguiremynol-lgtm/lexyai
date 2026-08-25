DROP VIEW IF EXISTS public.v_source_run_coverage;
CREATE VIEW public.v_source_run_coverage WITH (security_invoker = on) AS
WITH att AS (
  SELECT r.work_item_id, r.started_at, timezone('America/Bogota',r.started_at)::date run_date,
         lower(coalesce(a.value->>'provider','desconocido')) source,
         lower(coalesce(a.value->>'status','')) att_status,
         upper(coalesce(a.value->>'outcome',a.value->>'error_code',r.error_code,'')) outcome,
         r.id run_id
  FROM public.external_sync_runs r
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.provider_attempts,'[]'::jsonb)) a(value)
), graded AS (
  SELECT *, CASE
    WHEN outcome = 'RUN_SUCCESS_WITH_DATA' THEN 1
    WHEN outcome = 'RUN_SUCCESS_EMPTY' THEN 2
    WHEN outcome IN ('RUN_SUCCESS_NOT_FOUND','NOT_FOUND','PROVIDER_NOT_FOUND','RADICADO_NOT_FOUND') THEN 3
    WHEN outcome = 'PROCESO_PRIVADO' THEN 4
    WHEN outcome IN ('PENDING_UPSTREAM','SCRAPING_INITIATED','SOURCE_STALE') THEN 5
    WHEN outcome = 'RUN_FAILED' THEN 6
    WHEN att_status = 'success' THEN 1 WHEN att_status = 'empty' THEN 2 WHEN att_status = 'not_found' THEN 3 ELSE 6 END grade
  FROM att
), best AS (
  SELECT DISTINCT ON (source,run_date,work_item_id) source,run_date,work_item_id,grade
  FROM graded ORDER BY source,run_date,work_item_id,grade
)
SELECT b.source,b.run_date,min(g.started_at) first_attempt_at,max(g.started_at) last_attempt_at,
       count(distinct g.run_id) run_count,count(distinct b.work_item_id)::int attempted_count,
       count(distinct b.work_item_id) FILTER (WHERE b.grade=1)::int success_count,
       count(distinct b.work_item_id) FILTER (WHERE b.grade=2)::int success_empty_count,
       count(distinct b.work_item_id) FILTER (WHERE b.grade=3)::int not_found_count,
       count(distinct b.work_item_id) FILTER (WHERE b.grade=4)::int restricted_count,
       count(distinct b.work_item_id) FILTER (WHERE b.grade=5)::int pending_upstream_count,
       count(distinct b.work_item_id) FILTER (WHERE b.grade=6)::int error_count
FROM best b JOIN graded g USING(source,run_date,work_item_id)
GROUP BY b.source,b.run_date;
GRANT SELECT ON public.v_source_run_coverage TO authenticated;
GRANT SELECT ON public.v_source_run_coverage TO service_role;

CREATE OR REPLACE FUNCTION public.source_collection_quality(_source text,_from timestamptz DEFAULT now()-interval '24 hours',_to timestamptz DEFAULT now())
RETURNS TABLE(source text,expected_count int,attempted_count int,usable_confirmed_count int,success_count int,success_empty_count int,not_found_count int,restricted_count int,pending_upstream_count int,error_count int,coverage_ratio numeric,last_attempt_at timestamptz,source_quality_state text)
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE src text:=lower(_source); wf text[];
BEGIN
 wf:=CASE src WHEN 'cpnu' THEN ARRAY['CGP','LABORAL','PENAL_906','EJECUTIVO','TUTELA','INDETERMINADO'] WHEN 'publicaciones' THEN ARRAY['CGP','LABORAL','PENAL_906','EJECUTIVO','TUTELA','INDETERMINADO'] WHEN 'samai' THEN ARRAY['CPACA','TUTELA','INDETERMINADO'] WHEN 'samai_estados' THEN ARRAY['CPACA','TUTELA','INDETERMINADO'] ELSE ARRAY[]::text[] END;
 RETURN QUERY WITH expected AS (
   SELECT count(*)::int n FROM public.work_items w WHERE w.deleted_at IS NULL AND coalesce(w.lifecycle_state::text,'ACTIVE')='ACTIVE' AND coalesce(w.monitoring_enabled,true) AND w.workflow_type::text=ANY(wf)
   AND NOT (src IN ('publicaciones','samai_estados') AND (upper(coalesce(w.stage,'')) ~ 'ARCHIV|FINALIZ|PRECLUID' OR upper(coalesce(w.ubicacion_expediente,'')) ~ 'AL[[:space:]]+DESPACHO.*SENTENCIA|PARA[[:space:]]+SENTENCIA' OR (w.fecha_para_sentencia IS NOT NULL AND upper(coalesce(w.ubicacion_expediente,'')) ~ 'DESPACHO')))
 ), att AS (
   SELECT r.work_item_id,r.started_at,lower(coalesce(a.value->>'status','')) att_status,upper(coalesce(a.value->>'outcome',a.value->>'error_code',r.error_code,'')) outcome
   FROM public.external_sync_runs r CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.provider_attempts,'[]'::jsonb)) a(value)
   WHERE lower(coalesce(a.value->>'provider',''))=src AND r.started_at BETWEEN _from AND _to
 ), graded AS (
   SELECT *,CASE WHEN outcome='RUN_SUCCESS_WITH_DATA' THEN 1 WHEN outcome='RUN_SUCCESS_EMPTY' THEN 2 WHEN outcome IN ('RUN_SUCCESS_NOT_FOUND','NOT_FOUND','PROVIDER_NOT_FOUND','RADICADO_NOT_FOUND') THEN 3 WHEN outcome='PROCESO_PRIVADO' THEN 4 WHEN outcome IN ('PENDING_UPSTREAM','SCRAPING_INITIATED','SOURCE_STALE') THEN 5 WHEN outcome='RUN_FAILED' THEN 6 WHEN att_status='success' THEN 1 WHEN att_status='empty' THEN 2 WHEN att_status='not_found' THEN 3 ELSE 6 END grade FROM att
 ), best AS (SELECT DISTINCT ON(work_item_id) work_item_id,grade FROM graded ORDER BY work_item_id,grade), cov AS (
   SELECT count(*)::int attempted,count(*) FILTER(WHERE grade=1)::int ok,count(*) FILTER(WHERE grade=2)::int empty,count(*) FILTER(WHERE grade=3)::int nf,count(*) FILTER(WHERE grade=4)::int restricted,count(*) FILTER(WHERE grade=5)::int pending,count(*) FILTER(WHERE grade=6)::int errs,(SELECT max(started_at) FROM graded) last_at FROM best
 ) SELECT src,expected.n,cov.attempted,(cov.ok+cov.empty+cov.nf)::int,cov.ok,cov.empty,cov.nf,cov.restricted,cov.pending,cov.errs,CASE WHEN expected.n>0 THEN round(least((cov.ok+cov.empty+cov.nf)::numeric/expected.n,1),4) END,cov.last_at,public.classify_source_run_quality(expected.n,cov.attempted,(cov.ok+cov.empty+cov.nf),cov.pending,cov.nf,cov.errs,cov.attempted>0,false) FROM expected,cov;
END; $$;