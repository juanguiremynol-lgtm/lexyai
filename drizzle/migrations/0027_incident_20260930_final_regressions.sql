-- 1) Art. 110 CGP: p_fijacion is the day the list is made available; the rule
-- engine excludes the anchor once, so the anchor IS p_fijacion (no +1 day).
CREATE OR REPLACE FUNCTION public.resolve_publicacion_anchor(p_fijacion date, p_desfijacion date, p_deadline_type text, p_text text)
 RETURNS TABLE(anchor date, vehicle text, manual_reason text)
 LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE u text := UPPER(COALESCE(p_text, ''));
BEGIN
  IF p_fijacion IS NULL THEN
    RETURN QUERY SELECT NULL::date, 'SIN_FIJACION'::text, 'SIN_FECHA_DE_FIJACION'::text; RETURN;
  END IF;
  IF p_desfijacion IS NOT NULL AND p_desfijacion < p_fijacion THEN
    RETURN QUERY SELECT NULL::date, 'CONTRADICCION'::text, 'DESFIJACION_ANTERIOR_A_FIJACION'::text; RETURN;
  END IF;
  IF COALESCE(p_deadline_type,'') LIKE 'TRASLADO%'
     AND u ~ 'FIJACI[OÓ]N EN LISTA|TRASLADO (POR|EN) LISTA|ART[IÍ]CULO 110|ART\. ?110' THEN
    -- A list "desfijación" beyond the single day of availability contradicts art. 110.
    IF p_desfijacion IS NOT NULL AND p_desfijacion > public.add_business_days_sql(p_fijacion, 1) THEN
      RETURN QUERY SELECT NULL::date, 'CONTRADICCION'::text, 'DESFIJACION_INCOMPATIBLE_CON_LISTA'::text; RETURN;
    END IF;
    RETURN QUERY SELECT p_fijacion, 'LISTA_ART110'::text, NULL::text; RETURN;
  END IF;
  IF p_desfijacion IS NOT NULL AND p_desfijacion > public.add_business_days_sql(p_fijacion, 1) THEN
    RETURN QUERY SELECT NULL::date, 'CONTRADICCION'::text, 'DESFIJACION_INCOMPATIBLE_CON_ESTADO'::text; RETURN;
  END IF;
  RETURN QUERY SELECT p_fijacion, 'ESTADO_ART118'::text, NULL::text;
END; $function$;

-- 3) Attempts and evidence both restricted to the expected universe.
-- attempted = matters with a real attempt; evidence-only matters count as
-- usable-with-data but never as an attempt. status='success' without an
-- outcome is an answered read without proven data (grade 2), never "con datos".
CREATE OR REPLACE FUNCTION public.grade_source_matters(p_src text, p_from timestamp with time zone, p_to timestamp with time zone, p_expected uuid[], p_attempts jsonb, p_evidence jsonb)
 RETURNS TABLE(attempted integer, ok integer, empty integer, nf integer, restricted integer, pending integer, errs integer, last_at timestamp with time zone)
 LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  WITH exp AS (SELECT unnest(coalesce(p_expected, ARRAY[]::uuid[])) wid),
  att AS (
    SELECT (a->>'work_item_id')::uuid wid, (a->>'started_at')::timestamptz started_at,
           lower(coalesce(a->>'status','')) st,
           upper(coalesce(a->>'outcome','')) oc,
           upper(coalesce(a->>'result_code','')) rc
      FROM jsonb_array_elements(coalesce(p_attempts,'[]'::jsonb)) a
     WHERE lower(coalesce(a->>'provider','')) = lower(p_src)
       AND (a->>'started_at')::timestamptz BETWEEN p_from AND p_to
       AND (a->>'work_item_id')::uuid IN (SELECT wid FROM exp)
  ), real_att AS (
    SELECT wid, started_at, CASE
      WHEN oc = 'RUN_SUCCESS_WITH_DATA' THEN 1
      WHEN oc = 'RUN_SUCCESS_EMPTY' THEN 2
      WHEN oc IN ('RUN_SUCCESS_NOT_FOUND','NOT_FOUND','PROVIDER_NOT_FOUND','RADICADO_NOT_FOUND') THEN 3
      WHEN oc = 'PROCESO_PRIVADO' THEN 4
      WHEN oc IN ('PENDING_UPSTREAM','SCRAPING_INITIATED','SOURCE_STALE') THEN 5
      WHEN oc = 'RUN_FAILED' THEN 6
      WHEN oc = '' AND st IN ('success','empty') THEN 2
      WHEN oc = '' AND st = 'not_found' THEN 3
      ELSE 6 END grade
      FROM att
     WHERE st <> 'skipped' AND oc NOT LIKE 'ROUTING_SKIP%' AND rc NOT LIKE 'ROUTING_SKIP%'
  ), ev AS (
    SELECT DISTINCT (e->>'work_item_id')::uuid wid, 1 grade
      FROM jsonb_array_elements(coalesce(p_evidence,'[]'::jsonb)) e
     WHERE lower(coalesce(e->>'source','')) = lower(p_src)
       AND (e->>'created_at')::timestamptz BETWEEN p_from AND p_to
       AND (e->>'work_item_id')::uuid IN (SELECT wid FROM exp)
  ), graded AS (
    SELECT wid, grade FROM real_att UNION ALL SELECT wid, grade FROM ev
  ), best AS (
    SELECT DISTINCT ON (wid) wid, grade FROM graded ORDER BY wid, grade
  )
  SELECT (SELECT count(DISTINCT wid) FROM real_att)::int,
         count(*) FILTER (WHERE grade=1)::int, count(*) FILTER (WHERE grade=2)::int,
         count(*) FILTER (WHERE grade=3)::int, count(*) FILTER (WHERE grade=4)::int,
         count(*) FILTER (WHERE grade=5)::int, count(*) FILTER (WHERE grade=6)::int,
         (SELECT max(started_at) FROM real_att)
    FROM best;
$function$;

-- 4) Twin guard by proven source identity (act_id / auto_act_id / pub_id of the
-- hold and of its corroborations), not by date proximity.
CREATE OR REPLACE FUNCTION public.deadline_source_ids(m jsonb)
 RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT coalesce(array_agg(DISTINCT v) FILTER (WHERE v IS NOT NULL AND v <> ''), ARRAY[]::text[]) FROM (
    SELECT m->>'act_id' v UNION ALL SELECT m->>'auto_act_id' UNION ALL SELECT m->>'pub_id'
    UNION ALL SELECT c->'meta'->>k FROM jsonb_array_elements(coalesce(m->'corroborations','[]'::jsonb)) c,
                     unnest(ARRAY['act_id','auto_act_id','pub_id']) k
  ) s
$$;

CREATE OR REPLACE FUNCTION public.guard_audit_hold_twin()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE v_hold uuid; v_ids text[];
BEGIN
  IF NEW.status IS DISTINCT FROM 'PENDING' THEN RETURN NEW; END IF;
  v_ids := public.deadline_source_ids(COALESCE(NEW.calculation_meta, '{}'::jsonb));
  IF cardinality(v_ids) = 0 THEN RETURN NEW; END IF;
  SELECT d.id INTO v_hold FROM public.work_item_deadlines d
   WHERE d.work_item_id = NEW.work_item_id
     AND d.calculation_meta ? 'audit_hold'
     AND public.deadline_source_ids(d.calculation_meta) && v_ids
   LIMIT 1;
  IF v_hold IS NULL THEN RETURN NEW; END IF;
  NEW.calculation_meta := COALESCE(NEW.calculation_meta, '{}'::jsonb) || jsonb_build_object(
    'requires_manual_review', true,
    'manual_review_reason', 'TERMINO_EN_AUDITORIA:' || v_hold::text,
    'fechas_calculadas_no_validadas', jsonb_build_object(
      'aviso', 'NO VALIDADAS — no son plazo vencido ni activo',
      'deadline_date', NEW.deadline_date, 'business_days_count', NEW.business_days_count));
  NEW.status := 'REQUIERE_REVISION_MANUAL';
  NEW.requires_manual_review := true;
  NEW.deadline_date := NULL;
  NEW.business_days_count := NULL;
  RETURN NEW;
END; $function$;