-- 1) Allow date-less deadlines (visible but not computable)
ALTER TABLE public.work_item_deadlines ALTER COLUMN deadline_date DROP NOT NULL;

-- 2) Anchor resolution + never-silent fallback
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

  -- Case A: authoritative court-supplied window
  IF v_fecha_inicial IS NOT NULL AND v_fecha_final IS NOT NULL AND v_fecha_final > v_fecha_inicial THEN
    v_anchor_source := 'DESPACHO';
    v_business_days := NULL;
    v_status := 'PENDING';
  ELSE
    -- From here on we only act on providencias that legally trigger a term
    IF v_c.rule_id IS NULL OR NOT COALESCE(v_c.triggers_deadline, false) OR v_c.deadline_type IS NULL THEN
      RETURN NULL;
    END IF;

    -- Anchor B: court start date only
    IF v_fecha_inicial IS NULL THEN
      -- Anchor C: sibling CPNU 'Fijacion Estado' act within 5 days of the providencia
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
        -- Anchor D: publicación (PP / SAMAI_ESTADOS) with fecha_fijacion
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
        END IF;
      END IF;
    ELSE
      v_anchor_source := 'DESPACHO_HIBRIDO';
    END IF;

    IF v_fecha_inicial IS NULL THEN
      -- No anchor at all: never stay silent, surface for manual verification.
      v_anchor_source := 'SIN_ANCLA_DISPONIBLE';
      v_status := 'REQUIERE_REVISION_MANUAL';
      v_fecha_final := NULL;
      v_business_days := NULL;
      v_fecha_inicial := v_act.act_date;
    ELSE
      SELECT * INTO v_r FROM public.compute_deadline_from_rule(
        v_fecha_inicial, v_workflow, v_c.deadline_type) LIMIT 1;

      IF v_r.rule_id IS NULL OR v_r.deadline_date IS NULL OR v_r.deadline_date <= v_fecha_inicial THEN
        -- Anchor known but the normative matrix cannot yield a certain date.
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

  IF v_status = 'REQUIERE_REVISION_MANUAL' THEN
    v_meta := v_meta || jsonb_build_object(
      'requires_manual_review', true,
      'manual_review_reason',
        CASE WHEN v_anchor_source = 'SIN_ANCLA_DISPONIBLE'
             THEN 'Providencia con efecto de término sin fecha de fijación confirmada (ni despacho, ni Fijación Estado CPNU, ni publicación). El término legal puede estar corriendo.'
             ELSE 'Ancla identificada pero la matriz normativa no permite calcular una fecha cierta para este tipo de proceso.' END
    );
  END IF;

  IF v_r.rule_id IS NOT NULL THEN
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

-- 3) Prevention: evaluate EVERY act, not just the ones carrying court dates
CREATE OR REPLACE FUNCTION public.trg_compute_deadline_on_act()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.is_archived, false) = false THEN
    PERFORM public.compute_deadline_for_actuacion(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[TRIGGER_SAFE] trg_compute_deadline_on_act failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_act_compute_deadline ON public.work_item_acts;
DROP TRIGGER IF EXISTS trg_compute_deadline_on_act ON public.work_item_acts;
CREATE TRIGGER trg_compute_deadline_on_act
  AFTER INSERT OR UPDATE OF raw_data, description, act_date, is_archived
  ON public.work_item_acts
  FOR EACH ROW EXECUTE FUNCTION public.trg_compute_deadline_on_act();
