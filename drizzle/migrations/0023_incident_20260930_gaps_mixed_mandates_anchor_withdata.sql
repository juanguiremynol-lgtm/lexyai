-- 1. "Con datos" / coverage grading as a pure, testable function.
CREATE OR REPLACE FUNCTION public.grade_source_matters(
  p_src text, p_from timestamptz, p_to timestamptz,
  p_expected uuid[], p_attempts jsonb, p_evidence jsonb)
RETURNS TABLE(attempted int, ok int, empty int, nf int, restricted int, pending int, errs int, last_at timestamptz)
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $fn$
  WITH att AS (
    SELECT (a->>'work_item_id')::uuid wid, (a->>'started_at')::timestamptz started_at,
           lower(coalesce(a->>'status','')) st,
           upper(coalesce(a->>'outcome','')) oc,
           upper(coalesce(a->>'result_code','')) rc
      FROM jsonb_array_elements(coalesce(p_attempts,'[]'::jsonb)) a
     WHERE lower(coalesce(a->>'provider','')) = lower(p_src)
       AND (a->>'started_at')::timestamptz BETWEEN p_from AND p_to
  ), graded AS (
    SELECT wid, started_at, CASE
      WHEN oc = 'RUN_SUCCESS_WITH_DATA' THEN 1
      WHEN oc = 'RUN_SUCCESS_EMPTY' THEN 2
      WHEN oc IN ('RUN_SUCCESS_NOT_FOUND','NOT_FOUND','PROVIDER_NOT_FOUND','RADICADO_NOT_FOUND') THEN 3
      WHEN oc = 'PROCESO_PRIVADO' THEN 4
      WHEN oc IN ('PENDING_UPSTREAM','SCRAPING_INITIATED','SOURCE_STALE') THEN 5
      WHEN oc = 'RUN_FAILED' THEN 6
      WHEN st = 'success' THEN 1 WHEN st = 'empty' THEN 2 WHEN st = 'not_found' THEN 3
      ELSE 6 END grade
      FROM att
     WHERE st <> 'skipped' AND oc NOT LIKE 'ROUTING_SKIP%' AND rc NOT LIKE 'ROUTING_SKIP%'
    UNION ALL
    -- Evidence inserted in the window by this source proves the source
    -- delivered for that matter, whatever the last run said. One per matter.
    SELECT DISTINCT (e->>'work_item_id')::uuid, (e->>'created_at')::timestamptz, 1
      FROM jsonb_array_elements(coalesce(p_evidence,'[]'::jsonb)) e
     WHERE lower(coalesce(e->>'source','')) = lower(p_src)
       AND (e->>'created_at')::timestamptz BETWEEN p_from AND p_to
       AND (e->>'work_item_id')::uuid = ANY(coalesce(p_expected, ARRAY[]::uuid[]))
  ), best AS (
    SELECT DISTINCT ON (wid) wid, grade FROM graded ORDER BY wid, grade
  )
  SELECT count(*)::int,
         count(*) FILTER (WHERE grade=1)::int, count(*) FILTER (WHERE grade=2)::int,
         count(*) FILTER (WHERE grade=3)::int, count(*) FILTER (WHERE grade=4)::int,
         count(*) FILTER (WHERE grade=5)::int, count(*) FILTER (WHERE grade=6)::int,
         (SELECT max(started_at) FROM graded)
    FROM best;
$fn$;

CREATE OR REPLACE FUNCTION public.source_collection_quality(_source text, _from timestamp with time zone DEFAULT (now() - '24:00:00'::interval), _to timestamp with time zone DEFAULT now())
 RETURNS TABLE(source text, expected_count integer, attempted_count integer, usable_confirmed_count integer, success_count integer, success_empty_count integer, not_found_count integer, restricted_count integer, pending_upstream_count integer, error_count integer, coverage_ratio numeric, last_attempt_at timestamp with time zone, source_quality_state text, answered_count integer, restricted_matter_count integer, routing_skipped_count integer, chain text[])
 LANGUAGE plpgsql STABLE SET search_path TO 'public'
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

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_ev FROM (
    SELECT jsonb_build_object('work_item_id', work_item_id, 'source', source, 'created_at', created_at) x
      FROM public.work_item_acts
     WHERE lower(coalesce(source,'')) = src AND created_at BETWEEN _from AND _to AND NOT coalesce(is_archived,false)
    UNION ALL
    SELECT jsonb_build_object('work_item_id', work_item_id, 'source', source, 'created_at', created_at)
      FROM public.work_item_publicaciones
     WHERE lower(coalesce(source,'')) = src AND created_at BETWEEN _from AND _to AND NOT coalesce(is_archived,false)
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

-- 2. Mixed mandates: a suppressor never silences another mandate in the same text.
CREATE OR REPLACE FUNCTION public.classify_providencia(p_text text, p_workflow text DEFAULT NULL::text)
 RETURNS TABLE(rule_id uuid, providencia_type text, deadline_type text, triggers_deadline boolean, severity text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE u text := UPPER(COALESCE(p_text, '')); f record; o record; rem text;
BEGIN
  SELECT r.* INTO f FROM public.providencia_classification_rules r
   WHERE r.is_active AND (r.workflow_scope IS NULL OR p_workflow IS NULL OR p_workflow = ANY(r.workflow_scope))
     AND u ~ r.pattern_regex
   ORDER BY r.priority ASC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF f.providencia_type IN ('COMUNICACION_SECRETARIAL', 'TRASLADO_FUTURO_CONDICIONADO') THEN
    rem := regexp_replace(u, '(' || f.pattern_regex || ')' ||
             CASE WHEN f.providencia_type = 'TRASLADO_FUTURO_CONDICIONADO' THEN '[^.;]*' ELSE '' END, ' ', 'g');
    SELECT r.* INTO o FROM public.providencia_classification_rules r
     WHERE r.is_active AND r.triggers_deadline
       AND r.providencia_type NOT IN ('COMUNICACION_SECRETARIAL', 'TRASLADO_FUTURO_CONDICIONADO')
       AND (r.workflow_scope IS NULL OR p_workflow IS NULL OR p_workflow = ANY(r.workflow_scope))
       AND rem ~ r.pattern_regex
     ORDER BY r.priority ASC LIMIT 1;
    IF FOUND THEN
      -- Cannot decompose the mandates: visible manual review, no automatic term.
      RETURN QUERY SELECT o.id, 'MANDATO_MIXTO:' || f.providencia_type || '+' || o.providencia_type,
                          'REVISION_MANUAL'::text, true, 'WARNING'::text;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT f.id, f.providencia_type, f.deadline_type, f.triggers_deadline, f.severity;
END; $function$;

-- A bare notification is an event/anchor, not a 3-day obligation.
UPDATE public.providencia_classification_rules
   SET deadline_type = 'REVISION_MANUAL', severity = 'WARNING', updated_at = now(),
       description = 'Notificación sin obligación identificada: revisión manual visible, sin plazo automático'
 WHERE id = '7c00959c-e964-46f4-af7b-c2f16c2a4fe3';

-- 3/4. Estado vs lista anchor, pure and testable.
CREATE OR REPLACE FUNCTION public.resolve_publicacion_anchor(
  p_fijacion date, p_desfijacion date, p_deadline_type text, p_text text)
RETURNS TABLE(anchor date, vehicle text, manual_reason text)
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $fn$
DECLARE u text := UPPER(COALESCE(p_text, ''));
BEGIN
  IF p_fijacion IS NULL THEN
    RETURN QUERY SELECT NULL::date, 'SIN_FIJACION'::text, 'SIN_FECHA_DE_FIJACION'::text; RETURN;
  END IF;
  IF p_desfijacion IS NOT NULL AND p_desfijacion < p_fijacion THEN
    RETURN QUERY SELECT NULL::date, 'CONTRADICCION'::text, 'DESFIJACION_ANTERIOR_A_FIJACION'::text; RETURN;
  END IF;
  -- Art. 110 CGP traslado by list: only when the text says so explicitly.
  IF COALESCE(p_deadline_type,'') LIKE 'TRASLADO%'
     AND u ~ 'FIJACI[OÓ]N EN LISTA|TRASLADO (POR|EN) LISTA|ART[IÍ]CULO 110|ART\. ?110' THEN
    RETURN QUERY SELECT public.add_business_days_sql(p_fijacion, 1), 'LISTA_ART110'::text, NULL::text; RETURN;
  END IF;
  -- Estado (art. 118): notification on the fijación day. A desfijación date is
  -- metadata; one later than the next business day contradicts the channel.
  IF p_desfijacion IS NOT NULL AND p_desfijacion > public.add_business_days_sql(p_fijacion, 1) THEN
    RETURN QUERY SELECT NULL::date, 'CONTRADICCION'::text, 'DESFIJACION_INCOMPATIBLE_CON_ESTADO'::text; RETURN;
  END IF;
  RETURN QUERY SELECT p_fijacion, 'ESTADO_ART118'::text, NULL::text;
END; $fn$;

CREATE OR REPLACE FUNCTION public.compute_deadline_for_publicacion(p_pub_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_pub RECORD; v_c RECORD; v_r RECORD; v_id UUID; v_a RECORD;
  v_workflow TEXT; v_text TEXT; v_fijacion DATE; v_desfijacion DATE;
  v_auto RECORD;
BEGIN
  SELECT p.id, p.work_item_id, p.title, p.annotation, p.fecha_fijacion, p.fecha_desfijacion, p.is_archived,
         p.source, p.sources, w.workflow_type::TEXT AS wf, w.owner_id, w.organization_id
    INTO v_pub
    FROM public.work_item_publicaciones p JOIN public.work_items w ON w.id = p.work_item_id
    WHERE p.id = p_pub_id;
  IF NOT FOUND OR COALESCE(v_pub.is_archived, false) OR v_pub.fecha_fijacion IS NULL THEN RETURN NULL; END IF;

  IF (v_pub.source = 'samai_estados' OR 'samai_estados' = ANY(COALESCE(v_pub.sources, ARRAY[]::text[])))
     AND COALESCE(
           (SELECT p2.raw_data -> 'fecha_estado_procedencia' ->> 'fuente' FROM public.work_item_publicaciones p2 WHERE p2.id = p_pub_id),
           (SELECT p2.raw_data -> 'raw_data' -> 'fecha_estado_procedencia' ->> 'fuente' FROM public.work_item_publicaciones p2 WHERE p2.id = p_pub_id),
           '') <> 'SAMAI_WESTADOS' THEN
    RETURN NULL;
  END IF;

  v_workflow := v_pub.wf;
  v_fijacion := (v_pub.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE;
  v_desfijacion := CASE WHEN v_pub.fecha_desfijacion IS NOT NULL THEN (v_pub.fecha_desfijacion AT TIME ZONE 'America/Bogota')::DATE END;

  SELECT * INTO v_auto FROM public.resolve_published_auto(p_pub_id) LIMIT 1;
  v_text := v_auto.auto_text;
  IF v_text IS NOT NULL THEN
    SELECT * INTO v_c FROM public.classify_providencia(v_text, v_workflow) LIMIT 1;
  END IF;

  IF v_text IS NOT NULL AND v_c.rule_id IS NOT NULL AND NOT COALESCE(v_c.triggers_deadline, false) THEN
    RETURN NULL;
  END IF;

  IF v_text IS NOT NULL AND v_c.rule_id IS NOT NULL AND v_c.deadline_type IS NOT NULL AND v_c.deadline_type <> 'REVISION_MANUAL' THEN
    SELECT * INTO v_a FROM public.resolve_publicacion_anchor(v_fijacion, v_desfijacion, v_c.deadline_type, v_text);
  END IF;

  IF v_text IS NULL OR v_c.rule_id IS NULL OR v_c.deadline_type IS NULL
     OR v_c.deadline_type = 'REVISION_MANUAL' OR v_a.anchor IS NULL THEN
    INSERT INTO public.work_item_deadlines (
      owner_id, organization_id, work_item_id, deadline_type, label, description,
      trigger_event, trigger_date, deadline_date, business_days_count, status, requires_manual_review, calculation_meta
    ) VALUES (
      v_pub.owner_id, v_pub.organization_id, v_pub.work_item_id,
      'REVISION_MANUAL', COALESCE(v_c.providencia_type, 'Auto no resoluble desde el estado'),
      LEFT(concat_ws(' ', v_pub.title, v_pub.annotation), 500),
      'ESTADO_NUEVO', v_fijacion, NULL, NULL, 'REQUIERE_REVISION_MANUAL', true,
      jsonb_build_object(
        'anchor_source', 'AUTO_VIA_FIJACION', 'anchor_date', v_fijacion,
        'desfijacion_date', v_desfijacion,
        'auto_resolution', CASE WHEN v_text IS NULL THEN 'UNRESOLVED' ELSE v_auto.auto_source END,
        'requires_manual_review', true,
        'manual_review_reason', CASE
           WHEN v_text IS NULL THEN 'AUTO_NO_RESUELTO_DESDE_ESTADO'
           WHEN v_a.manual_reason IS NOT NULL THEN 'ANCLA:' || v_a.manual_reason
           ELSE 'CLASIFICACION_REQUIERE_LECTURA:' || v_c.providencia_type END,
        'intended_deadline_type', v_c.deadline_type,
        'classification_rule_id', v_c.rule_id,
        'workflow_type', v_workflow, 'pub_id', v_pub.id,
        'classification_text', LEFT(COALESCE(v_text, concat_ws(' ', v_pub.title, v_pub.annotation)), 500))
    )
    ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  SELECT * INTO v_r FROM public.compute_deadline_from_rule(v_a.anchor, v_workflow, v_c.deadline_type) LIMIT 1;
  IF v_r.rule_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta
  ) VALUES (
    v_pub.owner_id, v_pub.organization_id, v_pub.work_item_id,
    v_c.deadline_type, v_c.providencia_type, LEFT(v_text, 500),
    'ESTADO_NUEVO', v_fijacion, v_r.deadline_date,
    CASE WHEN v_r.day_type = 'BUSINESS' THEN v_r.days_amount END,
    CASE WHEN v_r.requires_manual_review OR v_r.deadline_date IS NULL THEN 'REQUIERE_REVISION_MANUAL' ELSE 'PENDING' END,
    jsonb_build_object(
      'anchor_source', 'AUTO_VIA_FIJACION', 'anchor_date', v_fijacion,
      'rule_anchor_date', v_a.anchor, 'vehicle', v_a.vehicle,
      'desfijacion_date', v_desfijacion, 'desfijacion_source', 'METADATA_ONLY',
      'date_confidence', 'high',
      'auto_resolution', v_auto.auto_source, 'auto_act_id', v_auto.auto_act_id,
      'rule_id', v_r.rule_id, 'classification_rule_id', v_c.rule_id,
      'providencia_type', v_c.providencia_type, 'workflow_type', v_workflow,
      'day_type', v_r.day_type, 'days_amount', v_r.days_amount, 'norma', v_r.norma,
      'pub_id', v_pub.id, 'requires_manual_review', v_r.requires_manual_review,
      'classification_text', LEFT(v_text, 500))
  )
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

-- 3. Annulled acts are excluded before ANY branch, despacho dates included.
CREATE OR REPLACE FUNCTION public.act_is_annulled(p_description text, p_raw jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  SELECT COALESCE((p_raw->>'is_annulled')::boolean, false)
      OR UPPER(COALESCE(p_raw->>'estado', '')) = 'ANULADA'
      OR UPPER(COALESCE(p_description, '')) ~ 'ERROR DE INGRESO|ACTUACI[OÓ]N ANULADA';
$fn$;

CREATE OR REPLACE FUNCTION public.compute_deadline_for_actuacion(p_act_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_act RECORD; v_c RECORD; v_r RECORD;
  v_fecha_inicial DATE; v_fecha_final DATE; v_id UUID;
  v_workflow TEXT; v_anchor_source TEXT; v_business_days INT; v_status TEXT; v_meta JSONB;
  v_fijacion DATE; v_rule_anchor DATE; v_has_rule BOOLEAN := false;
BEGIN
  SELECT a.id, a.work_item_id, a.description, a.act_type, a.act_date, a.raw_data, a.is_archived,
         w.workflow_type::TEXT AS wf, w.owner_id, w.organization_id
    INTO v_act
    FROM public.work_item_acts a JOIN public.work_items w ON w.id = a.work_item_id
    WHERE a.id = p_act_id;
  IF NOT FOUND OR COALESCE(v_act.is_archived, false) THEN RETURN NULL; END IF;
  IF public.act_is_annulled(v_act.description, v_act.raw_data) THEN RETURN NULL; END IF;
  v_workflow := v_act.wf;

  SELECT * INTO v_c FROM public.classify_providencia(COALESCE(v_act.description, ''), v_workflow) LIMIT 1;
  IF v_c.providencia_type = 'ACTUACION_ANULADA' THEN RETURN NULL; END IF;

  BEGIN
    v_fecha_inicial := NULLIF(COALESCE(v_act.raw_data->>'fecha_inicia_termino', v_act.raw_data->>'fechaInicial', v_act.raw_data->>'fecha_inicial'), '')::DATE;
    v_fecha_final := NULLIF(COALESCE(v_act.raw_data->>'fecha_finaliza_termino', v_act.raw_data->>'fechaFinal', v_act.raw_data->>'fecha_final'), '')::DATE;
  EXCEPTION WHEN OTHERS THEN v_fecha_inicial := NULL; v_fecha_final := NULL; END;
  IF v_fecha_inicial IS NOT NULL AND v_fecha_inicial <= DATE '1990-01-01' THEN v_fecha_inicial := NULL; END IF;
  IF v_fecha_final IS NOT NULL AND v_fecha_final <= DATE '1990-01-01' THEN v_fecha_final := NULL; END IF;

  IF v_fecha_inicial IS NOT NULL AND v_fecha_final IS NOT NULL AND v_fecha_final > v_fecha_inicial THEN
    v_anchor_source := 'DESPACHO'; v_business_days := NULL; v_status := 'PENDING';
  ELSE
    IF v_c.rule_id IS NULL OR NOT COALESCE(v_c.triggers_deadline, false) OR v_c.deadline_type IS NULL THEN
      RETURN NULL;
    END IF;
    IF v_fecha_inicial IS NULL THEN
      SELECT s.act_date INTO v_fijacion FROM public.work_item_acts s
       WHERE s.work_item_id = v_act.work_item_id AND s.id <> v_act.id
         AND COALESCE(s.is_archived, false) = false
         AND s.act_date IS NOT NULL AND v_act.act_date IS NOT NULL
         AND s.act_date BETWEEN (v_act.act_date - 5) AND (v_act.act_date + 5)
         AND (COALESCE(s.description, '') || ' ' || COALESCE(s.act_type, '')) ~* 'FIJACI[OÓ]N\s*(DE\s*)?ESTADO'
       ORDER BY abs(s.act_date - v_act.act_date) ASC, s.act_date ASC LIMIT 1;
      IF v_fijacion IS NOT NULL THEN
        v_fecha_inicial := v_fijacion; v_anchor_source := 'CPNU_FIJACION_ESTADO';
      ELSE
        SELECT (p.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE INTO v_fijacion
          FROM public.work_item_publicaciones p
         WHERE p.work_item_id = v_act.work_item_id AND COALESCE(p.is_archived, false) = false
           AND p.fecha_fijacion IS NOT NULL AND v_act.act_date IS NOT NULL
           AND (p.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE BETWEEN (v_act.act_date - 5) AND (v_act.act_date + 10)
         ORDER BY abs((p.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE - v_act.act_date) ASC, p.fecha_fijacion ASC LIMIT 1;
        IF v_fijacion IS NOT NULL THEN
          v_fecha_inicial := v_fijacion; v_anchor_source := 'PUBLICACION_FIJACION';
        ELSIF (COALESCE(v_act.description, '') || ' ' || COALESCE(v_act.act_type, '')) ~* 'FIJACI[OÓ]N\s*(DE\s*)?ESTADO' AND v_act.act_date IS NOT NULL THEN
          v_fecha_inicial := v_act.act_date; v_anchor_source := 'CPNU_FIJACION_ESTADO';
        END IF;
      END IF;
    ELSE
      v_anchor_source := 'DESPACHO_HIBRIDO';
    END IF;

    IF v_fecha_inicial IS NULL THEN
      v_anchor_source := 'SIN_ANCLA_DISPONIBLE'; v_status := 'REQUIERE_REVISION_MANUAL';
      v_fecha_final := NULL; v_business_days := NULL; v_fecha_inicial := v_act.act_date;
    ELSIF v_c.deadline_type = 'REVISION_MANUAL' THEN
      v_status := 'REQUIERE_REVISION_MANUAL'; v_fecha_final := NULL; v_business_days := NULL;
    ELSE
      v_rule_anchor := v_fecha_inicial;
      SELECT * INTO v_r FROM public.compute_deadline_from_rule(v_rule_anchor, v_workflow, v_c.deadline_type) LIMIT 1;
      v_has_rule := FOUND AND v_r.rule_id IS NOT NULL;
      IF NOT v_has_rule OR v_r.deadline_date IS NULL OR v_r.deadline_date <= v_rule_anchor THEN
        v_status := 'REQUIERE_REVISION_MANUAL'; v_fecha_final := NULL; v_business_days := NULL;
      ELSE
        v_fecha_final := v_r.deadline_date;
        v_business_days := CASE WHEN v_r.day_type = 'BUSINESS' THEN v_r.days_amount END;
        v_status := 'PENDING';
      END IF;
    END IF;
  END IF;

  IF v_fecha_inicial IS NULL THEN RETURN NULL; END IF;

  v_meta := jsonb_build_object(
    'anchor_source', v_anchor_source, 'anchor_date', v_fecha_inicial,
    'act_id', v_act.id, 'act_date', v_act.act_date, 'workflow_type', v_workflow,
    'providencia_type', v_c.providencia_type, 'classification_rule_id', v_c.rule_id);
  IF v_anchor_source IN ('CPNU_FIJACION_ESTADO', 'PUBLICACION_FIJACION') THEN
    v_meta := v_meta || jsonb_build_object('rule_anchor_date', v_rule_anchor,
      'desfijacion_source', 'NOT_APPLICABLE_ESTADO_ART118', 'date_confidence', 'medium');
  END IF;
  IF v_status = 'REQUIERE_REVISION_MANUAL' THEN
    v_meta := v_meta || jsonb_build_object('requires_manual_review', true, 'manual_review_reason',
      CASE WHEN v_anchor_source = 'SIN_ANCLA_DISPONIBLE'
           THEN 'Providencia con efecto de término sin fecha de fijación confirmada (ni despacho, ni Fijación Estado CPNU, ni publicación). El término legal puede estar corriendo.'
           WHEN v_c.deadline_type = 'REVISION_MANUAL'
           THEN 'CLASIFICACION_REQUIERE_LECTURA:' || v_c.providencia_type
           ELSE 'Ancla identificada pero la matriz normativa no permite calcular una fecha cierta para este tipo de proceso.' END);
  END IF;
  IF v_has_rule THEN
    v_meta := v_meta || jsonb_build_object('rule_id', v_r.rule_id, 'day_type', v_r.day_type,
      'days_amount', v_r.days_amount, 'norma', v_r.norma);
  END IF;
  IF v_anchor_source = 'DESPACHO' THEN
    v_meta := v_meta || jsonb_build_object('fecha_final_despacho', v_fecha_final);
  END IF;

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, business_days_count, status, requires_manual_review, calculation_meta
  ) VALUES (
    v_act.owner_id, v_act.organization_id, v_act.work_item_id,
    COALESCE(v_c.deadline_type, 'DESPACHO_AUTORITATIVO'),
    COALESCE(v_c.providencia_type, 'Actuación con término del despacho'),
    LEFT(COALESCE(v_act.description, ''), 500),
    CASE WHEN v_anchor_source IN ('DESPACHO', 'DESPACHO_HIBRIDO') THEN 'ACTUACION_DESPACHO' ELSE v_anchor_source END,
    v_fecha_inicial, v_fecha_final, v_business_days, v_status,
    v_status = 'REQUIERE_REVISION_MANUAL', v_meta
  )
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;