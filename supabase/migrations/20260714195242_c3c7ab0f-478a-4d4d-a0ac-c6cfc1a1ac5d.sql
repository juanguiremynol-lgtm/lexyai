BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. AMPLIAR work_item_deadlines
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.work_item_deadlines
  DROP CONSTRAINT IF EXISTS work_item_deadlines_status_check;

ALTER TABLE public.work_item_deadlines
  ADD CONSTRAINT work_item_deadlines_status_check
  CHECK (status = ANY (ARRAY['PENDING','MET','MISSED','CANCELLED','REQUIERE_REVISION_MANUAL']));

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_item_deadlines_ident
  ON public.work_item_deadlines (work_item_id, deadline_type, trigger_date);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. providencia_classification_rules
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.providencia_classification_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  priority INT NOT NULL,
  pattern_regex TEXT NOT NULL,
  providencia_type TEXT NOT NULL,
  deadline_type TEXT,
  triggers_deadline BOOLEAN NOT NULL DEFAULT false,
  severity TEXT NOT NULL DEFAULT 'INFO',
  workflow_scope TEXT[],
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.providencia_classification_rules TO authenticated;
GRANT SELECT ON public.providencia_classification_rules TO anon;
GRANT ALL ON public.providencia_classification_rules TO service_role;

ALTER TABLE public.providencia_classification_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read classification rules" ON public.providencia_classification_rules;
CREATE POLICY "Anyone can read classification rules"
  ON public.providencia_classification_rules FOR SELECT USING (true);
DROP POLICY IF EXISTS "Only service role can modify classification rules" ON public.providencia_classification_rules;
CREATE POLICY "Only service role can modify classification rules"
  ON public.providencia_classification_rules FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_class_rules_priority
  ON public.providencia_classification_rules (priority) WHERE is_active = true;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. deadline_rules
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deadline_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_type TEXT NOT NULL,
  deadline_type TEXT NOT NULL,
  days_amount INT NOT NULL,
  day_type TEXT NOT NULL CHECK (day_type IN ('BUSINESS','CALENDAR','HOURS')),
  norma TEXT,
  description TEXT,
  requires_manual_review BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_type, deadline_type)
);

GRANT SELECT ON public.deadline_rules TO authenticated;
GRANT SELECT ON public.deadline_rules TO anon;
GRANT ALL ON public.deadline_rules TO service_role;

ALTER TABLE public.deadline_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read deadline rules" ON public.deadline_rules;
CREATE POLICY "Anyone can read deadline rules"
  ON public.deadline_rules FOR SELECT USING (true);
DROP POLICY IF EXISTS "Only service role can modify deadline rules" ON public.deadline_rules;
CREATE POLICY "Only service role can modify deadline rules"
  ON public.deadline_rules FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.set_updated_at_generic()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_class_rules_updated_at ON public.providencia_classification_rules;
CREATE TRIGGER trg_class_rules_updated_at BEFORE UPDATE ON public.providencia_classification_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_generic();
DROP TRIGGER IF EXISTS trg_deadline_rules_updated_at ON public.deadline_rules;
CREATE TRIGGER trg_deadline_rules_updated_at BEFORE UPDATE ON public.deadline_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_generic();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. FUNCIONES DE DÍAS HÁBILES
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_business_day_sql(p_date DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT extract(isodow from p_date) < 6
    AND NOT EXISTS (SELECT 1 FROM public.colombian_holidays WHERE holiday_date = p_date)
    AND NOT EXISTS (
      SELECT 1 FROM public.judicial_term_suspensions
      WHERE active = true
        AND p_date BETWEEN start_date AND end_date
        AND scope = 'GLOBAL_JUDICIAL'
    );
$$;

CREATE OR REPLACE FUNCTION public.add_business_days_sql(p_start DATE, p_days INT)
RETURNS DATE LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d DATE := p_start + 1; added INT := 0;
BEGIN
  IF p_days <= 0 THEN RETURN p_start; END IF;
  LOOP
    IF public.is_business_day_sql(d) THEN
      added := added + 1;
      EXIT WHEN added >= p_days;
    END IF;
    d := d + 1;
  END LOOP;
  RETURN d;
END; $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. CLASIFICADOR
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.classify_providencia(
  p_text TEXT, p_workflow TEXT DEFAULT NULL
) RETURNS TABLE(
  rule_id UUID, providencia_type TEXT, deadline_type TEXT,
  triggers_deadline BOOLEAN, severity TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT r.id, r.providencia_type, r.deadline_type, r.triggers_deadline, r.severity
  FROM public.providencia_classification_rules r
  WHERE r.is_active = true
    AND (r.workflow_scope IS NULL OR p_workflow IS NULL OR p_workflow = ANY(r.workflow_scope))
    AND UPPER(COALESCE(p_text, '')) ~ r.pattern_regex
  ORDER BY r.priority ASC
  LIMIT 1;
END; $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. COMPUTE DEADLINE FROM RULE
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_deadline_from_rule(
  p_anchor DATE, p_workflow TEXT, p_deadline_type TEXT
) RETURNS TABLE(
  rule_id UUID, deadline_date DATE, day_type TEXT, days_amount INT,
  norma TEXT, requires_manual_review BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.deadline_rules
    WHERE workflow_type = p_workflow AND deadline_type = p_deadline_type AND is_active = true
    LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF r.requires_manual_review THEN
    RETURN QUERY SELECT r.id, NULL::DATE, r.day_type, r.days_amount, r.norma, true;
    RETURN;
  END IF;

  IF r.day_type = 'BUSINESS' THEN
    RETURN QUERY SELECT r.id, public.add_business_days_sql(p_anchor, r.days_amount), r.day_type, r.days_amount, r.norma, false;
  ELSIF r.day_type = 'CALENDAR' THEN
    RETURN QUERY SELECT r.id, p_anchor + r.days_amount, r.day_type, r.days_amount, r.norma, false;
  ELSIF r.day_type = 'HOURS' THEN
    RETURN QUERY SELECT r.id, p_anchor + CEIL(r.days_amount::NUMERIC / 24)::INT, r.day_type, r.days_amount, r.norma, false;
  END IF;
END; $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. COMPUTE DEADLINE PARA PUBLICACIÓN  (castea workflow_type a TEXT)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_deadline_for_publicacion(p_pub_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pub RECORD; v_c RECORD; v_r RECORD; v_id UUID;
  v_workflow TEXT;
BEGIN
  SELECT p.id, p.work_item_id, p.title, p.annotation, p.fecha_fijacion, p.is_archived,
         w.workflow_type::TEXT AS wf, w.owner_id, w.organization_id
    INTO v_pub
    FROM public.work_item_publicaciones p
    JOIN public.work_items w ON w.id = p.work_item_id
    WHERE p.id = p_pub_id;

  IF NOT FOUND OR COALESCE(v_pub.is_archived, false) OR v_pub.fecha_fijacion IS NULL THEN
    RETURN NULL;
  END IF;

  v_workflow := v_pub.wf;

  SELECT * INTO v_c FROM public.classify_providencia(
    COALESCE(v_pub.annotation, v_pub.title, ''), v_workflow
  ) LIMIT 1;

  IF v_c.rule_id IS NULL OR NOT v_c.triggers_deadline OR v_c.deadline_type IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_r FROM public.compute_deadline_from_rule(
    v_pub.fecha_fijacion::DATE, v_workflow, v_c.deadline_type
  ) LIMIT 1;

  IF v_r.rule_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta
  ) VALUES (
    v_pub.owner_id, v_pub.organization_id, v_pub.work_item_id,
    v_c.deadline_type,
    v_c.providencia_type || ' → ' || v_c.deadline_type,
    LEFT(COALESCE(v_pub.annotation, v_pub.title, ''), 500),
    'ESTADO_NUEVO',
    v_pub.fecha_fijacion::DATE,
    COALESCE(v_r.deadline_date, v_pub.fecha_fijacion::DATE),
    CASE WHEN v_r.day_type = 'BUSINESS' THEN v_r.days_amount END,
    CASE WHEN v_r.requires_manual_review THEN 'REQUIERE_REVISION_MANUAL' ELSE 'PENDING' END,
    jsonb_build_object(
      'anchor_source', 'FECHA_FIJACION',
      'anchor_date', v_pub.fecha_fijacion,
      'rule_id', v_r.rule_id,
      'classification_rule_id', v_c.rule_id,
      'providencia_type', v_c.providencia_type,
      'workflow_type', v_workflow,
      'day_type', v_r.day_type,
      'days_amount', v_r.days_amount,
      'norma', v_r.norma,
      'pub_id', v_pub.id,
      'requires_manual_review', v_r.requires_manual_review
    )
  )
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END; $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. COMPUTE DEADLINE PARA ACTUACIÓN (override despacho)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_deadline_for_actuacion(p_act_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  v_workflow := v_act.wf;

  BEGIN
    v_fecha_inicial := (COALESCE(v_act.raw_data->>'fechaInicial', v_act.raw_data->>'fecha_inicial'))::DATE;
    v_fecha_final   := (COALESCE(v_act.raw_data->>'fechaFinal',   v_act.raw_data->>'fecha_final'))::DATE;
  EXCEPTION WHEN OTHERS THEN
    v_fecha_inicial := NULL; v_fecha_final := NULL;
  END;

  IF v_fecha_inicial IS NULL OR v_fecha_final IS NULL THEN RETURN NULL; END IF;

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
END; $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. TRIGGERS
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_compute_deadline_on_pub()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.fecha_fijacion IS NOT NULL AND COALESCE(NEW.is_archived, false) = false THEN
    PERFORM public.compute_deadline_for_publicacion(NEW.id);
  ELSIF TG_OP = 'UPDATE'
    AND OLD.fecha_fijacion IS NULL AND NEW.fecha_fijacion IS NOT NULL
    AND COALESCE(NEW.is_archived, false) = false THEN
    PERFORM public.compute_deadline_for_publicacion(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[TRIGGER_SAFE] trg_compute_deadline_on_pub failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_pub_compute_deadline ON public.work_item_publicaciones;
CREATE TRIGGER trg_pub_compute_deadline
  AFTER INSERT OR UPDATE OF fecha_fijacion ON public.work_item_publicaciones
  FOR EACH ROW EXECUTE FUNCTION public.trg_compute_deadline_on_pub();

CREATE OR REPLACE FUNCTION public.trg_compute_deadline_on_act()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE')
     AND COALESCE(NEW.is_archived, false) = false
     AND NEW.raw_data IS NOT NULL
     AND (NEW.raw_data ? 'fechaInicial' OR NEW.raw_data ? 'fecha_inicial') THEN
    PERFORM public.compute_deadline_for_actuacion(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[TRIGGER_SAFE] trg_compute_deadline_on_act failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_act_compute_deadline ON public.work_item_acts;
CREATE TRIGGER trg_act_compute_deadline
  AFTER INSERT OR UPDATE OF raw_data ON public.work_item_acts
  FOR EACH ROW EXECUTE FUNCTION public.trg_compute_deadline_on_act();

-- ────────────────────────────────────────────────────────────────────────────
-- 10. MODIFICAR handle_publicacion_notifiability
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_publicacion_notifiability()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_work_item RECORD;
  v_severity TEXT;
  v_portal TEXT;
  v_pending_fixing BOOLEAN;
BEGIN
  BEGIN
    SELECT created_at, pubs_initial_sync_completed_at, owner_id, organization_id,
           radicado, demandantes, demandados, authority_name
      INTO v_work_item
      FROM public.work_items WHERE id = NEW.work_item_id;

    v_portal := public.normalize_alert_source(NEW.source);
    v_pending_fixing := (NEW.fecha_fijacion IS NULL);

    IF TG_OP = 'INSERT' THEN
      IF v_work_item.pubs_initial_sync_completed_at IS NULL THEN
        NEW.is_notifiable := false;
        RETURN NEW;
      END IF;

      IF NEW.fecha_fijacion IS NOT NULL
         AND NEW.fecha_fijacion::date < v_work_item.created_at::date THEN
        NEW.is_notifiable := false;
        RETURN NEW;
      END IF;

      NEW.is_notifiable := true;

      v_severity := CASE
        WHEN v_pending_fixing THEN 'INFO'
        WHEN UPPER(COALESCE(NEW.tipo_publicacion, '')) LIKE '%EDICTO%' THEN 'WARNING'
        WHEN UPPER(COALESCE(NEW.title, '')) LIKE '%SENTENCIA%' THEN 'CRITICAL'
        ELSE 'INFO'
      END;

      BEGIN
        INSERT INTO public.alert_instances (
          owner_id, organization_id, entity_id, entity_type,
          severity, alert_type, alert_source, title, message, status, fingerprint, payload
        ) VALUES (
          v_work_item.owner_id, v_work_item.organization_id,
          NEW.work_item_id, 'WORK_ITEM',
          v_severity, 'ESTADO_NUEVO', v_portal,
          CASE WHEN v_pending_fixing
               THEN 'Nuevo estado (pendiente de fijación)'
               ELSE 'Nuevo estado detectado' END,
          LEFT(NEW.title, 200), 'PENDING',
          'pub_new_' || NEW.id,
          jsonb_build_object(
            'radicado', v_work_item.radicado, 'portal', v_portal,
            'despacho', v_work_item.authority_name,
            'demandante', v_work_item.demandantes, 'demandado', v_work_item.demandados,
            'tipo_actuacion', NEW.tipo_publicacion,
            'fecha_auto', NEW.fecha_fijacion,
            'pub_id', NEW.id, 'fecha_fijacion', NEW.fecha_fijacion,
            'pending_fijacion', v_pending_fixing,
            'source', NEW.source, 'detected_at', NEW.detected_at
          )
        ) ON CONFLICT (fingerprint) DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[TRIGGER_SAFE] % alert insert failed: % (SQLSTATE: %)', TG_NAME, SQLERRM, SQLSTATE;
      END;

    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.content_hash IS DISTINCT FROM NEW.content_hash AND NEW.changed_at IS NOT NULL THEN
        IF v_work_item.pubs_initial_sync_completed_at IS NULL THEN RETURN NEW; END IF;
        IF NEW.fecha_fijacion IS NOT NULL AND NEW.fecha_fijacion::date >= v_work_item.created_at::date THEN
          BEGIN
            INSERT INTO public.alert_instances (
              owner_id, organization_id, entity_id, entity_type,
              severity, alert_type, alert_source, title, message, status, fingerprint, payload
            ) VALUES (
              v_work_item.owner_id, v_work_item.organization_id,
              NEW.work_item_id, 'WORK_ITEM',
              'INFO', 'ESTADO_MODIFIED', v_portal,
              'Estado modificado',
              'Cambio detectado: ' || LEFT(NEW.title, 150),
              'PENDING',
              'pub_mod_' || NEW.id || '_' || extract(epoch from NEW.changed_at)::TEXT,
              jsonb_build_object(
                'radicado', v_work_item.radicado, 'portal', v_portal,
                'despacho', v_work_item.authority_name,
                'demandante', v_work_item.demandantes, 'demandado', v_work_item.demandados,
                'tipo_actuacion', NEW.tipo_publicacion,
                'fecha_auto', NEW.fecha_fijacion,
                'pub_id', NEW.id, 'fecha_fijacion', NEW.fecha_fijacion,
                'source', NEW.source, 'changed_at', NEW.changed_at
              )
            ) ON CONFLICT (fingerprint) DO NOTHING;
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '[TRIGGER_SAFE] % alert_mod insert failed: % (SQLSTATE: %)', TG_NAME, SQLERRM, SQLSTATE;
          END;
        END IF;
      END IF;
    END IF;

    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[TRIGGER_SAFE] % on % failed: % (SQLSTATE: %)', TG_NAME, TG_TABLE_NAME, SQLERRM, SQLSTATE;
    RETURN NEW;
  END;
END; $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. SEMILLA — classification rules
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.providencia_classification_rules
  (priority, pattern_regex, providencia_type, deadline_type, triggers_deadline, severity, workflow_scope, description)
VALUES
  (10,  'AUTO.*RECHAZA|RECHAZA.*(DEMANDA|SOLICITUD)',           'AUTO_RECHAZA',           'RECURSO_APELACION_AUTO',    true,  'CRITICAL', NULL, 'Auto que rechaza la demanda'),
  (20,  'AUTO.*INADMITE|INADMITE',                              'AUTO_INADMITE',          'SUBSANACION',               true,  'WARNING',  NULL, 'Auto inadmisorio → subsanación'),
  (30,  'AUTO.*ADMISORIO|ADMITE (LA )?DEMANDA|AUTO.*QUE.*ADMITE|ADMISORIO', 'AUTO_ADMISORIO','CONTESTACION_DEMANDA',  true,  'WARNING',  NULL, 'Auto admisorio → contestación'),
  (40,  'SENTENCIA|FALLO',                                      'SENTENCIA',              'RECURSO_APELACION_SENTENCIA', true,'CRITICAL', NULL, 'Sentencia / fallo → recurso'),
  (50,  'ORDENA.*REQUERIR|AUTO.*REQUERIR|REQUERIMIENTO',        'AUTO_REQUERIMIENTO',     'RESPUESTA_REQUERIMIENTO',   true,  'WARNING',  NULL, 'Requerimiento del despacho'),
  (55,  'TRASLADO|CORRE.*TRASLADO',                             'TRASLADO',               'TRASLADO_DEMANDA',          true,  'WARNING',  NULL, 'Traslado'),
  (60,  'OBED[EÉ]ZCASE|C[UÚ]MPLASE',                            'OBEDEZCASE_Y_CUMPLASE',  NULL,                        false, 'INFO',     NULL, 'Obedézcase y cúmplase — informativo'),
  (65,  'CONSTANCIA.*SECRETARIA|SECRETARI[AO].*CONSTANCIA|CONSTANCIA SECRETARIAL', 'CONSTANCIA_SECRETARIAL', NULL,   false, 'LOW',      NULL, 'Constancia secretarial'),
  (70,  'RESUELVE.*REPOSICI[OÓ]N|AUTO.*REPOSICI[OÓ]N',          'AUTO_RESUELVE_REPOSICION', 'RECURSO_APELACION_AUTO', true,  'WARNING',  NULL, 'Resuelve reposición'),
  (75,  'AUDIENCIA|SEÑALA.*FECHA|FIJA.*FECHA',                  'AUDIENCIA',              'PREPARACION_AUDIENCIA',     true,  'WARNING',  NULL, 'Audiencia programada'),
  (80,  'EXCEPCION',                                            'EXCEPCIONES',            'EXCEPCIONES_EJECUTIVO',     true,  'WARNING',  ARRAY['CGP'], 'Excepciones (ejecutivo CGP)'),
  (85,  'NOTIFICACI[OÓ]N|NOTIFICA',                             'NOTIFICACION',           'RESPUESTA_NOTIFICACION',    true,  'INFO',     NULL, 'Notificación'),
  (90,  'AUTO.*INTERLOCUTORIO',                                 'AUTO_INTERLOCUTORIO',    'RECURSO_REPOSICION',        true,  'INFO',     NULL, 'Auto interlocutorio'),
  (999, '.*',                                                   'ESTADO_GENERAL',         NULL,                        false, 'INFO',     NULL, 'Fallback')
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 12. SEMILLA — deadline_rules (matriz ratificada)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.deadline_rules
  (workflow_type, deadline_type, days_amount, day_type, norma, description, requires_manual_review)
VALUES
  ('CGP', 'RECURSO_REPOSICION',           3,  'BUSINESS', 'CGP Art. 318', 'Reposición contra auto', false),
  ('CGP', 'RECURSO_APELACION_AUTO',       3,  'BUSINESS', 'CGP Art. 322', 'Apelación de auto', false),
  ('CGP', 'RECURSO_APELACION_SENTENCIA',  3,  'BUSINESS', 'CGP Art. 322', 'Apelación de sentencia (por estado)', false),
  ('CGP', 'SUBSANACION',                  5,  'BUSINESS', 'CGP Art. 90',  'Subsanación', false),
  ('CGP', 'EXCEPCIONES_EJECUTIVO',        10, 'BUSINESS', 'CGP Art. 442', 'Excepciones ejecutivo', false),
  ('CGP', 'CONTESTACION_DEMANDA',         20, 'BUSINESS', 'CGP Art. 369', 'Contestación verbal (verificar verbal sumario: 10)', false),
  ('CGP', 'TRASLADO_DEMANDA',             20, 'BUSINESS', 'CGP Art. 369', 'Traslado demanda (verbal)', false),
  ('CGP', 'RESPUESTA_REQUERIMIENTO',      3,  'BUSINESS', 'CGP',          'Respuesta a requerimiento', false),
  ('CPACA', 'RECURSO_REPOSICION',          3,  'BUSINESS', 'CPACA Art. 242', 'Reposición', false),
  ('CPACA', 'RECURSO_SUPLICA',             3,  'BUSINESS', 'CPACA Art. 246', 'Súplica', false),
  ('CPACA', 'RECURSO_APELACION_AUTO',      3,  'BUSINESS', 'CPACA Art. 244', 'Apelación de auto', false),
  ('CPACA', 'RECURSO_APELACION_SENTENCIA', 10, 'BUSINESS', 'CPACA Art. 247', 'Apelación de sentencia', false),
  ('CPACA', 'SUBSANACION',                 10, 'BUSINESS', 'CPACA Art. 170', 'Subsanación', false),
  ('CPACA', 'TRASLADO_DEMANDA',            30, 'BUSINESS', 'CPACA Art. 172', 'Traslado de la demanda', false),
  ('CPACA', 'RESPUESTA_REQUERIMIENTO',     3,  'BUSINESS', 'CPACA',          'Respuesta a requerimiento', false),
  ('TUTELA', 'IMPUGNACION_TUTELA',         3,  'BUSINESS', 'Dcto 2591/91 Art. 31', 'Impugnación', false),
  ('TUTELA', 'FALLO_TUTELA_INSTANCIA',     10, 'CALENDAR', 'Dcto 2591/91 Art. 29', 'Fallo primera instancia', false),
  ('TUTELA', 'CUMPLIMIENTO_TUTELA',        48, 'HOURS',    'Dcto 2591/91 Art. 27', 'Cumplimiento del fallo', false),
  ('TUTELA', 'RECURSO_APELACION_SENTENCIA', 3, 'BUSINESS', 'Dcto 2591/91 Art. 31', 'Impugnación (alias)', false),
  ('PENAL_906', 'RECURSO_REPOSICION',          0, 'BUSINESS', 'CPP 906', 'Recursos orales en audiencia — sin término automatizado', true),
  ('PENAL_906', 'RECURSO_APELACION_AUTO',      0, 'BUSINESS', 'CPP 906', 'Apelación oral', true),
  ('PENAL_906', 'RECURSO_APELACION_SENTENCIA', 0, 'BUSINESS', 'CPP 906', 'Apelación oral', true),
  ('LABORAL', 'RECURSO_REPOSICION',            0, 'BUSINESS', 'CPT — pendiente', 'Matriz laboral no ratificada', true),
  ('LABORAL', 'RECURSO_APELACION_AUTO',        0, 'BUSINESS', 'CPT — pendiente', 'Matriz laboral no ratificada', true),
  ('LABORAL', 'RECURSO_APELACION_SENTENCIA',   0, 'BUSINESS', 'CPT — pendiente', 'Matriz laboral no ratificada', true),
  ('LABORAL', 'CONTESTACION_DEMANDA',          0, 'BUSINESS', 'CPT — pendiente', 'Matriz laboral no ratificada', true),
  ('LABORAL', 'SUBSANACION',                   0, 'BUSINESS', 'CPT — pendiente', 'Matriz laboral no ratificada', true)
ON CONFLICT (workflow_type, deadline_type) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 13. BACKFILL — evita disparar notificaciones espurias
-- ────────────────────────────────────────────────────────────────────────────
SET LOCAL session_replication_role = 'replica';

-- 13.a Retro-alerta las publicaciones vivas SIN fecha_fijacion (idempotente)
INSERT INTO public.alert_instances (
  owner_id, organization_id, entity_id, entity_type,
  severity, alert_type, alert_source, title, message, status, fingerprint, payload
)
SELECT
  w.owner_id, w.organization_id, p.work_item_id, 'WORK_ITEM',
  'INFO', 'ESTADO_NUEVO', public.normalize_alert_source(p.source),
  'Nuevo estado (pendiente de fijación)',
  LEFT(COALESCE(p.title, 'Estado sin título'), 200),
  'PENDING',
  'pub_new_' || p.id,
  jsonb_build_object(
    'radicado', w.radicado, 'despacho', w.authority_name,
    'demandante', w.demandantes, 'demandado', w.demandados,
    'tipo_actuacion', p.tipo_publicacion,
    'pub_id', p.id,
    'fecha_fijacion', NULL,
    'pending_fijacion', true,
    'source', p.source,
    'detected_at', p.detected_at,
    'backfill', true
  )
FROM public.work_item_publicaciones p
JOIN public.work_items w ON w.id = p.work_item_id
WHERE p.is_archived = false
  AND p.fecha_fijacion IS NULL
  AND w.pubs_initial_sync_completed_at IS NOT NULL
ON CONFLICT (fingerprint) DO NOTHING;

-- 13.b Computa deadlines para publicaciones vivas con fecha_fijacion
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.id FROM public.work_item_publicaciones p
    JOIN public.work_items w ON w.id = p.work_item_id
    WHERE p.is_archived = false AND p.fecha_fijacion IS NOT NULL
      AND p.fecha_fijacion::date >= w.created_at::date
  LOOP
    PERFORM public.compute_deadline_for_publicacion(r.id);
  END LOOP;
END $$;

-- 13.c Computa deadlines para actuaciones con fechaInicial/fechaFinal del despacho
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT a.id FROM public.work_item_acts a
    WHERE a.is_archived = false
      AND a.raw_data IS NOT NULL
      AND (a.raw_data ? 'fechaInicial' OR a.raw_data ? 'fecha_inicial')
      AND (a.raw_data ? 'fechaFinal' OR a.raw_data ? 'fecha_final')
  LOOP
    PERFORM public.compute_deadline_for_actuacion(r.id);
  END LOOP;
END $$;

RESET session_replication_role;

COMMIT;
