
-- Annulled-act guards: SAMAI ingests annulled acts as-is (marked in raw_data.is_annulled)
-- so the expediente stays complete. Downstream, they must never fire alerts nor
-- compute deadlines. Both guards are DEFENSIVE — the natural detectors already
-- avoid most cases, but the marker makes it explicit and future-proof.

-- 1) Notifiability guard: force is_notifiable=false when annulled.
CREATE OR REPLACE FUNCTION public.handle_actuacion_notifiability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_work_item RECORD;
  v_severity text;
  v_alert_type text;
  v_is_annulled boolean;
BEGIN
  BEGIN
    SELECT created_at, acts_initial_sync_completed_at, owner_id, organization_id
      INTO v_work_item
      FROM work_items WHERE id = NEW.work_item_id;

    v_is_annulled := COALESCE((NEW.raw_data->>'is_annulled')::boolean, false)
                     OR UPPER(COALESCE(NEW.raw_data->>'estado', '')) = 'ANULADA';

    IF TG_OP = 'INSERT' THEN
      IF v_work_item.acts_initial_sync_completed_at IS NULL OR v_is_annulled THEN
        NEW.is_notifiable := false;
        RETURN NEW;
      END IF;

      NEW.is_notifiable := (
        NEW.act_date IS NOT NULL
        AND NEW.act_date >= v_work_item.created_at::date
      );

      IF NEW.is_notifiable THEN
        v_severity := CASE
          WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%SENTENCIA%' THEN 'CRITICAL'
          WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%AUTO ADMISORIO%' THEN 'WARNING'
          WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%AUDIENCIA%' THEN 'WARNING'
          WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%RECHAZA%' THEN 'CRITICAL'
          WHEN UPPER(COALESCE(NEW.description, '')) LIKE '%INADMITE%' THEN 'WARNING'
          ELSE 'INFO'
        END;

        BEGIN
          INSERT INTO alert_instances (
            owner_id, organization_id, entity_id, entity_type,
            severity, alert_type, title, message, status, fingerprint, payload
          ) VALUES (
            v_work_item.owner_id, v_work_item.organization_id, NEW.work_item_id, 'work_item',
            v_severity, 'ACTUACION_NEW',
            LEFT(COALESCE(NEW.description, 'Nueva actuación'), 200),
            LEFT(COALESCE(NEW.description, ''), 500),
            'ACTIVE',
            'act:' || NEW.id::text,
            jsonb_build_object('act_id', NEW.id, 'act_date', NEW.act_date, 'source', NEW.source)
          )
          ON CONFLICT (fingerprint) DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[handle_actuacion_notifiability] alert insert failed: %', SQLERRM;
        END;
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF v_is_annulled THEN
        NEW.is_notifiable := false;
      END IF;
    END IF;

    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[TRIGGER_SAFE] handle_actuacion_notifiability failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
    RETURN NEW;
  END;
END;
$$;

-- 2) Deadline guard: skip annulled acts entirely so their (spurious) term
--    fields never enter the deadline table.
CREATE OR REPLACE FUNCTION public.compute_deadline_for_actuacion(p_act_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_act RECORD; v_c RECORD;
  v_fecha_inicial DATE; v_fecha_final DATE; v_id UUID;
  v_workflow TEXT;
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

  IF v_fecha_inicial IS NULL OR v_fecha_final IS NULL THEN RETURN NULL; END IF;
  IF v_fecha_inicial <= DATE '1990-01-01' OR v_fecha_final <= DATE '1990-01-01' THEN
    RETURN NULL;
  END IF;
  IF v_fecha_final < v_fecha_inicial THEN RETURN NULL; END IF;

  SELECT * INTO v_c FROM public.classify_providencia(
    COALESCE(v_act.description, ''), v_workflow
  ) LIMIT 1;

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, status, calculation_meta
  ) VALUES (
    v_act.owner_id, v_act.organization_id, v_act.work_item_id,
    COALESCE(v_c.deadline_type, 'DESPACHO_AUTORITATIVO'),
    COALESCE(v_c.providencia_type, 'Actuación con término del despacho'),
    LEFT(COALESCE(v_act.description, ''), 500),
    'ACTUACION_DESPACHO',
    v_fecha_inicial,
    v_fecha_final,
    'PENDING',
    jsonb_build_object(
      'anchor_source', 'DESPACHO',
      'anchor_date', v_fecha_inicial,
      'fecha_final_despacho', v_fecha_final,
      'act_id', v_act.id,
      'workflow_type', v_workflow,
      'providencia_type', v_c.providencia_type,
      'classification_rule_id', v_c.rule_id
    )
  )
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END; $function$;
