-- ============================================================
-- ITERATION 8.1 — Línea procesal rendering + notificación anchor gap
-- ============================================================

-- 1 & 2 & 6: timeline view -----------------------------------
DROP VIEW IF EXISTS public.work_item_timeline_v;
CREATE VIEW public.work_item_timeline_v
WITH (security_invoker = true) AS
 SELECT a.work_item_id,
    COALESCE(a.act_date::timestamptz, a.detected_at, a.created_at) AS occurred_at,
    'ACTUACION'::text AS kind,
    "left"(COALESCE(a.description, 'Actuación'), 300) AS title,
    a.id AS ref_id,
    jsonb_build_object('act_type', a.act_type, 'despacho', a.despacho, 'source', a.source, 'source_url', a.source_url) AS meta
   FROM public.work_item_acts a
  WHERE COALESCE(a.is_archived, false) = false
UNION ALL
 SELECT p.work_item_id,
    COALESCE(max(p.fecha_fijacion), max(p.published_at), max(p.created_at)) AS occurred_at,
    'ESTADO'::text AS kind,
    "left"(max(COALESCE(p.title, p.annotation, 'Estado electrónico')), 300) AS title,
    (min(p.id::text))::uuid AS ref_id,
    jsonb_build_object(
      'tipo', max(p.tipo_publicacion), 'despacho', max(p.despacho),
      'pdf_url', max(p.pdf_url), 'fecha_desfijacion', max(p.fecha_desfijacion),
      'source', max(p.source), 'attachment_count', count(*)) AS meta
   FROM public.work_item_publicaciones p
  WHERE COALESCE(p.is_archived, false) = false
  GROUP BY p.work_item_id,
    COALESCE((p.fecha_fijacion AT TIME ZONE 'America/Bogota')::date,
             (p.published_at AT TIME ZONE 'America/Bogota')::date,
             p.created_at::date),
    lower(btrim(COALESCE(p.title, p.annotation, 'estado')))
UNION ALL
 SELECT e.work_item_id,
    COALESCE(e.received_at, e.created_at) AS occurred_at,
    'CORREO'::text AS kind,
    "left"(COALESCE(e.subject, '(sin asunto)'), 300) AS title,
    e.id AS ref_id,
    jsonb_build_object('direction', e.direction, 'sender', e.sender, 'web_link', e.web_link, 'evidence_type', e.evidence_type, 'evidence_subtype', e.evidence_subtype, 'memorial_subtype', e.memorial_subtype, 'has_attachments', e.has_attachments) AS meta
   FROM public.work_item_email_links e
  WHERE e.link_status = 'CONFIRMED'
UNION ALL
 SELECT d.work_item_id,
    COALESCE(d.trigger_date::timestamptz, d.deadline_date::timestamptz, d.created_at) AS occurred_at,
    'TERMINO'::text AS kind,
    d.label AS title,
    d.id AS ref_id,
    jsonb_build_object('status', d.status, 'deadline_date', d.deadline_date, 'deadline_type', d.deadline_type, 'trigger_date', d.trigger_date, 'business_days_count', d.business_days_count,
      'desfijacion_source', d.calculation_meta->>'desfijacion_source',
      'date_confidence', d.calculation_meta->>'date_confidence') AS meta
   FROM public.work_item_deadlines d
  WHERE d.status NOT IN ('DISMISSED', 'CANCELLED')
UNION ALL
 SELECT s.work_item_id,
    s.created_at AS occurred_at,
    'ETAPA'::text AS kind,
    COALESCE(s.new_stage, 'Cambio de etapa') AS title,
    s.id AS ref_id,
    jsonb_build_object('previous_stage', s.previous_stage, 'new_stage', s.new_stage, 'change_source', s.change_source, 'reason', s.reason) AS meta
   FROM public.work_item_stage_audit s;

GRANT SELECT ON public.work_item_timeline_v TO authenticated;
GRANT SELECT ON public.work_item_timeline_v TO service_role;

-- 5a: derived desfijación helper -----------------------------
CREATE OR REPLACE FUNCTION public.derive_desfijacion(p_fijacion date, p_desfijacion date DEFAULT NULL)
RETURNS date
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT COALESCE(p_desfijacion, public.add_business_days_sql(p_fijacion, 1)); $$;

-- 5b: missing normative rule for notificación por estado -----
INSERT INTO public.deadline_rules (workflow_type, deadline_type, day_type, days_amount, norma, description, is_active, requires_manual_review)
SELECT v.wf, 'RESPUESTA_NOTIFICACION', 'BUSINESS', 3, v.norma, 'Ejecutoria / actuación tras notificación por estado', true, false
FROM (VALUES
  ('CGP', 'CGP Art. 302'),
  ('CPACA', 'CPACA Art. 242 (rem. CGP 302)'),
  ('LABORAL', 'CPT — ejecutoria 3 días'),
  ('GENERIC', 'Ejecutoria 3 días hábiles')
) AS v(wf, norma)
WHERE NOT EXISTS (
  SELECT 1 FROM public.deadline_rules r
   WHERE r.workflow_type = v.wf AND r.deadline_type = 'RESPUESTA_NOTIFICACION');

-- 5c: engine — actuación route -------------------------------
CREATE OR REPLACE FUNCTION public.compute_deadline_for_actuacion(p_act_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_act RECORD; v_c RECORD; v_r RECORD;
  v_fecha_inicial DATE; v_fecha_final DATE; v_id UUID;
  v_workflow TEXT;
  v_anchor_source TEXT;
  v_business_days INT;
  v_status TEXT;
  v_meta JSONB;
  v_fijacion DATE;
  v_desfijacion DATE;
  v_rule_anchor DATE;
  v_has_rule BOOLEAN := false;
BEGIN
  SELECT a.id, a.work_item_id, a.description, a.act_type, a.act_date, a.raw_data, a.is_archived,
         w.workflow_type::TEXT AS wf, w.owner_id, w.organization_id
    INTO v_act
    FROM public.work_item_acts a
    JOIN public.work_items w ON w.id = a.work_item_id
    WHERE a.id = p_act_id;

  IF NOT FOUND OR COALESCE(v_act.is_archived, false) THEN RETURN NULL; END IF;

  IF COALESCE((v_act.raw_data->>'is_annulled')::boolean, false)
     OR UPPER(COALESCE(v_act.raw_data->>'estado', '')) = 'ANULADA' THEN
    RETURN NULL;
  END IF;

  v_workflow := v_act.wf;

  BEGIN
    v_fecha_inicial := NULLIF(COALESCE(
        v_act.raw_data->>'fecha_inicia_termino',
        v_act.raw_data->>'fechaInicial',
        v_act.raw_data->>'fecha_inicial'), '')::DATE;
    v_fecha_final := NULLIF(COALESCE(
        v_act.raw_data->>'fecha_finaliza_termino',
        v_act.raw_data->>'fechaFinal',
        v_act.raw_data->>'fecha_final'), '')::DATE;
  EXCEPTION WHEN OTHERS THEN
    v_fecha_inicial := NULL; v_fecha_final := NULL;
  END;

  IF v_fecha_inicial IS NOT NULL AND v_fecha_inicial <= DATE '1990-01-01' THEN v_fecha_inicial := NULL; END IF;
  IF v_fecha_final IS NOT NULL AND v_fecha_final <= DATE '1990-01-01' THEN v_fecha_final := NULL; END IF;

  SELECT * INTO v_c FROM public.classify_providencia(COALESCE(v_act.description, ''), v_workflow) LIMIT 1;

  IF v_fecha_inicial IS NOT NULL AND v_fecha_final IS NOT NULL AND v_fecha_final > v_fecha_inicial THEN
    v_anchor_source := 'DESPACHO';
    v_business_days := NULL;
    v_status := 'PENDING';
  ELSE
    IF v_c.rule_id IS NULL OR NOT COALESCE(v_c.triggers_deadline, false) OR v_c.deadline_type IS NULL THEN
      RETURN NULL;
    END IF;

    IF v_fecha_inicial IS NULL THEN
      -- Alternative fijación anchor: the "Fijacion Estado" actuación itself
      SELECT s.act_date INTO v_fijacion
        FROM public.work_item_acts s
       WHERE s.work_item_id = v_act.work_item_id
         AND s.id <> v_act.id
         AND COALESCE(s.is_archived, false) = false
         AND s.act_date IS NOT NULL
         AND v_act.act_date IS NOT NULL
         AND s.act_date BETWEEN v_act.act_date AND (v_act.act_date + 5)
         AND (COALESCE(s.description, '') || ' ' || COALESCE(s.act_type, ''))
             ~* 'FIJACI[OÓ]N\s*(DE\s*)?ESTADO'
       ORDER BY s.act_date ASC
       LIMIT 1;

      IF v_fijacion IS NOT NULL THEN
        v_fecha_inicial := v_fijacion;
        v_anchor_source := 'CPNU_FIJACION_ESTADO';
      ELSE
        SELECT (p.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE INTO v_fijacion
          FROM public.work_item_publicaciones p
         WHERE p.work_item_id = v_act.work_item_id
           AND COALESCE(p.is_archived, false) = false
           AND p.fecha_fijacion IS NOT NULL
           AND v_act.act_date IS NOT NULL
           AND (p.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE
               BETWEEN v_act.act_date AND (v_act.act_date + 10)
         ORDER BY p.fecha_fijacion ASC
         LIMIT 1;

        IF v_fijacion IS NOT NULL THEN
          v_fecha_inicial := v_fijacion;
          v_anchor_source := 'PUBLICACION_FIJACION';
        ELSIF (COALESCE(v_act.description, '') || ' ' || COALESCE(v_act.act_type, ''))
              ~* 'FIJACI[OÓ]N\s*(DE\s*)?ESTADO' AND v_act.act_date IS NOT NULL THEN
          v_fecha_inicial := v_act.act_date;
          v_anchor_source := 'CPNU_FIJACION_ESTADO';
        END IF;
      END IF;
    ELSE
      v_anchor_source := 'DESPACHO_HIBRIDO';
    END IF;

    IF v_fecha_inicial IS NULL THEN
      v_anchor_source := 'SIN_ANCLA_DISPONIBLE';
      v_status := 'REQUIERE_REVISION_MANUAL';
      v_fecha_final := NULL;
      v_business_days := NULL;
      v_fecha_inicial := v_act.act_date;
    ELSE
      -- Providers never publish desfijación: derive it as the next business day.
      IF v_anchor_source IN ('CPNU_FIJACION_ESTADO', 'PUBLICACION_FIJACION') THEN
        v_desfijacion := public.derive_desfijacion(v_fecha_inicial, NULL);
        v_rule_anchor := v_desfijacion;
      ELSE
        v_rule_anchor := v_fecha_inicial;
      END IF;

      SELECT * INTO v_r FROM public.compute_deadline_from_rule(
        v_rule_anchor, v_workflow, v_c.deadline_type) LIMIT 1;

      v_has_rule := FOUND AND v_r.rule_id IS NOT NULL;

      IF NOT v_has_rule OR v_r.deadline_date IS NULL OR v_r.deadline_date <= v_rule_anchor THEN
        v_status := 'REQUIERE_REVISION_MANUAL';
        v_fecha_final := NULL;
        v_business_days := NULL;
      ELSE
        v_fecha_final := v_r.deadline_date;
        v_business_days := CASE WHEN v_r.day_type = 'BUSINESS' THEN v_r.days_amount END;
        v_status := 'PENDING';
      END IF;
    END IF;
  END IF;

  IF v_fecha_inicial IS NULL THEN RETURN NULL; END IF;

  v_meta := jsonb_build_object(
    'anchor_source', v_anchor_source,
    'anchor_date', v_fecha_inicial,
    'act_id', v_act.id,
    'act_date', v_act.act_date,
    'workflow_type', v_workflow,
    'providencia_type', v_c.providencia_type,
    'classification_rule_id', v_c.rule_id
  );

  IF v_desfijacion IS NOT NULL THEN
    v_meta := v_meta || jsonb_build_object(
      'desfijacion_date', v_desfijacion,
      'desfijacion_source', 'DERIVED_NEXT_BUSINESS_DAY',
      'date_confidence', 'medium');
  END IF;

  IF v_status = 'REQUIERE_REVISION_MANUAL' THEN
    v_meta := v_meta || jsonb_build_object(
      'requires_manual_review', true,
      'manual_review_reason',
        CASE WHEN v_anchor_source = 'SIN_ANCLA_DISPONIBLE'
             THEN 'Providencia con efecto de término sin fecha de fijación confirmada (ni despacho, ni Fijación Estado CPNU, ni publicación). El término legal puede estar corriendo.'
             ELSE 'Ancla identificada pero la matriz normativa no permite calcular una fecha cierta para este tipo de proceso.' END
    );
  END IF;

  IF v_has_rule THEN
    v_meta := v_meta || jsonb_build_object(
      'rule_id', v_r.rule_id, 'day_type', v_r.day_type,
      'days_amount', v_r.days_amount, 'norma', v_r.norma);
  END IF;
  IF v_anchor_source = 'DESPACHO' THEN
    v_meta := v_meta || jsonb_build_object('fecha_final_despacho', v_fecha_final);
  END IF;

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta
  ) VALUES (
    v_act.owner_id, v_act.organization_id, v_act.work_item_id,
    COALESCE(v_c.deadline_type, 'DESPACHO_AUTORITATIVO'),
    COALESCE(v_c.providencia_type, 'Actuación con término del despacho'),
    LEFT(COALESCE(v_act.description, ''), 500),
    CASE WHEN v_anchor_source IN ('DESPACHO', 'DESPACHO_HIBRIDO') THEN 'ACTUACION_DESPACHO' ELSE v_anchor_source END,
    v_fecha_inicial,
    v_fecha_final,
    v_business_days,
    v_status,
    v_meta
  )
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- 5d: engine — publicación route -----------------------------
CREATE OR REPLACE FUNCTION public.compute_deadline_for_publicacion(p_pub_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pub RECORD; v_c RECORD; v_r RECORD; v_id UUID;
  v_workflow TEXT;
  v_text TEXT;
  v_fijacion DATE;
  v_desfijacion DATE;
  v_derived BOOLEAN;
BEGIN
  SELECT p.id, p.work_item_id, p.title, p.annotation, p.fecha_fijacion, p.fecha_desfijacion, p.is_archived,
         p.source, p.sources,
         w.workflow_type::TEXT AS wf, w.owner_id, w.organization_id
    INTO v_pub
    FROM public.work_item_publicaciones p
    JOIN public.work_items w ON w.id = p.work_item_id
    WHERE p.id = p_pub_id;

  IF NOT FOUND OR COALESCE(v_pub.is_archived, false) OR v_pub.fecha_fijacion IS NULL THEN
    RETURN NULL;
  END IF;

  -- RATIFICADO 6.2: samai_estados no publica fechas de estado; jamás ancla términos.
  IF v_pub.source = 'samai_estados'
     OR 'samai_estados' = ANY(COALESCE(v_pub.sources, ARRAY[]::text[])) THEN
    RETURN NULL;
  END IF;

  v_workflow := v_pub.wf;
  v_text := concat_ws(' ', v_pub.title, v_pub.annotation);

  SELECT * INTO v_c FROM public.classify_providencia(v_text, v_workflow) LIMIT 1;

  IF v_c.rule_id IS NULL OR NOT v_c.triggers_deadline OR v_c.deadline_type IS NULL THEN
    RETURN NULL;
  END IF;

  v_fijacion := (v_pub.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE;
  v_derived := v_pub.fecha_desfijacion IS NULL;
  v_desfijacion := public.derive_desfijacion(
    v_fijacion,
    CASE WHEN v_pub.fecha_desfijacion IS NULL THEN NULL
         ELSE (v_pub.fecha_desfijacion AT TIME ZONE 'America/Bogota')::DATE END);

  SELECT * INTO v_r FROM public.compute_deadline_from_rule(
    v_desfijacion, v_workflow, v_c.deadline_type
  ) LIMIT 1;

  IF v_r.rule_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta
  ) VALUES (
    v_pub.owner_id, v_pub.organization_id, v_pub.work_item_id,
    v_c.deadline_type,
    v_c.providencia_type,
    LEFT(v_text, 500),
    'ESTADO_NUEVO',
    v_fijacion,
    COALESCE(v_r.deadline_date, v_desfijacion),
    CASE WHEN v_r.day_type = 'BUSINESS' THEN v_r.days_amount END,
    CASE WHEN v_r.requires_manual_review THEN 'REQUIERE_REVISION_MANUAL' ELSE 'PENDING' END,
    jsonb_build_object(
      'anchor_source', 'FECHA_FIJACION',
      'anchor_date', v_fijacion,
      'desfijacion_date', v_desfijacion,
      'desfijacion_source', CASE WHEN v_derived THEN 'DERIVED_NEXT_BUSINESS_DAY' ELSE 'PROVIDER' END,
      'date_confidence', CASE WHEN v_derived THEN 'medium' ELSE 'high' END,
      'rule_id', v_r.rule_id,
      'classification_rule_id', v_c.rule_id,
      'providencia_type', v_c.providencia_type,
      'workflow_type', v_workflow,
      'day_type', v_r.day_type,
      'days_amount', v_r.days_amount,
      'norma', v_r.norma,
      'pub_id', v_pub.id,
      'requires_manual_review', v_r.requires_manual_review,
      'classification_text', LEFT(v_text, 500)
    )
  )
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- 5e: retroactive re-run over REQUIERE_REVISION_MANUAL --------
CREATE TABLE IF NOT EXISTS public._deadline_anchor_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  reviewed int NOT NULL DEFAULT 0,
  resolved int NOT NULL DEFAULT 0,
  still_manual int NOT NULL DEFAULT 0,
  notes jsonb
);
GRANT SELECT ON public._deadline_anchor_report TO authenticated;
GRANT ALL ON public._deadline_anchor_report TO service_role;
ALTER TABLE public._deadline_anchor_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform admins read deadline anchor report" ON public._deadline_anchor_report;
CREATE POLICY "platform admins read deadline anchor report"
  ON public._deadline_anchor_report FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.recompute_manual_review_deadlines()
RETURNS TABLE(reviewed int, resolved int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d RECORD; v_wf TEXT; v_fij DATE; v_desfij DATE; v_r RECORD;
  v_reviewed INT := 0; v_resolved INT := 0;
BEGIN
  FOR d IN
    SELECT dl.*, w.workflow_type::TEXT AS wf
      FROM public.work_item_deadlines dl
      JOIN public.work_items w ON w.id = dl.work_item_id
     WHERE dl.status = 'REQUIERE_REVISION_MANUAL'
  LOOP
    v_reviewed := v_reviewed + 1;
    v_wf := d.wf;
    v_fij := NULL;

    IF COALESCE(d.calculation_meta->>'anchor_source','') IN
       ('CPNU_FIJACION_ESTADO','PUBLICACION_FIJACION','FECHA_FIJACION') THEN
      BEGIN v_fij := (d.calculation_meta->>'anchor_date')::DATE; EXCEPTION WHEN OTHERS THEN v_fij := NULL; END;
    END IF;

    IF v_fij IS NULL THEN
      SELECT s.act_date INTO v_fij
        FROM public.work_item_acts s
       WHERE s.work_item_id = d.work_item_id
         AND COALESCE(s.is_archived,false) = false
         AND s.act_date IS NOT NULL
         AND s.act_date BETWEEN (d.trigger_date - 10) AND (d.trigger_date + 10)
         AND (COALESCE(s.description,'') || ' ' || COALESCE(s.act_type,''))
             ~* 'FIJACI[OÓ]N\s*(DE\s*)?ESTADO'
       ORDER BY abs(s.act_date - d.trigger_date) ASC
       LIMIT 1;
    END IF;

    IF v_fij IS NULL THEN
      SELECT (p.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE INTO v_fij
        FROM public.work_item_publicaciones p
       WHERE p.work_item_id = d.work_item_id
         AND COALESCE(p.is_archived,false) = false
         AND p.fecha_fijacion IS NOT NULL
         AND p.source <> 'samai_estados'
         AND (p.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE
             BETWEEN (d.trigger_date - 10) AND (d.trigger_date + 10)
       ORDER BY p.fecha_fijacion ASC
       LIMIT 1;
    END IF;

    IF v_fij IS NULL THEN CONTINUE; END IF;

    v_desfij := public.derive_desfijacion(v_fij, NULL);

    SELECT * INTO v_r FROM public.compute_deadline_from_rule(v_desfij, v_wf, d.deadline_type) LIMIT 1;
    IF v_r.rule_id IS NULL OR v_r.deadline_date IS NULL THEN CONTINUE; END IF;

    UPDATE public.work_item_deadlines
       SET deadline_date = v_r.deadline_date,
           business_days_count = CASE WHEN v_r.day_type = 'BUSINESS' THEN v_r.days_amount END,
           status = 'SUGGESTED_BY_PROVIDER',
           calculation_meta = COALESCE(calculation_meta, '{}'::jsonb) || jsonb_build_object(
             'anchor_date', v_fij,
             'anchor_source', COALESCE(calculation_meta->>'anchor_source','CPNU_FIJACION_ESTADO'),
             'desfijacion_date', v_desfij,
             'desfijacion_source', 'DERIVED_NEXT_BUSINESS_DAY',
             'date_confidence', 'medium',
             'rule_id', v_r.rule_id,
             'day_type', v_r.day_type,
             'days_amount', v_r.days_amount,
             'norma', v_r.norma,
             'requires_manual_review', false,
             'recomputed_at', now(),
             'recompute_reason', 'ITER_8_1_DERIVED_DESFIJACION'),
           updated_at = now()
     WHERE id = d.id;

    v_resolved := v_resolved + 1;
  END LOOP;

  RETURN QUERY SELECT v_reviewed, v_resolved;
END;
$function$;

DO $$
DECLARE r RECORD; v_left INT;
BEGIN
  SELECT * INTO r FROM public.recompute_manual_review_deadlines();
  SELECT count(*) INTO v_left FROM public.work_item_deadlines WHERE status = 'REQUIERE_REVISION_MANUAL';
  INSERT INTO public._deadline_anchor_report (reviewed, resolved, still_manual, notes)
  VALUES (r.reviewed, r.resolved, v_left, jsonb_build_object('iteration', '8.1'));
END $$;

-- 3: stop emitting debug arrow labels in stored rows ---------
UPDATE public.work_item_deadlines
   SET label = btrim(split_part(label, '→', 1))
 WHERE label LIKE '%→%';