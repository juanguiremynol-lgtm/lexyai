-- ============================================================
-- ZZ1 — cross-channel providencia linkage (NO merging)
-- ============================================================

CREATE OR REPLACE FUNCTION public.providencia_sig_tokens(_raw text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(DISTINCT w), '{}'::text[])
  FROM unnest(
    regexp_split_to_array(lower(public.f_unaccent(COALESCE(_raw, ''))), '[^a-z0-9]+')
  ) w
  WHERE length(w) >= 5
    AND w NOT IN (
      'providencia','proceso','procesos','juzgado','actuacion','actuaciones','anotacion',
      'registrada','registrado','archivo','documento','documentos','asunto','asuntos',
      'notificacion','fecha','estado','estados','civil','municipal','circuito','oficina',
      'sistema','judicial','expediente','partes','contra','debida','forma'
    )
$$;

COMMENT ON FUNCTION public.providencia_sig_tokens(text) IS
  'ZZ1 — significant lexical tokens used to corroborate that an actuación and an estado describe the same providencia.';

DROP VIEW IF EXISTS public.v_providencia_cross_ref;

CREATE VIEW public.v_providencia_cross_ref AS
WITH pubs AS (
  SELECT p.id                       AS pub_id,
         p.work_item_id,
         p.fecha_fijacion,
         p.fecha_desfijacion,
         (p.fecha_providencia)::date AS fecha_providencia,
         public.providencia_sig_tokens(
           COALESCE(p.annotation, '') || ' ' || COALESCE(p.title, '')
         ) AS toks
    FROM public.work_item_publicaciones p
   WHERE COALESCE(p.is_archived, false) = false
     AND p.fecha_providencia IS NOT NULL
), cand AS (
  SELECT b.pub_id,
         b.work_item_id,
         b.fecha_fijacion,
         b.fecha_desfijacion,
         b.fecha_providencia,
         a.id        AS act_id,
         a.act_date,
         (SELECT count(*)
            FROM unnest(b.toks) t
           WHERE lower(public.f_unaccent(
                   COALESCE(a.description, '') || ' ' || COALESCE(a.event_summary, '')
                 )) LIKE '%' || t || '%')::int AS lexical_overlap
    FROM pubs b
    JOIN public.work_item_acts a
      ON a.work_item_id = b.work_item_id
     AND COALESCE(a.is_archived, false) = false
     AND a.act_date = b.fecha_providencia
   WHERE public.act_is_stage_bearing(COALESCE(a.description, '') || ' ' || COALESCE(a.act_type, ''))
     AND NOT public.act_is_fijacion_estado(a.description, a.act_type)
), ranked AS (
  SELECT c.*,
         count(*) OVER (PARTITION BY c.pub_id)                             AS n_candidates,
         count(*) FILTER (WHERE c.lexical_overlap > 0)
                  OVER (PARTITION BY c.pub_id)                             AS n_lexical
    FROM cand c
)
SELECT r.pub_id,
       r.act_id,
       r.work_item_id,
       r.act_date,
       r.fecha_fijacion,
       r.fecha_desfijacion,
       r.fecha_providencia,
       r.lexical_overlap,
       r.n_candidates,
       CASE WHEN r.lexical_overlap > 0 AND r.n_lexical = 1 THEN 'ALTA' ELSE 'MEDIA' END AS confidence,
       CASE WHEN r.lexical_overlap > 0 AND r.n_lexical = 1
            THEN 'fecha de providencia = fecha de actuación, con coincidencia de texto'
            ELSE 'fecha de providencia = fecha de actuación, candidato único'
       END AS match_basis
  FROM ranked r
 WHERE (r.lexical_overlap > 0 AND r.n_lexical = 1)
    OR r.n_candidates = 1;

COMMENT ON VIEW public.v_providencia_cross_ref IS
  'ZZ1 — cross-reference between an actuación and the estado that published the SAME providencia. '
  'Rows are references, never a merge: both evidence classes keep their own table, dates and labels. '
  'A link is emitted only when the candidate is unambiguous.';

GRANT SELECT ON public.v_providencia_cross_ref TO authenticated;
GRANT SELECT ON public.v_providencia_cross_ref TO service_role;

-- ============================================================
-- ZZ3 — a read that persisted rows is a read WITH DATA
-- Legacy adapters report inserted_count = 0 on the attempt; the
-- persistence tally lives on the run row. Grading only the attempt
-- produced "0 con datos" beside "1 novedad detectada".
-- ============================================================

CREATE OR REPLACE FUNCTION public.source_collection_quality(
  _source text,
  _from timestamp with time zone DEFAULT (now() - '24:00:00'::interval),
  _to timestamp with time zone DEFAULT now())
RETURNS TABLE(source text, expected_count integer, attempted_count integer,
  usable_confirmed_count integer, success_count integer, success_empty_count integer,
  not_found_count integer, restricted_count integer, pending_upstream_count integer,
  error_count integer, coverage_ratio numeric, last_attempt_at timestamp with time zone,
  source_quality_state text, expected_before_profile integer, excluded_by_profile integer)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE src text := lower(_source); wf text[]; chan text;
BEGIN
  wf := CASE src
    WHEN 'cpnu' THEN ARRAY['CGP','LABORAL','PENAL_906','EJECUTIVO','TUTELA','INDETERMINADO']
    WHEN 'publicaciones' THEN ARRAY['CGP','LABORAL','PENAL_906','EJECUTIVO','TUTELA','INDETERMINADO']
    WHEN 'samai' THEN ARRAY['CPACA','TUTELA','INDETERMINADO']
    WHEN 'samai_estados' THEN ARRAY['CPACA','TUTELA','INDETERMINADO']
    ELSE ARRAY[]::text[] END;
  chan := CASE WHEN src IN ('publicaciones','samai_estados') THEN 'ESTADOS' ELSE 'ACTS' END;

  RETURN QUERY
  WITH elig AS (
    SELECT w.id, w.radicado FROM public.work_items w
     WHERE w.deleted_at IS NULL
       AND coalesce(w.lifecycle_state::text,'ACTIVE')='ACTIVE'
       AND coalesce(w.monitoring_enabled,true)
       AND w.workflow_type::text = ANY(wf)
       AND NOT (src IN ('publicaciones','samai_estados') AND (
             upper(coalesce(w.stage,'')) ~ 'ARCHIV|FINALIZ|PRECLUID'
          OR upper(coalesce(w.ubicacion_expediente,'')) ~ 'AL[[:space:]]+DESPACHO.*SENTENCIA|PARA[[:space:]]+SENTENCIA'
          OR (w.fecha_para_sentencia IS NOT NULL AND upper(coalesce(w.ubicacion_expediente,'')) ~ 'DESPACHO')))
  ), att AS (
    SELECT r.work_item_id, r.started_at,
           lower(coalesce(a.value->>'status','')) att_status,
           upper(coalesce(a.value->>'outcome', a.value->>'error_code', r.error_code,'')) outcome,
           -- ZZ3: what the run actually persisted on this provider's channel.
           CASE WHEN chan = 'ESTADOS'
                THEN coalesce(r.total_inserted_pubs, 0)
                ELSE coalesce(r.total_inserted_acts, 0) END AS persisted
      FROM public.external_sync_runs r
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.provider_attempts,'[]'::jsonb)) a(value)
     WHERE lower(coalesce(a.value->>'provider','')) = src
       AND r.started_at BETWEEN _from AND _to
  ), graded AS (
    SELECT *, CASE
      WHEN outcome='RUN_SUCCESS_WITH_DATA' THEN 1
      -- ZZ3: the attempt says "empty" but the run stored rows on this channel.
      -- The stored row is the harder evidence; grade it as a read with data.
      WHEN outcome='RUN_SUCCESS_EMPTY' AND persisted > 0 THEN 1
      WHEN outcome='RUN_SUCCESS_EMPTY' THEN 2
      WHEN outcome IN ('RUN_SUCCESS_NOT_FOUND','NOT_FOUND','PROVIDER_NOT_FOUND','RADICADO_NOT_FOUND') THEN 3
      WHEN outcome='PROCESO_PRIVADO' THEN 4
      WHEN outcome IN ('PENDING_UPSTREAM','SCRAPING_INITIATED','SOURCE_STALE') THEN 5
      WHEN outcome='RUN_FAILED' THEN 6
      WHEN att_status='success' AND persisted > 0 THEN 1
      WHEN att_status='success' THEN 1
      WHEN att_status='empty' AND persisted > 0 THEN 1
      WHEN att_status='empty' THEN 2
      WHEN att_status='not_found' THEN 3
      ELSE 6 END grade
    FROM att
  ), excl AS (
    SELECT e.id FROM elig e
     WHERE public.despacho_profile_explains_absence(e.radicado, chan, _to)
       AND NOT EXISTS (SELECT 1 FROM graded g WHERE g.work_item_id = e.id AND g.grade = 5)
  ), best AS (
    SELECT DISTINCT ON (work_item_id) work_item_id, grade
      FROM graded
     WHERE work_item_id NOT IN (SELECT id FROM excl)
     ORDER BY work_item_id, grade
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
  ), tot AS (
    SELECT (SELECT count(*) FROM elig)::int all_n, (SELECT count(*) FROM excl)::int excl_n
  )
  SELECT src,
         (tot.all_n - tot.excl_n)::int,
         cov.attempted, (cov.ok+cov.empty+cov.nf)::int,
         cov.ok, cov.empty, cov.nf, cov.restricted, cov.pending, cov.errs,
         CASE WHEN (tot.all_n - tot.excl_n) > 0
              THEN round(least((cov.ok+cov.empty+cov.nf)::numeric/(tot.all_n - tot.excl_n),1),4) END,
         cov.last_at,
         public.classify_source_run_quality(
           (tot.all_n - tot.excl_n), cov.attempted, (cov.ok+cov.empty+cov.nf),
           cov.pending, cov.nf, cov.errs, cov.attempted>0, false),
         tot.all_n, tot.excl_n
    FROM tot, cov;
END; $function$;