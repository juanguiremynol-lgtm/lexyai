-- 1) Deadline engine: no more zero-length "deadlines" from DESPACHO anchors.
CREATE OR REPLACE FUNCTION public.compute_deadline_for_actuacion(p_act_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_act RECORD; v_c RECORD; v_r RECORD;
  v_fecha_inicial DATE; v_fecha_final DATE; v_id UUID;
  v_workflow TEXT;
  v_anchor_source TEXT;
  v_business_days INT;
  v_meta JSONB;
BEGIN
  SELECT a.id, a.work_item_id, a.description, a.act_date, a.raw_data, a.is_archived,
         w.workflow_type::TEXT AS wf, w.owner_id, w.organization_id
    INTO v_act
    FROM public.work_item_acts a
    JOIN public.work_items w ON w.id = a.work_item_id
    WHERE a.id = p_act_id;

  IF NOT FOUND OR COALESCE(v_act.is_archived, false) THEN RETURN NULL; END IF;

  -- Annulled acts are ingested for provenance but never generate deadlines.
  IF COALESCE((v_act.raw_data->>'is_annulled')::boolean, false)
     OR UPPER(COALESCE(v_act.raw_data->>'estado', '')) = 'ANULADA' THEN
    RETURN NULL;
  END IF;

  v_workflow := v_act.wf;

  BEGIN
    v_fecha_inicial := NULLIF(
      COALESCE(
        v_act.raw_data->>'fecha_inicia_termino',
        v_act.raw_data->>'fechaInicial',
        v_act.raw_data->>'fecha_inicial'
      ), ''
    )::DATE;
    v_fecha_final := NULLIF(
      COALESCE(
        v_act.raw_data->>'fecha_finaliza_termino',
        v_act.raw_data->>'fechaFinal',
        v_act.raw_data->>'fecha_final'
      ), ''
    )::DATE;
  EXCEPTION WHEN OTHERS THEN
    v_fecha_inicial := NULL; v_fecha_final := NULL;
  END;

  IF v_fecha_inicial IS NULL OR v_fecha_inicial <= DATE '1990-01-01' THEN RETURN NULL; END IF;
  IF v_fecha_final IS NOT NULL AND v_fecha_final <= DATE '1990-01-01' THEN
    v_fecha_final := NULL;
  END IF;

  SELECT * INTO v_c FROM public.classify_providencia(
    COALESCE(v_act.description, ''), v_workflow
  ) LIMIT 1;

  IF v_fecha_final IS NOT NULL AND v_fecha_final > v_fecha_inicial THEN
    -- Authoritative court-supplied window.
    v_anchor_source := 'DESPACHO';
    v_business_days := NULL;
  ELSE
    -- Court gave only the start date: derive duration from the normative matrix.
    IF v_c.rule_id IS NULL OR NOT COALESCE(v_c.triggers_deadline, false) OR v_c.deadline_type IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT * INTO v_r FROM public.compute_deadline_from_rule(
      v_fecha_inicial, v_workflow, v_c.deadline_type
    ) LIMIT 1;

    IF v_r.rule_id IS NULL OR v_r.deadline_date IS NULL THEN RETURN NULL; END IF;

    v_fecha_final := v_r.deadline_date;
    v_anchor_source := 'DESPACHO_HIBRIDO';
    v_business_days := CASE WHEN v_r.day_type = 'BUSINESS' THEN v_r.days_amount END;
  END IF;

  -- Hard guard: a deadline that expires the day it is born is not a deadline.
  IF v_fecha_final IS NULL OR v_fecha_final <= v_fecha_inicial THEN RETURN NULL; END IF;

  v_meta := jsonb_build_object(
    'anchor_source', v_anchor_source,
    'anchor_date', v_fecha_inicial,
    'fecha_final_despacho', v_fecha_final,
    'act_id', v_act.id,
    'workflow_type', v_workflow,
    'providencia_type', v_c.providencia_type,
    'classification_rule_id', v_c.rule_id
  );
  IF v_anchor_source = 'DESPACHO_HIBRIDO' THEN
    v_meta := v_meta || jsonb_build_object(
      'rule_id', v_r.rule_id,
      'day_type', v_r.day_type,
      'days_amount', v_r.days_amount,
      'norma', v_r.norma
    );
  END IF;

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta
  ) VALUES (
    v_act.owner_id, v_act.organization_id, v_act.work_item_id,
    COALESCE(v_c.deadline_type, 'DESPACHO_AUTORITATIVO'),
    COALESCE(v_c.providencia_type, 'Actuación con término del despacho'),
    LEFT(COALESCE(v_act.description, ''), 500),
    'ACTUACION_DESPACHO',
    v_fecha_inicial,
    v_fecha_final,
    v_business_days,
    'PENDING',
    v_meta
  )
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- 2) Aging: PENDING_REVIEW deadlines older than 30 days become frozen history.
CREATE OR REPLACE FUNCTION public.age_out_pending_review_deadlines()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count INTEGER;
BEGIN
  WITH aged AS (
    UPDATE public.work_item_deadlines
    SET status = 'HISTORICAL_BACKFILL',
        calculation_meta = COALESCE(calculation_meta, '{}'::jsonb) || jsonb_build_object(
          'aged_out_at', now(),
          'aged_out_rule', 'PENDING_REVIEW_30D_AGING'
        )
    WHERE status = 'PENDING_REVIEW'
      AND deadline_date IS NOT NULL
      AND deadline_date < (CURRENT_DATE - INTERVAL '30 days')::date
    RETURNING 1
  )
  SELECT count(*)::INTEGER INTO v_count FROM aged;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.age_out_pending_review_deadlines() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.age_out_pending_review_deadlines() TO service_role;