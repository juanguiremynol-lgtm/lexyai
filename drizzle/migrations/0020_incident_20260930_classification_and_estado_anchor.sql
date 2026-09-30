-- A. Classification: explicit act nature wins over a bare mention.
UPDATE public.providencia_classification_rules
   SET pattern_regex = 'ORDENA.*REQUERIR|AUTO.*REQUERIR|REQUERIMIENTO|REQUIERE|DESISTIMIENTO T[AÁ]CITO', updated_at = now()
 WHERE id = '134925aa-4b97-4ed5-95ea-79c77731bdb8';
-- Generic NOTIFICA only when the act IS a notification (starts with it), not when it mentions one.
UPDATE public.providencia_classification_rules
   SET pattern_regex = '^\s*(NOTIFICACI[OÓ]N|SE NOTIFICA)', updated_at = now()
 WHERE id = '7c00959c-e964-46f4-af7b-c2f16c2a4fe3';
-- Generic SENTENCIA only when the act IS a sentencia/fallo or states it was proferida.
UPDATE public.providencia_classification_rules
   SET pattern_regex = '^\s*(SENTENCIA|FALLO)|PROFIERE SENTENCIA|DICTA SENTENCIA|SE DICT[OÓ] SENTENCIA|SENTENCIA (ANTICIPADA )?(DE PRIMERA|DE SEGUNDA|PROFERIDA)', updated_at = now()
 WHERE id = '8c2af269-42b7-4331-bb00-eadc4f27c3c7';

INSERT INTO public.providencia_classification_rules
  (providencia_type, deadline_type, triggers_deadline, severity, priority, pattern_regex, description, is_active)
VALUES
  ('ACTUACION_ANULADA', NULL, false, 'INFO', 1,
   'ERROR DE INGRESO|ACTUACI[OÓ]N ANULADA', 'Actuación anulada / error de ingreso: no activa nada', true),
  ('COMUNICACION_SECRETARIAL', NULL, false, 'INFO', 2,
   '^\s*COMUNICACI[OÓ]N (AL|POR) CORREO|^\s*OFICIO\b|SE COMUNIC[OÓ] EL AUTO',
   'Comunicación secretarial: no crea por sí misma término genérico', true),
  ('RECONOCIMIENTO_NOTIFICACION', 'REVISION_MANUAL', true, 'WARNING', 3,
   'TIENE[N]? (POR )?NOTIFICAD|NOTIFICAD[OA]S? POR CONDUCTA CONCLUYENTE',
   'Auto que tiene por notificado: revisar órdenes de traslado (revisión manual)', true),
  ('AUTO_DISPONE_SENTENCIA', 'REVISION_MANUAL', true, 'WARNING', 4,
   '^\s*AUTO\M.*(MEDIANTE|DICTAR|PROFERIR|RESOLVER)[^.]{0,40}SENTENCIA ANTICIPADA',
   'Auto que dispone dictar sentencia anticipada: no es sentencia proferida (revisión manual)', true),
  ('TRASLADO_DESISTIMIENTO', 'REVISION_MANUAL', true, 'WARNING', 5,
   'TRASLADO.*DESISTIMIENTO|DESISTIMIENTO.*TRASLADO',
   'Traslado de escrito de desistimiento: no es requerimiento (revisión manual)', true);

-- C. Estado anchor: notification by estado occurs on the fijación day; the
-- term runs from the next business day (art. 118 CGP). No invented desfijación.
CREATE OR REPLACE FUNCTION public.compute_deadline_for_publicacion(p_pub_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_pub RECORD; v_c RECORD; v_r RECORD; v_id UUID;
  v_workflow TEXT; v_text TEXT; v_fijacion DATE; v_desfijacion DATE; v_provider_desfij BOOLEAN;
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
  v_provider_desfij := v_pub.fecha_desfijacion IS NOT NULL;
  v_desfijacion := CASE WHEN v_provider_desfij THEN (v_pub.fecha_desfijacion AT TIME ZONE 'America/Bogota')::DATE END;

  SELECT * INTO v_auto FROM public.resolve_published_auto(p_pub_id) LIMIT 1;
  v_text := v_auto.auto_text;
  IF v_text IS NOT NULL THEN
    SELECT * INTO v_c FROM public.classify_providencia(v_text, v_workflow) LIMIT 1;
  END IF;

  IF v_text IS NULL OR v_c.rule_id IS NULL OR NOT v_c.triggers_deadline OR v_c.deadline_type IS NULL
     OR v_c.deadline_type = 'REVISION_MANUAL' THEN
    IF v_text IS NOT NULL AND v_c.rule_id IS NOT NULL AND NOT COALESCE(v_c.triggers_deadline, false) THEN
      RETURN NULL;
    END IF;
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
        'auto_resolution', CASE WHEN v_text IS NULL THEN 'UNRESOLVED' ELSE v_auto.auto_source END,
        'requires_manual_review', true,
        'manual_review_reason', CASE WHEN v_text IS NULL THEN 'AUTO_NO_RESUELTO_DESDE_ESTADO' ELSE 'CLASIFICACION_REQUIERE_LECTURA:' || v_c.providencia_type END,
        'classification_rule_id', v_c.rule_id,
        'workflow_type', v_workflow, 'pub_id', v_pub.id,
        'classification_text', LEFT(COALESCE(v_text, concat_ws(' ', v_pub.title, v_pub.annotation)), 500))
    )
    ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  -- Anchor = notification date (fijación). A provider-supplied desfijación is
  -- evidence of a different vehicle (e.g. traslado list) and is used as given.
  SELECT * INTO v_r FROM public.compute_deadline_from_rule(COALESCE(v_desfijacion, v_fijacion), v_workflow, v_c.deadline_type) LIMIT 1;
  IF v_r.rule_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta
  ) VALUES (
    v_pub.owner_id, v_pub.organization_id, v_pub.work_item_id,
    v_c.deadline_type, v_c.providencia_type, LEFT(v_text, 500),
    'ESTADO_NUEVO', v_fijacion,
    v_r.deadline_date,
    CASE WHEN v_r.day_type = 'BUSINESS' THEN v_r.days_amount END,
    CASE WHEN v_r.requires_manual_review OR v_r.deadline_date IS NULL THEN 'REQUIERE_REVISION_MANUAL' ELSE 'PENDING' END,
    jsonb_build_object(
      'anchor_source', 'AUTO_VIA_FIJACION', 'anchor_date', v_fijacion,
      'rule_anchor_date', COALESCE(v_desfijacion, v_fijacion),
      'desfijacion_date', v_desfijacion,
      'desfijacion_source', CASE WHEN v_provider_desfij THEN 'PROVIDER' ELSE 'NOT_APPLICABLE_ESTADO_ART118' END,
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
  IF COALESCE((v_act.raw_data->>'is_annulled')::boolean, false)
     OR UPPER(COALESCE(v_act.raw_data->>'estado', '')) = 'ANULADA' THEN
    RETURN NULL;
  END IF;
  v_workflow := v_act.wf;

  BEGIN
    v_fecha_inicial := NULLIF(COALESCE(v_act.raw_data->>'fecha_inicia_termino', v_act.raw_data->>'fechaInicial', v_act.raw_data->>'fecha_inicial'), '')::DATE;
    v_fecha_final := NULLIF(COALESCE(v_act.raw_data->>'fecha_finaliza_termino', v_act.raw_data->>'fechaFinal', v_act.raw_data->>'fecha_final'), '')::DATE;
  EXCEPTION WHEN OTHERS THEN v_fecha_inicial := NULL; v_fecha_final := NULL; END;
  IF v_fecha_inicial IS NOT NULL AND v_fecha_inicial <= DATE '1990-01-01' THEN v_fecha_inicial := NULL; END IF;
  IF v_fecha_final IS NOT NULL AND v_fecha_final <= DATE '1990-01-01' THEN v_fecha_final := NULL; END IF;

  SELECT * INTO v_c FROM public.classify_providencia(COALESCE(v_act.description, ''), v_workflow) LIMIT 1;

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
    ELSE
      -- Art. 118 CGP: the estado IS the notification; counting starts the next
      -- business day, which add_business_days_sql already does. No desfijación shift.
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

-- Same double shift in the manual-review recompute; also never revive rows
-- under an audit hold.
CREATE OR REPLACE FUNCTION public.recompute_manual_review_deadlines()
 RETURNS TABLE(reviewed integer, resolved integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  d RECORD; v_wf TEXT; v_fij DATE; v_r RECORD;
  v_reviewed INT := 0; v_resolved INT := 0;
BEGIN
  FOR d IN
    SELECT dl.*, w.workflow_type::TEXT AS wf
      FROM public.work_item_deadlines dl JOIN public.work_items w ON w.id = dl.work_item_id
     WHERE dl.status = 'REQUIERE_REVISION_MANUAL'
       AND dl.deadline_type <> 'REVISION_MANUAL'
       AND NOT (COALESCE(dl.calculation_meta, '{}'::jsonb) ? 'audit_hold')
  LOOP
    v_reviewed := v_reviewed + 1; v_wf := d.wf; v_fij := NULL;
    IF COALESCE(d.calculation_meta->>'anchor_source','') IN ('CPNU_FIJACION_ESTADO','PUBLICACION_FIJACION','FECHA_FIJACION') THEN
      BEGIN v_fij := (d.calculation_meta->>'anchor_date')::DATE; EXCEPTION WHEN OTHERS THEN v_fij := NULL; END;
    END IF;
    IF v_fij IS NULL THEN
      SELECT s.act_date INTO v_fij FROM public.work_item_acts s
       WHERE s.work_item_id = d.work_item_id AND COALESCE(s.is_archived,false) = false
         AND s.act_date IS NOT NULL AND s.act_date BETWEEN (d.trigger_date - 10) AND (d.trigger_date + 10)
         AND (COALESCE(s.description,'') || ' ' || COALESCE(s.act_type,'')) ~* 'FIJACI[OÓ]N\s*(DE\s*)?ESTADO'
       ORDER BY abs(s.act_date - d.trigger_date) ASC LIMIT 1;
    END IF;
    IF v_fij IS NULL THEN
      SELECT (p.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE INTO v_fij FROM public.work_item_publicaciones p
       WHERE p.work_item_id = d.work_item_id AND COALESCE(p.is_archived,false) = false
         AND p.fecha_fijacion IS NOT NULL AND p.source <> 'samai_estados'
         AND (p.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE BETWEEN (d.trigger_date - 10) AND (d.trigger_date + 10)
       ORDER BY p.fecha_fijacion ASC LIMIT 1;
    END IF;
    IF v_fij IS NULL THEN CONTINUE; END IF;
    SELECT * INTO v_r FROM public.compute_deadline_from_rule(v_fij, v_wf, d.deadline_type) LIMIT 1;
    IF v_r.rule_id IS NULL OR v_r.deadline_date IS NULL THEN CONTINUE; END IF;
    UPDATE public.work_item_deadlines
       SET deadline_date = v_r.deadline_date,
           business_days_count = CASE WHEN v_r.day_type = 'BUSINESS' THEN v_r.days_amount END,
           status = 'SUGGESTED_BY_PROVIDER',
           calculation_meta = COALESCE(calculation_meta, '{}'::jsonb) || jsonb_build_object(
             'anchor_date', v_fij,
             'anchor_source', COALESCE(calculation_meta->>'anchor_source','CPNU_FIJACION_ESTADO'),
             'rule_anchor_date', v_fij,
             'desfijacion_source', 'NOT_APPLICABLE_ESTADO_ART118',
             'date_confidence', 'medium', 'rule_id', v_r.rule_id, 'day_type', v_r.day_type,
             'days_amount', v_r.days_amount, 'norma', v_r.norma, 'requires_manual_review', false,
             'recomputed_at', now(), 'recompute_reason', 'ART118_ESTADO_ANCHOR'),
           updated_at = now()
     WHERE id = d.id;
    v_resolved := v_resolved + 1;
  END LOOP;
  RETURN QUERY SELECT v_reviewed, v_resolved;
END;
$function$;

-- B. Audited backup of the four incident rows (service role only).
CREATE TABLE IF NOT EXISTS public.deadline_incident_backup_20260930 (
  deadline_id uuid PRIMARY KEY,
  snapshot jsonb NOT NULL,
  applied_updated_at timestamptz,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL
);
GRANT ALL ON public.deadline_incident_backup_20260930 TO service_role;
ALTER TABLE public.deadline_incident_backup_20260930 ENABLE ROW LEVEL SECURITY;
