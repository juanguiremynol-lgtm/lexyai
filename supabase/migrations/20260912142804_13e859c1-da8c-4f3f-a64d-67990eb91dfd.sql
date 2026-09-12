-- ════════════════════════════════════════════════════════════════════
-- LV1. DISABLE THE EMAIL-CLOSING RULE. Not tuned — disabled.
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.apply_email_evidence_to_deadlines(p_link_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- An outbound memorial to the despacho inside a wide window is
  -- CORRESPONDENCE, not compliance. A lawyer writes to a court for many
  -- reasons and only one of them discharges the term; the rule closed a
  -- hearing set for 5-nov on an email sent on 26-ago. Disabled, not narrowed:
  -- no window turns correspondence into evidence of compliance.
  -- Nothing already closed is reopened — the lawyer decides those one by one.
  RETURN 0;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- LV2. SPLIT THE STATUS — it was carrying three different facts
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.work_item_deadlines DROP CONSTRAINT IF EXISTS work_item_deadlines_status_check;
ALTER TABLE public.work_item_deadlines ADD CONSTRAINT work_item_deadlines_status_check
  CHECK (status = ANY (ARRAY[
    'PENDING','PENDING_REVIEW','HISTORICAL_BACKFILL','MET','MISSED','CANCELLED',
    'REQUIERE_REVISION_MANUAL','SUGGESTED_BY_EMAIL','SUGGESTED_BY_PROVIDER',
    'FULFILLED','FULFILLED_BY_EMAIL_EVIDENCE','INVALID_NO_TERM','VENCIDO_SIN_SUBSANAR',
    'DISMISSED','SIN_ANCLA_DISPONIBLE','PRESUNCION_DESCARTADA_POR_AVANCE',
    'VENCIDO_SIN_ACTUACION',
    'CERRADO_POR_CORRESPONDENCIA_SIN_VERIFICAR',
    'VENCIDO_ANTES_DEL_MOTOR',
    'VENCIDO_RETRODETECTADO'
  ]));

-- The dateless-anchor guard rejects any UPDATE on a row whose pub_id has no
-- fecha_fijacion. It guards the CREATION of such a term; a status-only
-- reclassification of rows that already exist must not be blocked by it.
ALTER TABLE public.work_item_deadlines DISABLE TRIGGER trg_guard_deadline_dateless_anchor;

-- (a) expired before the engine existed — its own meta already says so.
UPDATE public.work_item_deadlines
   SET status = 'VENCIDO_ANTES_DEL_MOTOR'
 WHERE status = 'FULFILLED_BY_EMAIL_EVIDENCE'
   AND calculation_meta->>'note' ILIKE '%antes de la activación del motor%';

-- (b) back-detected.
UPDATE public.work_item_deadlines
   SET status = 'VENCIDO_RETRODETECTADO'
 WHERE status = 'FULFILLED_BY_EMAIL_EVIDENCE'
   AND calculation_meta->>'note' ILIKE '%últimos 30 días%';

-- (c) closed by an email — carry the subject and date onto the row so he sees
--     WHAT closed it. No date changes, no recomputation.
UPDATE public.work_item_deadlines
   SET status = 'CERRADO_POR_CORRESPONDENCIA_SIN_VERIFICAR',
       calculation_meta = calculation_meta || jsonb_build_object(
         'correspondence_closure', jsonb_build_object(
           'subject',  calculation_meta->'email_evidence'->>'subject',
           'sent_at',  calculation_meta->'email_evidence'->>'sent_at',
           'web_link', calculation_meta->'email_evidence'->>'web_link',
           'link_id',  calculation_meta->'email_evidence'->>'link_id',
           'verified', false,
           'reclassified_at', now()))
 WHERE status = 'FULFILLED_BY_EMAIL_EVIDENCE'
   AND calculation_meta ? 'email_evidence';

ALTER TABLE public.work_item_deadlines ENABLE TRIGGER trg_guard_deadline_dateless_anchor;

-- ════════════════════════════════════════════════════════════════════
-- LV3. HE DECIDES — confirm or reopen a correspondence closure
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.decide_correspondence_closure(
  p_deadline_id uuid, p_decision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE d record;
BEGIN
  IF p_decision NOT IN ('CONFIRM','REOPEN') THEN
    RAISE EXCEPTION 'DECISION_INVALIDA';
  END IF;

  SELECT wd.id, wd.status, wd.deadline_date, wd.calculation_meta, w.owner_id
    INTO d
    FROM public.work_item_deadlines wd
    JOIN public.work_items w ON w.id = wd.work_item_id
   WHERE wd.id = p_deadline_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TERMINO_NO_ENCONTRADO'; END IF;
  IF d.owner_id <> auth.uid() THEN RAISE EXCEPTION 'NO_AUTORIZADO'; END IF;
  IF d.status <> 'CERRADO_POR_CORRESPONDENCIA_SIN_VERIFICAR' THEN
    RAISE EXCEPTION 'ESTADO_NO_DECIDIBLE';
  END IF;

  -- Neither branch touches the date. CONFIRM records his judgement; REOPEN
  -- returns the row to the state it had before the email closed it.
  UPDATE public.work_item_deadlines
     SET status = CASE WHEN p_decision = 'CONFIRM' THEN 'FULFILLED'
                       WHEN deadline_date IS NULL THEN 'REQUIERE_REVISION_MANUAL'
                       ELSE 'PENDING' END,
         met_at = CASE WHEN p_decision = 'CONFIRM' THEN met_at ELSE NULL END,
         calculation_meta = calculation_meta || jsonb_build_object(
           'correspondence_closure',
           COALESCE(calculation_meta->'correspondence_closure','{}'::jsonb)
             || jsonb_build_object('verified', p_decision = 'CONFIRM',
                                   'decided_by', auth.uid(),
                                   'decided_at', now(),
                                   'decision', p_decision))
   WHERE id = p_deadline_id;

  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END;
$function$;

REVOKE ALL ON FUNCTION public.decide_correspondence_closure(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.decide_correspondence_closure(uuid, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- LV6. THE CLASSIFIER — reach the catalogue rule that already exists
-- ════════════════════════════════════════════════════════════════════
-- "REQUIERE POR DESISTIMIENTO" matched only the catch-all ESTADO_GENERAL and
-- started nothing. No catalogue rule is added: RESPUESTA_REQUERIMIENTO at 3
-- business days already exists and is simply unreachable from that wording.
UPDATE public.providencia_classification_rules
   SET pattern_regex = 'ORDENA.*REQUERIR|AUTO.*REQUERIR|REQUERIMIENTO|REQUIERE|DESISTIMIENTO'
 WHERE id = '134925aa-4b97-4ed5-95ea-79c77731bdb8';

-- ════════════════════════════════════════════════════════════════════
-- LV5. THE ANCHOR WINDOW — search backward as well as forward
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.compute_deadline_for_actuacion(p_act_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
      -- LV5: the window ran from the act FORWARD only. A traslado secretarial
      -- FOLLOWS its fijación (07-sep fijación, 09-sep traslado), so its anchor
      -- was structurally invisible. Look 5 days back as well as forward and
      -- take the NEAREST fijación in either direction.
      SELECT s.act_date INTO v_fijacion
        FROM public.work_item_acts s
       WHERE s.work_item_id = v_act.work_item_id
         AND s.id <> v_act.id
         AND COALESCE(s.is_archived, false) = false
         AND s.act_date IS NOT NULL
         AND v_act.act_date IS NOT NULL
         AND s.act_date BETWEEN (v_act.act_date - 5) AND (v_act.act_date + 5)
         AND (COALESCE(s.description, '') || ' ' || COALESCE(s.act_type, ''))
             ~* 'FIJACI[OÓ]N\s*(DE\s*)?ESTADO'
       ORDER BY abs(s.act_date - v_act.act_date) ASC, s.act_date ASC
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
               BETWEEN (v_act.act_date - 5) AND (v_act.act_date + 10)
         ORDER BY abs((p.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE - v_act.act_date) ASC,
                  p.fecha_fijacion ASC
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

-- ════════════════════════════════════════════════════════════════════
-- LV7. DECLARE THE OUTCOMES THE CODE DECIDES ON — exact case
-- ════════════════════════════════════════════════════════════════════
-- `pending_upstream` was declared in lower case while every persisted value is
-- PENDING_UPSTREAM. A declaration that does not match the value reads as
-- coverage and is worse than none.
UPDATE public.sync_vocabulary
   SET value = 'PENDING_UPSTREAM'
 WHERE domain = 'status' AND value = 'pending_upstream';

INSERT INTO public.sync_vocabulary (domain, value, description)
SELECT 'outcome', v, 'Valor de resultado sobre el que el código decide (LT2).'
FROM unnest(ARRAY[
  'AUTH_FAILED','CONNECTED','CPNU_SYNC_FAILED','DB_CONSTRAINT','DB_WRITE_FAILED',
  'FAILED','FORBIDDEN','INVALID_JSON_RESPONSE','MAPPING_SPEC_MISSING',
  'MISSING_PLATFORM_INSTANCE','NOT_FOUND','PARSER_ERROR','PENDING_UPSTREAM',
  'PROVIDER_404','PROVIDER_EMPTY_RESULT','PROVIDER_ERROR','PROVIDER_NO_DOCUMENT',
  'PROVIDER_RATE_LIMITED','PROVIDER_TIMEOUT','PUB_RETRY','RATE_LIMITED',
  'READ_FAILURE','RECORD_NOT_FOUND','SCRAPING_STUCK','SCRAPING_TIMEOUT','SKIPPED',
  'SOURCE_RETENTION_EXPIRED','SUCCESS_EMPTY','SUCCESS_WITH_DATA','SYNC_FAILED',
  'TIMEOUT','TRANSFER_FAILED','UNAUTHORIZED','UPSTREAM_AUTH',
  'UPSTREAM_ROUTE_MISSING','WARN'
]) AS v
ON CONFLICT DO NOTHING;
