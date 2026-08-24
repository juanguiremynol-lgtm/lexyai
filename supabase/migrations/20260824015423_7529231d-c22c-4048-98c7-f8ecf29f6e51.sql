-- ============================================================ A.0
UPDATE public.deadline_rules
SET description = COALESCE(description, '') ||
  ' [Fase 4 / A.0] El valor de 1 día es inerte: requires_manual_review = true impide que esta regla genere un término calculado. NO convertir en término real: el plazo de la norma especial lo fija el usuario.'
WHERE workflow_type = 'PETICION'
  AND deadline_type = 'RESPUESTA_PETICION_NORMA_ESPECIAL'
  AND description NOT LIKE '%[Fase 4 / A.0]%';

-- ============================================================ A.2 mapping table
CREATE TABLE IF NOT EXISTS public.workflow_stage_code_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type text NOT NULL,
  old_code text NOT NULL,
  new_code text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_type, old_code)
);
GRANT SELECT ON public.workflow_stage_code_mappings TO authenticated;
GRANT SELECT ON public.workflow_stage_code_mappings TO anon;
GRANT ALL ON public.workflow_stage_code_mappings TO service_role;
ALTER TABLE public.workflow_stage_code_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stage code mappings readable" ON public.workflow_stage_code_mappings;
CREATE POLICY "stage code mappings readable"
  ON public.workflow_stage_code_mappings FOR SELECT USING (true);

DROP TRIGGER IF EXISTS trg_stage_code_mappings_updated_at ON public.workflow_stage_code_mappings;
CREATE TRIGGER trg_stage_code_mappings_updated_at
  BEFORE UPDATE ON public.workflow_stage_code_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================ A.2 rename
-- Guard is relaxed for the duration of the rename by doing the rename first.
UPDATE public.workflow_stages_global
  SET code = 'PENDIENTE_COMPLETACION_PETICIONARIO', updated_at = now()
  WHERE workflow_type = 'PETICION' AND code = 'AWAITING_PETITIONER_COMPLETION';

UPDATE public.workflow_stage_transitions
  SET from_stage_code = 'PENDIENTE_COMPLETACION_PETICIONARIO', updated_at = now()
  WHERE workflow_type = 'PETICION' AND from_stage_code = 'AWAITING_PETITIONER_COMPLETION';
UPDATE public.workflow_stage_transitions
  SET to_stage_code = 'PENDIENTE_COMPLETACION_PETICIONARIO', updated_at = now()
  WHERE workflow_type = 'PETICION' AND to_stage_code = 'AWAITING_PETITIONER_COMPLETION';

-- Live rows must keep pointing at a valid catalog code. Audit history is NOT rewritten.
UPDATE public.work_items
  SET stage = 'PENDIENTE_COMPLETACION_PETICIONARIO'
  WHERE workflow_type = 'PETICION'::workflow_type AND stage = 'AWAITING_PETITIONER_COMPLETION';

INSERT INTO public.workflow_stage_code_mappings (workflow_type, old_code, new_code, reason)
VALUES ('PETICION', 'AWAITING_PETITIONER_COMPLETION', 'PENDIENTE_COMPLETACION_PETICIONARIO',
        'Fase 4 / A.2 — consistencia idiomática: los códigos del catálogo son en español.')
ON CONFLICT (workflow_type, old_code) DO NOTHING;

-- ============================================================ A.2 guard (global + language)
CREATE OR REPLACE FUNCTION public.guard_workflow_stage_code_reserved_prefix()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_token text;
  v_english text[] := ARRAY[
    'AWAITING','PENDING','DRAFT','COMPLETION','REVIEW','CLOSED','OPEN','SENT',
    'RECEIVED','ANSWER','ANSWERED','FILED','FILING','STAGE','DEADLINE','WAITING',
    'REJECTED','APPROVED','SUBMITTED','EXPIRED','OVERDUE'
  ];
BEGIN
  IF NEW.code ~ '^(TERMINO_|ALERTA_)' THEN
    RAISE EXCEPTION 'RESERVED_STAGE_PREFIX: % collides with the alert taxonomy (TERMINO_*, ALERTA_*)', NEW.code;
  END IF;
  IF NEW.code !~ '^[A-Z0-9_]+$' THEN
    RAISE EXCEPTION 'INVALID_STAGE_CODE: % must be UPPER_SNAKE_CASE', NEW.code;
  END IF;
  FOREACH v_token IN ARRAY v_english LOOP
    IF v_token = ANY (string_to_array(NEW.code, '_')) THEN
      RAISE EXCEPTION 'ENGLISH_STAGE_CODE: % contains the English token % — catalog codes are Spanish', NEW.code, v_token;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

-- ============================================================ A.1 four new PETICION stages
INSERT INTO public.workflow_stages_global
  (workflow_type, code, label, display_order, is_terminal, is_procedurally_live, expected_next_event, legal_basis, is_system, active)
VALUES
  ('PETICION','RESPUESTA_NO_RECIBIDA_EN_TERMINO','Respuesta no recibida en término',35,false,true,
   'RESPUESTA_TARDIA_O_SILENCIO',
   'Ley 1755 de 2015, art. 14 — vencido el término sin respuesta se vulnera el derecho fundamental de petición y procede la acción de tutela (C. Const., jurisprudencia constante).',
   true,true),
  ('PETICION','PRORROGA_INFORMADA','Prórroga informada por la autoridad',45,false,true,
   'RESPUESTA_RECIBIDA',
   'Ley 1755 de 2015, art. 14 parágrafo — la autoridad debe informar la prórroga antes del vencimiento, expresando los motivos y el plazo, que no podrá exceder del doble del inicialmente previsto.',
   true,true),
  ('PETICION','SILENCIO_NEGATIVO_CONFIGURADO','Silencio administrativo negativo configurado',55,false,true,
   'RESPUESTA_TARDIA_O_ACCION_JUDICIAL',
   'Ley 1437 de 2011, art. 83 — transcurridos tres meses sin decisión se entiende negada la petición; existe acto ficto demandable. El silencio no exonera del deber de decidir.',
   true,true),
  ('PETICION','ARCHIVADA','Archivada por devolución no subsanada',120,true,false,
   NULL,
   'Ley 1755 de 2015, art. 19 — si el peticionario no corrige la petición incompleta o irrespetuosa dentro del término, se archiva.',
   true,true)
ON CONFLICT (workflow_type, code) DO NOTHING;

-- ============================================================ A.1 transitions
INSERT INTO public.workflow_stage_transitions
  (workflow_type, from_stage_code, to_stage_code, allowed_by_suggestion, requires_explicit_user_action, is_regression_allowed, legal_basis, notes, is_system, active)
VALUES
  ('PETICION','PENDIENTE_RESPUESTA','RESPUESTA_NO_RECIBIDA_EN_TERMINO', true,false,false,
   'Ley 1755 de 2015, art. 14','Hecho calculado por el sistema: vencimiento del término legal.',true,true),
  ('PETICION','PENDIENTE_RESPUESTA','SILENCIO_NEGATIVO_CONFIGURADO', true,false,false,
   'Ley 1437 de 2011, art. 83','Hecho calculado por el sistema: tres meses sin decisión.',true,true),
  ('PETICION','RESPUESTA_NO_RECIBIDA_EN_TERMINO','SILENCIO_NEGATIVO_CONFIGURADO', true,false,false,
   'Ley 1437 de 2011, art. 83',NULL,true,true),
  ('PETICION','RESPUESTA_NO_RECIBIDA_EN_TERMINO','RESPUESTA_PARCIAL', true,true,false,
   'Ley 1755 de 2015, art. 14','Respuesta tardía: la autoridad conserva el deber de decidir.',true,true),
  ('PETICION','RESPUESTA_NO_RECIBIDA_EN_TERMINO','RESPUESTA_DE_FONDO', false,true,false,
   'Ley 1755 de 2015, art. 14','Respuesta tardía de fondo.',true,true),
  ('PETICION','SILENCIO_NEGATIVO_CONFIGURADO','RESPUESTA_PARCIAL', true,true,false,
   'Ley 1437 de 2011, art. 83 inc. final','El silencio no exonera del deber de decidir: la respuesta tardía es posible.',true,true),
  ('PETICION','SILENCIO_NEGATIVO_CONFIGURADO','RESPUESTA_DE_FONDO', false,true,false,
   'Ley 1437 de 2011, art. 83 inc. final','El silencio no exonera del deber de decidir: la respuesta tardía es posible.',true,true),
  ('PETICION','RESPUESTA_NO_RECIBIDA_EN_TERMINO','DESISTIMIENTO_EXPRESO', false,true,false,
   'Ley 1755 de 2015, art. 18',NULL,true,true),
  ('PETICION','SILENCIO_NEGATIVO_CONFIGURADO','DESISTIMIENTO_EXPRESO', false,true,false,
   'Ley 1755 de 2015, art. 18',NULL,true,true),
  ('PETICION','PENDIENTE_RESPUESTA','PRORROGA_INFORMADA', true,true,false,
   'Ley 1755 de 2015, art. 14 parágrafo','Requiere validación del techo del doble y de la oportunidad de la comunicación.',true,true),
  ('PETICION','PRORROGA_INFORMADA','RESPUESTA_PARCIAL', true,true,false,
   'Ley 1755 de 2015, art. 14',NULL,true,true),
  ('PETICION','PRORROGA_INFORMADA','RESPUESTA_DE_FONDO', false,true,false,
   'Ley 1755 de 2015, art. 14',NULL,true,true),
  ('PETICION','PRORROGA_INFORMADA','RESPUESTA_NO_RECIBIDA_EN_TERMINO', true,false,false,
   'Ley 1755 de 2015, art. 14 parágrafo','Vencida la prórroga sin respuesta.',true,true),
  ('PETICION','DEVUELTA_PARA_ACLARACION','ARCHIVADA', false,true,false,
   'Ley 1755 de 2015, art. 19','Salida terminal por devolución no subsanada.',true,true)
ON CONFLICT DO NOTHING;

-- ============================================================ C.1 lifecycle band (catalog data)
ALTER TABLE public.workflow_stages_global
  ADD COLUMN IF NOT EXISTS lifecycle_band text;

ALTER TABLE public.workflow_stages_global
  DROP CONSTRAINT IF EXISTS workflow_stages_global_lifecycle_band_check;
ALTER TABLE public.workflow_stages_global
  ADD CONSTRAINT workflow_stages_global_lifecycle_band_check
  CHECK (lifecycle_band IS NULL OR lifecycle_band IN
    ('EN_PREPARACION','EN_CURSO','ESPERANDO_CONTRAPARTE','REQUIERE_ACCION_DESPACHO','CONCLUIDO'));

UPDATE public.workflow_stages_global g SET lifecycle_band = v.band
FROM (VALUES
  ('PETICION','BORRADOR','EN_PREPARACION'),
  ('PETICION','RADICADA','EN_CURSO'),
  ('PETICION','PENDIENTE_RESPUESTA','ESPERANDO_CONTRAPARTE'),
  ('PETICION','PENDIENTE_COMPLETACION_PETICIONARIO','REQUIERE_ACCION_DESPACHO'),
  ('PETICION','TRASLADO_POR_COMPETENCIA','ESPERANDO_CONTRAPARTE'),
  ('PETICION','PRORROGA_INFORMADA','ESPERANDO_CONTRAPARTE'),
  ('PETICION','RESPUESTA_NO_RECIBIDA_EN_TERMINO','REQUIERE_ACCION_DESPACHO'),
  ('PETICION','SILENCIO_NEGATIVO_CONFIGURADO','REQUIERE_ACCION_DESPACHO'),
  ('PETICION','RESPUESTA_PARCIAL','REQUIERE_ACCION_DESPACHO'),
  ('PETICION','DEVUELTA_PARA_ACLARACION','REQUIERE_ACCION_DESPACHO'),
  ('PETICION','RESPUESTA_DE_FONDO','CONCLUIDO'),
  ('PETICION','DESISTIMIENTO_DECRETADO','CONCLUIDO'),
  ('PETICION','DESISTIMIENTO_EXPRESO','CONCLUIDO'),
  ('PETICION','RECHAZADA','CONCLUIDO'),
  ('PETICION','ARCHIVADA','CONCLUIDO'),
  ('GOV_PROCEDURE','INDAGACION_PRELIMINAR','EN_PREPARACION'),
  ('GOV_PROCEDURE','MERITOS_COMUNICADOS','EN_CURSO'),
  ('GOV_PROCEDURE','CARGOS_FORMULADOS','EN_CURSO'),
  ('GOV_PROCEDURE','CARGOS_NOTIFICADOS','EN_CURSO'),
  ('GOV_PROCEDURE','EN_TERMINO_DESCARGOS','REQUIERE_ACCION_DESPACHO'),
  ('GOV_PROCEDURE','DESCARGOS_PRESENTADOS','ESPERANDO_CONTRAPARTE'),
  ('GOV_PROCEDURE','PRUEBAS_DECRETADAS','EN_CURSO'),
  ('GOV_PROCEDURE','PERIODO_PROBATORIO','REQUIERE_ACCION_DESPACHO'),
  ('GOV_PROCEDURE','TRASLADO_ALEGATOS','REQUIERE_ACCION_DESPACHO'),
  ('GOV_PROCEDURE','ALEGATOS_PRESENTADOS','ESPERANDO_CONTRAPARTE'),
  ('GOV_PROCEDURE','PENDIENTE_DECISION','ESPERANDO_CONTRAPARTE'),
  ('GOV_PROCEDURE','SANCION_IMPUESTA','REQUIERE_ACCION_DESPACHO'),
  ('GOV_PROCEDURE','EXONERACION_ARCHIVO','CONCLUIDO'),
  ('GOV_PROCEDURE','DECISION_NOTIFICADA','REQUIERE_ACCION_DESPACHO'),
  ('GOV_PROCEDURE','RECURSO_INTERPUESTO','ESPERANDO_CONTRAPARTE'),
  ('GOV_PROCEDURE','RECURSO_RESUELTO','REQUIERE_ACCION_DESPACHO'),
  ('GOV_PROCEDURE','SILENCIO_POSITIVO_RECURSO','CONCLUIDO'),
  ('GOV_PROCEDURE','ACTO_EN_FIRME','CONCLUIDO'),
  ('GOV_PROCEDURE','CADUCIDAD_FACULTAD_SANCIONATORIA','CONCLUIDO'),
  ('GOV_PROCEDURE','SUSPENDIDO','ESPERANDO_CONTRAPARTE')
) AS v(wf, code, band)
WHERE g.workflow_type = v.wf AND g.code = v.code;

-- B.1: expected_next_event was null for every GOV_PROCEDURE stage.
UPDATE public.workflow_stages_global g SET expected_next_event = v.ev
FROM (VALUES
  ('INDAGACION_PRELIMINAR','MERITOS_O_ARCHIVO'),
  ('MERITOS_COMUNICADOS','FORMULACION_CARGOS'),
  ('CARGOS_FORMULADOS','NOTIFICACION_CARGOS'),
  ('CARGOS_NOTIFICADOS','INICIO_TERMINO_DESCARGOS'),
  ('EN_TERMINO_DESCARGOS','PRESENTACION_DESCARGOS'),
  ('DESCARGOS_PRESENTADOS','DECRETO_PRUEBAS'),
  ('PRUEBAS_DECRETADAS','APERTURA_PERIODO_PROBATORIO'),
  ('PERIODO_PROBATORIO','CIERRE_PROBATORIO'),
  ('TRASLADO_ALEGATOS','PRESENTACION_ALEGATOS'),
  ('ALEGATOS_PRESENTADOS','DECISION_ADMINISTRATIVA'),
  ('PENDIENTE_DECISION','EXPEDICION_ACTO'),
  ('SANCION_IMPUESTA','NOTIFICACION_ACTO'),
  ('DECISION_NOTIFICADA','INTERPOSICION_RECURSOS_O_FIRMEZA'),
  ('RECURSO_INTERPUESTO','RESOLUCION_RECURSO'),
  ('RECURSO_RESUELTO','FIRMEZA_ACTO'),
  ('SUSPENDIDO','REANUDACION_TRAMITE')
) AS v(code, ev)
WHERE g.workflow_type = 'GOV_PROCEDURE' AND g.code = v.code AND g.expected_next_event IS NULL;

-- Catalog note recording the A.1(5) asymmetry.
COMMENT ON TABLE public.workflow_stages_global IS
  'Catálogo global de etapas procedimentales. ASIMETRÍA DELIBERADA (Fase 4 / A.1.5): SILENCIO_NEGATIVO_CONFIGURADO (PETICION) se aplica automáticamente porque el acto ficto se configura de pleno derecho por el mero transcurso del tiempo (Ley 1437 art. 83). CADUCIDAD_FACULTAD_SANCIONATORIA (GOV_PROCEDURE) NO se aplica automáticamente: la caducidad opera de pleno derecho pero se alega y se declara; un cron no puede declararla. No "armonizar" estos dos comportamientos.';

-- ============================================================ A.1(3) prórroga validation
CREATE OR REPLACE FUNCTION public.validate_prorroga_peticion(
  p_original_term_days integer,
  p_extended_term_days integer,
  p_communicated_on date,
  p_original_due_date date
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_defects text[] := ARRAY[]::text[];
BEGIN
  IF p_original_term_days IS NULL OR p_extended_term_days IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'defects', ARRAY['MISSING_TERM_VALUES'],
      'legal_basis', 'Ley 1755 de 2015, art. 14 parágrafo');
  END IF;
  IF p_extended_term_days > (p_original_term_days * 2) THEN
    v_defects := v_defects || 'EXCEDE_EL_DOBLE';
  END IF;
  IF p_communicated_on IS NULL THEN
    v_defects := v_defects || 'SIN_FECHA_DE_COMUNICACION';
  ELSIF p_original_due_date IS NOT NULL AND p_communicated_on >= p_original_due_date THEN
    v_defects := v_defects || 'COMUNICADA_FUERA_DE_TERMINO';
  END IF;
  RETURN jsonb_build_object(
    'valid', cardinality(v_defects) = 0,
    'defects', v_defects,
    'legal_basis', 'Ley 1755 de 2015, art. 14 parágrafo',
    'consequence', CASE WHEN cardinality(v_defects) = 0 THEN NULL
      ELSE 'Prórroga legalmente defectuosa: se marca como condición de atención (PRORROGA_DEFECTUOSA), no bloquea la etapa.' END
  );
END;
$$;

-- ============================================================ B.2 attention layer on alert_instances
ALTER TABLE public.alert_instances
  ADD COLUMN IF NOT EXISTS condition_class text NOT NULL DEFAULT 'NOTIFICATION',
  ADD COLUMN IF NOT EXISTS object_kind text,
  ADD COLUMN IF NOT EXISTS object_id uuid,
  ADD COLUMN IF NOT EXISTS resolution_mode text NOT NULL DEFAULT 'SNOOZABLE';

ALTER TABLE public.alert_instances DROP CONSTRAINT IF EXISTS alert_instances_condition_class_check;
ALTER TABLE public.alert_instances ADD CONSTRAINT alert_instances_condition_class_check
  CHECK (condition_class IN ('ATTENTION','NOTIFICATION'));
ALTER TABLE public.alert_instances DROP CONSTRAINT IF EXISTS alert_instances_resolution_mode_check;
ALTER TABLE public.alert_instances ADD CONSTRAINT alert_instances_resolution_mode_check
  CHECK (resolution_mode IN ('SNOOZABLE','AUTO_ON_CAUSE_CLEARED'));

CREATE INDEX IF NOT EXISTS idx_alert_instances_attention
  ON public.alert_instances (condition_class, object_kind, object_id)
  WHERE condition_class = 'ATTENTION';

-- Snoozing/dismissal is refused for conditions that must persist until resolved.
CREATE OR REPLACE FUNCTION public.guard_attention_resolution_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.resolution_mode = 'AUTO_ON_CAUSE_CLEARED' THEN
    IF (NEW.snoozed_until IS DISTINCT FROM OLD.snoozed_until AND NEW.snoozed_until IS NOT NULL)
       OR (NEW.dismissed_at IS DISTINCT FROM OLD.dismissed_at AND NEW.dismissed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'ATTENTION_NOT_DISMISSABLE: % se resuelve por desaparición de su causa, no por descarte', NEW.alert_type;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_attention_resolution_mode ON public.alert_instances;
CREATE TRIGGER trg_guard_attention_resolution_mode
  BEFORE UPDATE ON public.alert_instances
  FOR EACH ROW EXECUTE FUNCTION public.guard_attention_resolution_mode();

-- Legacy, empty.
DROP TABLE IF EXISTS public.peticion_alerts;

-- ============================================================ B.2 generalized attention view
DROP VIEW IF EXISTS public.v_gov_procedure_expired_background_timers;

CREATE OR REPLACE VIEW public.v_work_item_attention_conditions
WITH (security_invoker = on) AS
-- 1. Deadlines: overdue or approaching
SELECT
  wi.id                              AS work_item_id,
  wi.organization_id,
  wi.owner_id,
  wi.workflow_type::text             AS workflow_type,
  wi.stage                           AS stage_code,
  CASE WHEN d.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date
       THEN 'TERMINO_VENCIDO' ELSE 'TERMINO_POR_VENCER' END AS condition_type,
  CASE WHEN d.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date
       THEN 'CRITICAL' ELSE 'WARNING' END AS severity,
  'work_item_deadlines'              AS raised_by,
  'DEADLINE'                         AS object_kind,
  d.id                               AS object_id,
  d.updated_at                       AS raised_at,
  'SNOOZABLE'                        AS resolution_mode,
  d.deadline_date                    AS reference_date,
  d.label                            AS detail
FROM public.work_item_deadlines d
JOIN public.work_items wi ON wi.id = d.work_item_id
WHERE wi.deleted_at IS NULL
  AND wi.lifecycle_state = 'ACTIVE'::public.work_item_lifecycle_state
  AND d.status IN ('PENDING','PENDING_REVIEW')
  AND d.deadline_date IS NOT NULL
  AND d.deadline_date <= ((now() AT TIME ZONE 'America/Bogota')::date + 5)

UNION ALL
-- 2. Expired background timers (generalizes v_gov_procedure_expired_background_timers)
SELECT
  wi.id, wi.organization_id, wi.owner_id, wi.workflow_type::text, wi.stage,
  'TEMPORIZADOR_DE_FONDO_VENCIDO',
  'CRITICAL',
  'background_timers',
  'TIMER',
  d.id,
  d.updated_at,
  'AUTO_ON_CAUSE_CLEARED',
  d.deadline_date,
  d.deadline_type
FROM public.work_item_deadlines d
JOIN public.work_items wi ON wi.id = d.work_item_id
WHERE wi.deleted_at IS NULL
  AND wi.lifecycle_state = 'ACTIVE'::public.work_item_lifecycle_state
  AND d.deadline_type IN ('GOV_CADUCIDAD_SANCIONATORIA','GOV_RECURSO_UN_ANO')
  AND d.status IN ('PENDING','PENDING_REVIEW')
  AND d.deadline_status = 'VENCIDO'
  AND NOT EXISTS (
    SELECT 1 FROM public.workflow_stages_global g
    WHERE g.workflow_type = wi.workflow_type::text AND g.code = wi.stage AND g.is_terminal)

UNION ALL
-- 3. Ambiguous / unconfirmed email links
SELECT
  wi.id, wi.organization_id, wi.owner_id, wi.workflow_type::text, wi.stage,
  CASE WHEN l.conflict_flag THEN 'VINCULO_CORREO_EN_CONFLICTO'
       ELSE 'VINCULO_CORREO_AMBIGUO' END,
  'WARNING',
  'work_item_email_links',
  'EMAIL_LINK',
  l.id,
  l.created_at,
  'SNOOZABLE',
  l.received_at::date,
  l.subject
FROM public.work_item_email_links l
JOIN public.work_items wi ON wi.id = l.work_item_id
WHERE wi.deleted_at IS NULL
  AND wi.lifecycle_state = 'ACTIVE'::public.work_item_lifecycle_state
  AND l.link_status = 'SUGGESTED'
  AND (COALESCE(l.match_outcome,'SUGGEST') = 'SUGGEST' OR COALESCE(l.conflict_flag,false))

UNION ALL
-- 4. Pending stage suggestions awaiting confirmation
SELECT
  wi.id, wi.organization_id, wi.owner_id, wi.workflow_type::text, wi.stage,
  'SUGERENCIA_DE_ETAPA_PENDIENTE',
  'INFO',
  'work_item_stage_suggestions',
  'STAGE_SUGGESTION',
  s.id,
  s.created_at,
  'SNOOZABLE',
  s.event_date,
  s.suggested_stage
FROM public.work_item_stage_suggestions s
JOIN public.work_items wi ON wi.id = s.work_item_id
WHERE wi.deleted_at IS NULL
  AND wi.lifecycle_state = 'ACTIVE'::public.work_item_lifecycle_state
  AND s.status = 'PENDING'

UNION ALL
-- 5. Staleness, calibrated per category
SELECT
  wi.id, wi.organization_id, wi.owner_id, wi.workflow_type::text, wi.stage,
  'SIN_MOVIMIENTO_EXTERNO',
  'WARNING',
  'work_items.last_action_date',
  'WORK_ITEM',
  wi.id,
  wi.updated_at,
  'SNOOZABLE',
  wi.last_action_date,
  NULL
FROM public.work_items wi
WHERE wi.deleted_at IS NULL
  AND wi.lifecycle_state = 'ACTIVE'::public.work_item_lifecycle_state
  AND COALESCE(wi.last_action_date, wi.created_at::date)
      < ((now() AT TIME ZONE 'America/Bogota')::date
         - CASE wi.workflow_type::text
             WHEN 'PETICION' THEN 20
             WHEN 'GOV_PROCEDURE' THEN 45
             ELSE 120
           END)
  AND NOT EXISTS (
    SELECT 1 FROM public.workflow_stages_global g
    WHERE g.workflow_type = wi.workflow_type::text AND g.code = wi.stage AND g.is_terminal);

GRANT SELECT ON public.v_work_item_attention_conditions TO authenticated;
GRANT SELECT ON public.v_work_item_attention_conditions TO service_role;

-- ============================================================ B.3 attention never mutates stage
CREATE OR REPLACE FUNCTION public.guard_attention_never_mutates_stage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage
     AND current_setting('andromeda.attention_eval', true) = 'on' THEN
    RAISE EXCEPTION 'ATTENTION_CANNOT_MUTATE_STAGE: la capa de atención no puede cambiar la etapa procedimental (% -> %)', OLD.stage, NEW.stage;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_attention_never_mutates_stage ON public.work_items;
CREATE TRIGGER trg_guard_attention_never_mutates_stage
  BEFORE UPDATE OF stage ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_attention_never_mutates_stage();

-- ============================================================ A.1(4) system-computed stage application
CREATE OR REPLACE FUNCTION public.apply_system_computed_stage(
  p_work_item_id uuid,
  p_new_stage text,
  p_reason text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wf text;
  v_current text;
  v_org uuid;
BEGIN
  SELECT workflow_type::text, stage, organization_id INTO v_wf, v_current, v_org
  FROM public.work_items WHERE id = p_work_item_id;
  IF v_wf IS NULL OR v_current = p_new_stage THEN RETURN false; END IF;

  -- Catalog transition must allow it; no free-text, no dead ends.
  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_stage_transitions t
    WHERE t.workflow_type = v_wf AND t.from_stage_code = v_current
      AND t.to_stage_code = p_new_stage AND t.active
      AND t.requires_explicit_user_action = false
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.work_items SET stage = p_new_stage, updated_at = now()
  WHERE id = p_work_item_id;

  INSERT INTO public.work_item_stage_audit
    (work_item_id, organization_id, actor_user_id, previous_stage, new_stage,
     change_source, reason, metadata)
  VALUES (p_work_item_id, v_org, NULL, v_current, p_new_stage,
          'SYSTEM_COMPUTED', p_reason,
          p_metadata || jsonb_build_object('deterministic', true, 'inference', false));
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_system_computed_stage(uuid, text, text, jsonb) TO service_role;
