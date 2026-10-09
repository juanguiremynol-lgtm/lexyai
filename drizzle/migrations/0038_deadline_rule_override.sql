CREATE OR REPLACE FUNCTION public.deadline_rule_override(p_work_item_id uuid, p_deadline_type text)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $f$
  SELECT CASE
    WHEN p_deadline_type = 'RESPUESTA_REQUERIMIENTO' THEN
      'REQUERIMIENTO_SIN_TERMINO: el auto no fija término y no hay término legal aplicable (art. 117 CGP); no se calcula vencimiento. La obligación subsiste: verificar cumplimiento.'
    WHEN p_deadline_type = 'RECURSO_APELACION_AUTO' AND EXISTS (
      SELECT 1 FROM public.work_items w WHERE w.id = p_work_item_id
        AND w.workflow_type::text = 'CGP'
        AND (COALESCE(w.clase_proceso,'') || ' ' || COALESCE(w.tipo_proceso,'')) ~* 'verbal\s+sumario') THEN
      'UNICA_INSTANCIA: proceso verbal sumario (art. 390 par. 1 CGP); la apelación de autos no procede (art. 321). Evaluar eventual reposición (art. 318) con el abogado responsable.'
    ELSE NULL END
$f$;

COMMENT ON FUNCTION public.deadline_rule_override(uuid,text) IS 'Owner-authorized 2026-10-09: generic rules that must not yield a dated judicial deadline (requerimiento sin término; apelación de autos en verbal sumario).';

CREATE OR REPLACE FUNCTION public.compute_deadline_for_actuacion(p_act_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_act RECORD; v_c RECORD; v_r RECORD;
  v_fecha_inicial DATE; v_fecha_final DATE; v_id UUID;
  v_workflow TEXT; v_anchor_source TEXT; v_business_days INT; v_status TEXT; v_meta JSONB;
  v_fijacion DATE; v_rule_anchor DATE; v_has_rule BOOLEAN := false; v_override TEXT;
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
      v_override := public.deadline_rule_override(v_act.work_item_id, v_c.deadline_type);
      IF v_override IS NOT NULL OR NOT v_has_rule OR v_r.deadline_date IS NULL OR v_r.deadline_date <= v_rule_anchor THEN
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
           WHEN v_override IS NOT NULL THEN v_override
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

CREATE OR REPLACE FUNCTION public.compute_deadline_for_publicacion(p_pub_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pub RECORD; v_c RECORD; v_r RECORD; v_id UUID; v_a RECORD;
  v_override TEXT; v_workflow TEXT; v_text TEXT; v_fijacion DATE; v_desfijacion DATE;
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

  SELECT NULL::date AS anchor, NULL::text AS vehicle, NULL::text AS manual_reason INTO v_a;
  SELECT NULL::uuid AS rule_id, NULL::text AS providencia_type, NULL::text AS deadline_type,
         NULL::boolean AS triggers_deadline, NULL::text AS severity INTO v_c;
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
      jsonb_strip_nulls(jsonb_build_object(
        'anchor_source', 'AUTO_VIA_FIJACION', 'anchor_date', v_fijacion,
        'auto_act_id', v_auto.auto_act_id)) || jsonb_build_object(
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
  v_override := public.deadline_rule_override(v_pub.work_item_id, v_c.deadline_type);

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, business_days_count, status, requires_manual_review, calculation_meta
  ) VALUES (
    v_pub.owner_id, v_pub.organization_id, v_pub.work_item_id,
    v_c.deadline_type, v_c.providencia_type, LEFT(v_text, 500),
    'ESTADO_NUEVO', v_fijacion, CASE WHEN v_override IS NULL THEN v_r.deadline_date END,
    CASE WHEN v_override IS NULL AND v_r.day_type = 'BUSINESS' THEN v_r.days_amount END,
    CASE WHEN v_override IS NOT NULL OR v_r.requires_manual_review OR v_r.deadline_date IS NULL THEN 'REQUIERE_REVISION_MANUAL' ELSE 'PENDING' END,
    (v_override IS NOT NULL OR COALESCE(v_r.requires_manual_review, false) OR v_r.deadline_date IS NULL),
    jsonb_build_object(
      'anchor_source', 'AUTO_VIA_FIJACION', 'anchor_date', v_fijacion,
      'rule_anchor_date', v_a.anchor, 'vehicle', v_a.vehicle,
      'desfijacion_date', v_desfijacion, 'desfijacion_source', 'METADATA_ONLY',
      'date_confidence', 'high',
      'auto_resolution', v_auto.auto_source, 'auto_act_id', v_auto.auto_act_id,
      'rule_id', v_r.rule_id, 'classification_rule_id', v_c.rule_id,
      'providencia_type', v_c.providencia_type, 'workflow_type', v_workflow,
      'day_type', v_r.day_type, 'days_amount', v_r.days_amount, 'norma', v_r.norma,
      'pub_id', v_pub.id, 'requires_manual_review', (v_override IS NOT NULL OR v_r.requires_manual_review),
      'manual_review_reason', v_override,
      'classification_text', LEFT(v_text, 500))
  )
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;