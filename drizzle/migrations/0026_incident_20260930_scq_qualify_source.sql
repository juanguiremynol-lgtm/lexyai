-- Fix 42702: qualify all columns in evidence query (OUT column "source" collided with table column).
CREATE OR REPLACE FUNCTION public.source_collection_quality(_source text, _from timestamp with time zone DEFAULT (now() - '24:00:00'::interval), _to timestamp with time zone DEFAULT now())
 RETURNS TABLE(source text, expected_count integer, attempted_count integer, usable_confirmed_count integer, success_count integer, success_empty_count integer, not_found_count integer, restricted_count integer, pending_upstream_count integer, error_count integer, coverage_ratio numeric, last_attempt_at timestamp with time zone, source_quality_state text, answered_count integer, restricted_matter_count integer, routing_skipped_count integer, chain text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE src text := lower(_source); wf text[];
  v_skipped uuid[]; v_expected uuid[]; v_att jsonb; v_ev jsonb; c record;
BEGIN
  wf := public.source_chain(src);
  SELECT coalesce(array_agg(DISTINCT r.work_item_id), ARRAY[]::uuid[]) INTO v_skipped
    FROM public.external_sync_runs r
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.provider_attempts,'[]'::jsonb)) a(value)
   WHERE lower(coalesce(a.value->>'provider','')) = src
     AND r.started_at BETWEEN _from AND _to
     AND (upper(coalesce(a.value->>'outcome','')) LIKE 'ROUTING_SKIP%'
       OR upper(coalesce(a.value->>'result_code','')) LIKE 'ROUTING_SKIP%');

  SELECT coalesce(array_agg(w.id), ARRAY[]::uuid[]) INTO v_expected FROM public.work_items w
   WHERE w.deleted_at IS NULL
     AND coalesce(w.lifecycle_state::text,'ACTIVE') = 'ACTIVE'
     AND coalesce(w.monitoring_enabled,true)
     AND w.workflow_type::text = ANY(wf)
     AND NOT (w.id = ANY(v_skipped))
     AND NOT (src IN ('publicaciones','samai_estados') AND (
       upper(coalesce(w.stage,'')) ~ 'ARCHIV|FINALIZ|PRECLUID'
       OR upper(coalesce(w.ubicacion_expediente,'')) ~ 'AL[[:space:]]+DESPACHO.*SENTENCIA|PARA[[:space:]]+SENTENCIA'
       OR (w.fecha_para_sentencia IS NOT NULL AND upper(coalesce(w.ubicacion_expediente,'')) ~ 'DESPACHO')));

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'work_item_id', r.work_item_id, 'started_at', r.started_at,
           'provider', a.value->>'provider', 'status', a.value->>'status',
           'outcome', coalesce(a.value->>'outcome', a.value->>'error_code', r.error_code),
           'result_code', a.value->>'result_code')), '[]'::jsonb) INTO v_att
    FROM public.external_sync_runs r
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.provider_attempts,'[]'::jsonb)) a(value)
   WHERE lower(coalesce(a.value->>'provider','')) = src AND r.started_at BETWEEN _from AND _to;

  SELECT coalesce(jsonb_agg(q.x), '[]'::jsonb) INTO v_ev FROM (
    SELECT jsonb_build_object('work_item_id', ea.work_item_id, 'source', ea.source, 'created_at', ea.created_at) AS x
      FROM public.work_item_acts ea
     WHERE lower(coalesce(ea.source,'')) = src AND ea.created_at BETWEEN _from AND _to AND NOT coalesce(ea.is_archived,false)
    UNION ALL
    SELECT jsonb_build_object('work_item_id', ep.work_item_id, 'source', ep.source, 'created_at', ep.created_at)
      FROM public.work_item_publicaciones ep
     WHERE lower(coalesce(ep.source,'')) = src AND ep.created_at BETWEEN _from AND _to AND NOT coalesce(ep.is_archived,false)
  ) q;

  SELECT * INTO c FROM public.grade_source_matters(src, _from, _to, v_expected, v_att, v_ev);

  RETURN QUERY SELECT src, cardinality(v_expected), c.attempted,
         (c.ok + c.empty + c.nf)::int, c.ok, c.empty, c.nf, c.restricted, c.pending, c.errs,
         CASE WHEN cardinality(v_expected) > 0
              THEN round(least((c.ok + c.empty + c.nf + c.restricted)::numeric / cardinality(v_expected), 1), 4) END,
         c.last_at,
         public.classify_source_run_quality(cardinality(v_expected), c.attempted,
           (c.ok + c.empty + c.nf + c.restricted), c.pending, c.nf, c.errs, c.attempted > 0, false),
         (c.ok + c.empty + c.nf + c.restricted)::int, c.restricted,
         (SELECT count(DISTINCT u)::int FROM unnest(v_skipped) u), wf;
END; $function$;