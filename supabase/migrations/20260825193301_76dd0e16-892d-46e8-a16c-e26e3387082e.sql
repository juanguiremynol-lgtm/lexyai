ALTER TABLE public.job_runs DROP CONSTRAINT IF EXISTS job_runs_status_check;
ALTER TABLE public.job_runs ADD CONSTRAINT job_runs_status_check
  CHECK (status = ANY (ARRAY['RUNNING'::text, 'OK'::text, 'PARTIAL'::text, 'ERROR'::text]));

CREATE TABLE public.estados_monitor_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('publicaciones','samai_estados')),
  run_date date NOT NULL,
  status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','OK','PARTIAL','ERROR')),
  selected_count integer NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
  attempted_count integer NOT NULL DEFAULT 0 CHECK (attempted_count >= 0),
  succeeded_count integer NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  depth_remaining integer NOT NULL DEFAULT 12 CHECK (depth_remaining >= 0),
  lease_expires_at timestamptz NOT NULL DEFAULT (now() + interval '3 minutes'),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (channel, run_date)
);
GRANT ALL ON public.estados_monitor_runs TO service_role;
ALTER TABLE public.estados_monitor_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.estados_monitor_run_items (
  run_id uuid NOT NULL REFERENCES public.estados_monitor_runs(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CLAIMED','SUCCESS','FAILED')),
  claimed_at timestamptz,
  finished_at timestamptz,
  error_code text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (run_id, work_item_id),
  UNIQUE (run_id, ordinal)
);
GRANT ALL ON public.estados_monitor_run_items TO service_role;
ALTER TABLE public.estados_monitor_run_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.source_coverage_weekly_baselines (
  source text NOT NULL,
  week_start date NOT NULL,
  expected_count integer NOT NULL CHECK (expected_count >= 0),
  attempted_count integer NOT NULL CHECK (attempted_count >= 0),
  usable_confirmed_count integer NOT NULL CHECK (usable_confirmed_count >= 0),
  restricted_count integer NOT NULL DEFAULT 0 CHECK (restricted_count >= 0),
  pending_upstream_count integer NOT NULL DEFAULT 0 CHECK (pending_upstream_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  coverage_ratio numeric,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, week_start)
);
GRANT SELECT ON public.source_coverage_weekly_baselines TO authenticated;
GRANT ALL ON public.source_coverage_weekly_baselines TO service_role;
ALTER TABLE public.source_coverage_weekly_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform admins read source coverage baselines"
  ON public.source_coverage_weekly_baselines FOR SELECT TO authenticated
  USING (public.is_platform_admin_check(auth.uid()));

CREATE OR REPLACE FUNCTION public.claim_estados_monitor_run(
  _channel text,
  _run_date date,
  _work_item_ids uuid[],
  _depth_budget integer DEFAULT 12,
  _lease_seconds integer DEFAULT 180
)
RETURNS TABLE(run_id uuid, acquired boolean, selected_count integer, attempted_count integer, depth_remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rid uuid;
  got boolean := false;
BEGIN
  IF _channel NOT IN ('publicaciones','samai_estados') THEN
    RAISE EXCEPTION 'unsupported estados channel';
  END IF;
  IF _depth_budget < 1 OR _depth_budget > 32 THEN
    RAISE EXCEPTION 'invalid depth budget';
  END IF;

  INSERT INTO public.estados_monitor_runs(channel, run_date, selected_count, depth_remaining, lease_expires_at)
  VALUES (_channel, _run_date, cardinality(_work_item_ids), _depth_budget, now() + make_interval(secs => _lease_seconds))
  ON CONFLICT (channel, run_date) DO NOTHING
  RETURNING id INTO rid;

  IF rid IS NOT NULL THEN
    got := true;
    INSERT INTO public.estados_monitor_run_items(run_id, work_item_id, ordinal)
    SELECT rid, x.work_item_id, x.ordinality::integer
    FROM unnest(_work_item_ids) WITH ORDINALITY AS x(work_item_id, ordinality)
    ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.estados_monitor_runs r
       SET lease_expires_at = now() + make_interval(secs => _lease_seconds)
     WHERE r.channel = _channel
       AND r.run_date = _run_date
       AND r.status IN ('RUNNING','PARTIAL')
       AND r.lease_expires_at < now()
    RETURNING r.id INTO rid;
    got := rid IS NOT NULL;
  END IF;

  RETURN QUERY
  SELECT r.id, got, r.selected_count, r.attempted_count, r.depth_remaining
  FROM public.estados_monitor_runs r
  WHERE r.id = rid;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_estados_monitor_run(text,date,uuid[],integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_estados_monitor_run(text,date,uuid[],integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_estados_monitor_batch(
  _run_id uuid,
  _limit integer DEFAULT 5,
  _lease_seconds integer DEFAULT 180
)
RETURNS TABLE(work_item_id uuid, ordinal integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _limit < 1 OR _limit > 10 THEN RAISE EXCEPTION 'invalid batch limit'; END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT i.run_id, i.work_item_id, i.ordinal
    FROM public.estados_monitor_run_items i
    WHERE i.run_id = _run_id
      AND (i.status = 'PENDING' OR (i.status = 'CLAIMED' AND i.claimed_at < now() - make_interval(secs => _lease_seconds)))
    ORDER BY i.ordinal
    FOR UPDATE SKIP LOCKED
    LIMIT _limit
  ), claimed AS (
    UPDATE public.estados_monitor_run_items i
       SET status = 'CLAIMED', claimed_at = now()
      FROM picked p
     WHERE i.run_id = p.run_id AND i.work_item_id = p.work_item_id
    RETURNING i.work_item_id, i.ordinal
  )
  SELECT c.work_item_id, c.ordinal FROM claimed c ORDER BY c.ordinal;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_estados_monitor_batch(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_estados_monitor_batch(uuid,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_estados_monitor_item(
  _run_id uuid,
  _work_item_id uuid,
  _success boolean,
  _error_code text DEFAULT NULL,
  _result jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.estados_monitor_run_items
     SET status = CASE WHEN _success THEN 'SUCCESS' ELSE 'FAILED' END,
         finished_at = now(), error_code = _error_code, result = COALESCE(_result, '{}'::jsonb)
   WHERE run_id = _run_id AND work_item_id = _work_item_id AND status = 'CLAIMED';

  UPDATE public.estados_monitor_runs r
     SET attempted_count = q.attempted,
         succeeded_count = q.succeeded,
         failed_count = q.failed,
         lease_expires_at = now() + interval '3 minutes'
    FROM (
      SELECT count(*) FILTER (WHERE status IN ('SUCCESS','FAILED'))::int attempted,
             count(*) FILTER (WHERE status = 'SUCCESS')::int succeeded,
             count(*) FILTER (WHERE status = 'FAILED')::int failed
      FROM public.estados_monitor_run_items WHERE run_id = _run_id
    ) q
   WHERE r.id = _run_id;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_estados_monitor_item(uuid,uuid,boolean,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_estados_monitor_item(uuid,uuid,boolean,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_estados_monitor_hop(_run_id uuid)
RETURNS TABLE(status text, selected_count integer, attempted_count integer, remaining_count integer, depth_remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE rem integer; sel integer; att integer; fails integer; depth integer;
BEGIN
  SELECT r.selected_count, r.attempted_count, r.failed_count, greatest(r.depth_remaining - 1, 0)
    INTO sel, att, fails, depth FROM public.estados_monitor_runs r WHERE r.id = _run_id FOR UPDATE;
  SELECT count(*)::int INTO rem FROM public.estados_monitor_run_items i WHERE i.run_id = _run_id AND i.status IN ('PENDING','CLAIMED');
  UPDATE public.estados_monitor_runs r
     SET depth_remaining = depth,
         status = CASE WHEN rem = 0 AND att = sel AND fails = 0 THEN 'OK' ELSE 'PARTIAL' END,
         finished_at = CASE WHEN rem = 0 OR depth = 0 THEN now() ELSE NULL END,
         lease_expires_at = CASE WHEN rem > 0 AND depth > 0 THEN now() + interval '3 minutes' ELSE now() END
   WHERE r.id = _run_id;
  RETURN QUERY SELECT CASE WHEN rem = 0 AND att = sel AND fails = 0 THEN 'OK' ELSE 'PARTIAL' END, sel, att, rem, depth;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_estados_monitor_hop(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_estados_monitor_hop(uuid) TO service_role;

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
    WHEN outcome = 'PROCESO_PRIVADO' THEN 4
    WHEN outcome IN ('PENDING_UPSTREAM','SCRAPING_INITIATED') THEN 5
    WHEN outcome IN ('NOT_FOUND','PROVIDER_NOT_FOUND','RADICADO_NOT_FOUND') THEN 3
    WHEN att_status = 'success' THEN 1
    WHEN att_status = 'empty' THEN 2
    WHEN att_status = 'not_found' THEN 3
    ELSE 6 END grade
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

DROP FUNCTION IF EXISTS public.source_collection_quality(text,timestamptz,timestamptz);
CREATE FUNCTION public.source_collection_quality(_source text,_from timestamptz DEFAULT now()-interval '24 hours',_to timestamptz DEFAULT now())
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
   SELECT *,CASE WHEN outcome='PROCESO_PRIVADO' THEN 4 WHEN outcome IN ('PENDING_UPSTREAM','SCRAPING_INITIATED') THEN 5 WHEN outcome IN ('NOT_FOUND','PROVIDER_NOT_FOUND','RADICADO_NOT_FOUND') THEN 3 WHEN att_status='success' THEN 1 WHEN att_status='empty' THEN 2 WHEN att_status='not_found' THEN 3 ELSE 6 END grade FROM att
 ), best AS (SELECT DISTINCT ON(work_item_id) work_item_id,grade FROM graded ORDER BY work_item_id,grade), cov AS (
   SELECT count(*)::int attempted,count(*) FILTER(WHERE grade=1)::int ok,count(*) FILTER(WHERE grade=2)::int empty,count(*) FILTER(WHERE grade=3)::int nf,count(*) FILTER(WHERE grade=4)::int restricted,count(*) FILTER(WHERE grade=5)::int pending,count(*) FILTER(WHERE grade=6)::int errs,(SELECT max(started_at) FROM graded) last_at FROM best
 ) SELECT src,expected.n,cov.attempted,(cov.ok+cov.empty+cov.nf)::int,cov.ok,cov.empty,cov.nf,cov.restricted,cov.pending,cov.errs,CASE WHEN expected.n>0 THEN round(least((cov.ok+cov.empty+cov.nf)::numeric/expected.n,1),4) END,cov.last_at,public.classify_source_run_quality(expected.n,cov.attempted,(cov.ok+cov.empty+cov.nf),cov.pending,cov.nf,cov.errs,cov.attempted>0,false) FROM expected,cov;
END; $$;
GRANT EXECUTE ON FUNCTION public.source_collection_quality(text,timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.source_collection_quality(text,timestamptz,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.source_coverage_drop_evaluation(_source text,_week_start date)
RETURNS TABLE(source text,week_start date,expected_count int,coverage_ratio numeric,trailing_3_week_median numeric,drop_points numeric,proposed_level text,seeded_weeks int)
LANGUAGE sql STABLE SET search_path=public AS $$
WITH current_row AS (SELECT * FROM public.source_coverage_weekly_baselines WHERE source=lower(_source) AND week_start=_week_start), history AS (SELECT coverage_ratio FROM public.source_coverage_weekly_baselines WHERE source=lower(_source) AND week_start<_week_start ORDER BY week_start DESC LIMIT 3), stats AS (SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY coverage_ratio)::numeric median,count(*)::int n FROM history)
SELECT c.source,c.week_start,c.expected_count,c.coverage_ratio,s.median,CASE WHEN s.median IS NULL OR c.coverage_ratio IS NULL THEN NULL ELSE round((s.median-c.coverage_ratio)*100,2) END,
CASE WHEN c.expected_count<5 OR s.n<3 THEN 'SUPPRESSED_SEEDING' WHEN c.attempted_count>0 AND c.usable_confirmed_count=0 THEN 'CRITICAL_PROPOSED' WHEN (s.median-c.coverage_ratio)>=0.35 THEN 'CRITICAL_PROPOSED' WHEN (s.median-c.coverage_ratio)>=0.20 THEN 'WARN_PROPOSED' ELSE 'NO_DROP' END,s.n FROM current_row c CROSS JOIN stats s;
$$;
GRANT EXECUTE ON FUNCTION public.source_coverage_drop_evaluation(text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.source_coverage_drop_evaluation(text,date) TO service_role;