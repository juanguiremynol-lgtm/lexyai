
CREATE OR REPLACE FUNCTION public.deadline_anchor_kind(p_anchor_source text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p_anchor_source IN ('FECHA_FIJACION','CPNU_FIJACION_ESTADO','PUBLICACION_FIJACION','ESTADO_NUEVO') THEN 'FIJACION_ESTADO'
    WHEN p_anchor_source IN ('ANCHOR_NOTIFICACION','ANCHOR_NOTIFICACION_TIC','NOTIFICACION_MANDAMIENTO_PAGO') THEN 'NOTIFICACION'
    WHEN p_anchor_source = 'ANCHOR_EJECUTORIA' THEN 'EJECUTORIA'
    WHEN p_anchor_source IN ('ANCHOR_AUDIENCIA','ANCHOR_ORAL_EN_AUDIENCIA','PROVIDER_HEARING_TEXT') THEN 'AUDIENCIA'
    WHEN p_anchor_source IN ('DESPACHO','DESPACHO_HIBRIDO','ACTUACION_DESPACHO') THEN 'TERMINO_DEL_DESPACHO'
    WHEN p_anchor_source IN ('ANCHOR_ACTO','PROVIDER_ACTUACION') THEN 'AUTO'
    WHEN p_anchor_source = 'SIN_ANCLA_DISPONIBLE' THEN 'SIN_ANCLA'
    ELSE COALESCE(p_anchor_source,'DESCONOCIDO')
  END;
$$;

CREATE OR REPLACE FUNCTION public.deadline_business_day_walk(p_anchor date, p_days integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  d date; counted int := 0; guard int := 0;
  v_walk jsonb := '[]'::jsonb; v_holidays jsonb := '[]'::jsonb; v_susp jsonb := '[]'::jsonb;
  v_weekends int := 0; v_hname text; v_stitle text; v_reason text; v_counts boolean;
BEGIN
  IF p_anchor IS NULL OR p_days IS NULL OR p_days <= 0 THEN RETURN NULL; END IF;
  d := p_anchor + 1;
  LOOP
    guard := guard + 1; EXIT WHEN guard > 400;
    v_hname := NULL; v_stitle := NULL; v_counts := true; v_reason := NULL;
    IF extract(isodow FROM d) >= 6 THEN
      v_counts := false; v_reason := 'FIN_DE_SEMANA'; v_weekends := v_weekends + 1;
    ELSE
      SELECT h.name INTO v_hname FROM public.colombian_holidays h WHERE h.holiday_date = d LIMIT 1;
      IF v_hname IS NOT NULL THEN
        v_counts := false; v_reason := 'FESTIVO';
        v_holidays := v_holidays || jsonb_build_object('date', d, 'name', v_hname);
      ELSE
        SELECT s.title INTO v_stitle FROM public.judicial_term_suspensions s
          WHERE s.active = true AND s.scope = 'GLOBAL_JUDICIAL' AND d BETWEEN s.start_date AND s.end_date LIMIT 1;
        IF v_stitle IS NOT NULL THEN
          v_counts := false; v_reason := 'VACANCIA_JUDICIAL';
          v_susp := v_susp || jsonb_build_object('date', d, 'title', v_stitle);
        END IF;
      END IF;
    END IF;
    IF v_counts THEN counted := counted + 1; END IF;
    v_walk := v_walk || jsonb_build_object('date', d, 'dow', to_char(d,'Dy'),
      'counted', v_counts, 'reason', COALESCE(v_reason,'DIA_HABIL'), 'running_count', counted);
    EXIT WHEN v_counts AND counted >= p_days;
    d := d + 1;
  END LOOP;
  RETURN jsonb_build_object(
    'anchor_date', p_anchor, 'counting_starts', p_anchor + 1,
    'business_days_required', p_days, 'business_days_counted', counted,
    'weekend_days_skipped', v_weekends, 'holidays_excluded', v_holidays,
    'vacancia_excluded', v_susp, 'calendar_walk', v_walk,
    'result_date', d, 'engine_version', 'DD1');
END; $$;

CREATE OR REPLACE FUNCTION public.build_term_audit(
  p_rule_anchor date, p_days integer, p_day_type text,
  p_anchor_source text, p_legal_source text, p_rule_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_walk jsonb;
BEGIN
  IF COALESCE(p_day_type,'BUSINESS') = 'BUSINESS' THEN
    v_walk := public.deadline_business_day_walk(p_rule_anchor, p_days);
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'anchor_kind', public.deadline_anchor_kind(p_anchor_source),
    'rule_anchor_date', p_rule_anchor,
    'legal_source', p_legal_source,
    'rule_kind', p_rule_kind,
    'holidays_excluded', COALESCE(v_walk->'holidays_excluded','[]'::jsonb),
    'vacancia_excluded', COALESCE(v_walk->'vacancia_excluded','[]'::jsonb),
    'term_audit', v_walk));
END; $$;

-- Universal stamp: every write path (publicación, actuación, ratified workflow
-- rules, provider hearings) gets the same auditable trail. Never alters
-- deadline_date, status or any procedural field.
CREATE OR REPLACE FUNCTION public.stamp_deadline_term_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_src text; v_daytype text; v_norma text; v_days int; v_anchor date; v_audit jsonb; v_kind text;
BEGIN
  v_src := COALESCE(NEW.calculation_meta->>'anchor_source', NEW.trigger_event);
  v_daytype := NEW.calculation_meta->>'day_type';
  v_norma := NEW.calculation_meta->>'norma';
  v_days := COALESCE((NEW.calculation_meta->>'days_amount')::int, NEW.business_days_count);
  v_kind := 'DEADLINE_RULES';

  IF v_days IS NULL THEN
    SELECT r.days_amount, r.day_type, r.citation, 'WORKFLOW_DEADLINE_RULES'
      INTO v_days, v_daytype, v_norma, v_kind
      FROM public.workflow_deadline_rules r
     WHERE r.deadline_type = NEW.deadline_type
       AND r.status = 'RATIFIED'
       AND (NEW.calculation_meta->>'workflow_type' IS NULL OR r.workflow_type = NEW.calculation_meta->>'workflow_type')
     LIMIT 1;
  END IF;
  IF v_days IS NULL THEN
    SELECT r.days_amount, r.day_type, r.norma, 'DEADLINE_RULES'
      INTO v_days, v_daytype, v_norma, v_kind
      FROM public.deadline_rules r
     WHERE r.deadline_type = NEW.deadline_type
       AND r.is_active
       AND (NEW.calculation_meta->>'workflow_type' IS NULL OR r.workflow_type = NEW.calculation_meta->>'workflow_type')
     LIMIT 1;
  END IF;

  v_anchor := COALESCE(
    NULLIF(NEW.calculation_meta->>'desfijacion_date','')::date,
    NULLIF(NEW.calculation_meta->>'rule_anchor_date','')::date,
    NULLIF(NEW.calculation_meta->>'anchor_date','')::date,
    NEW.trigger_date);

  IF v_days IS NOT NULL AND COALESCE(v_daytype,'BUSINESS') = 'BUSINESS' AND NEW.business_days_count IS NULL THEN
    NEW.business_days_count := v_days;
  END IF;

  v_audit := public.build_term_audit(v_anchor, v_days, v_daytype, v_src, v_norma, v_kind);
  IF v_daytype IS NOT NULL THEN
    v_audit := v_audit || jsonb_build_object('day_type', v_daytype);
  END IF;
  IF v_days IS NOT NULL THEN
    v_audit := v_audit || jsonb_build_object('days_amount', v_days);
  END IF;

  NEW.calculation_meta := COALESCE(NEW.calculation_meta,'{}'::jsonb) || v_audit || jsonb_build_object(
    'recomputed_date', NULLIF(v_audit->'term_audit'->>'result_date','')::date,
    'matches_stored_date', CASE
      WHEN v_audit->'term_audit'->>'result_date' IS NULL OR NEW.deadline_date IS NULL THEN NULL
      ELSE ((v_audit->'term_audit'->>'result_date')::date = NEW.deadline_date) END);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_stamp_deadline_term_audit ON public.work_item_deadlines;
CREATE TRIGGER trg_stamp_deadline_term_audit
BEFORE INSERT OR UPDATE OF deadline_date, trigger_date, calculation_meta, business_days_count
ON public.work_item_deadlines
FOR EACH ROW EXECUTE FUNCTION public.stamp_deadline_term_audit();

CREATE OR REPLACE FUNCTION public.backfill_deadline_audit_meta(p_status text DEFAULT NULL)
RETURNS TABLE(deadline_id uuid, deadline_type text, old_date date, recomputed_date date, differs boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d RECORD;
BEGIN
  FOR d IN SELECT id, deadline_date, work_item_deadlines.deadline_type dt
             FROM public.work_item_deadlines
            WHERE (p_status IS NULL OR status = p_status)
  LOOP
    -- Touch calculation_meta only; the BEFORE trigger stamps the audit trail.
    UPDATE public.work_item_deadlines
       SET calculation_meta = COALESCE(calculation_meta,'{}'::jsonb)
                              || jsonb_build_object('audit_backfilled_at', now())
     WHERE id = d.id;
    SELECT id, dt, deadline_date,
           NULLIF(calculation_meta->>'recomputed_date','')::date,
           CASE WHEN calculation_meta->>'recomputed_date' IS NULL OR deadline_date IS NULL THEN NULL
                ELSE (calculation_meta->>'recomputed_date')::date <> deadline_date END
      INTO deadline_id, deadline_type, old_date, recomputed_date, differs
      FROM public.work_item_deadlines WHERE id = d.id;
    RETURN NEXT;
  END LOOP;
END; $$;

GRANT EXECUTE ON FUNCTION public.deadline_anchor_kind(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deadline_business_day_walk(date, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.build_term_audit(date, integer, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_deadline_audit_meta(text) TO service_role;
