-- ============================================================
-- FASE 1 · §4-§6 — PETICION seed data
-- ============================================================

-- 4.0 MONTHS support in the rule engine (additive branch) --------
CREATE OR REPLACE FUNCTION public.compute_deadline_from_rule(
  p_anchor date, p_workflow text, p_deadline_type text
)
RETURNS TABLE(rule_id uuid, deadline_date date, day_type text, days_amount integer, norma text, requires_manual_review boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r RECORD; v_date DATE;
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
    v_date := public.add_business_days_sql(p_anchor, r.days_amount, r.term_class);
  ELSIF r.day_type = 'CALENDAR' THEN
    v_date := p_anchor + r.days_amount;
  ELSIF r.day_type = 'MONTHS' THEN
    v_date := (p_anchor + (r.days_amount || ' months')::interval)::date;
  ELSIF r.day_type = 'HOURS' THEN
    v_date := p_anchor + CEIL(r.days_amount::NUMERIC / 24)::INT;
  ELSE
    RETURN;
  END IF;

  IF v_date IS NULL OR NOT public.holiday_coverage_ok(p_anchor, v_date) THEN
    RETURN QUERY SELECT r.id, NULL::DATE, r.day_type, r.days_amount, r.norma, true;
    RETURN;
  END IF;

  RETURN QUERY SELECT r.id, v_date, r.day_type, r.days_amount, r.norma, false;
END; $function$;

-- 4.1 Workflow definitions ----------------------------------------
INSERT INTO public.workflow_definitions (workflow_type, label, catalog_governed, legal_basis)
VALUES
  ('PETICION','Derecho de petición', true, 'Ley 1755 de 2015; Ley 1437 de 2011 arts. 83 y 86; Ley 4 de 1913 art. 62'),
  ('CGP','Proceso civil / general (CGP)', false, null),
  ('CPACA','Contencioso administrativo (CPACA)', false, null),
  ('TUTELA','Acción de tutela', false, null),
  ('EJECUTIVO','Proceso ejecutivo', false, null),
  ('LABORAL','Proceso laboral', false, null),
  ('PENAL_906','Proceso penal (Ley 906)', false, null),
  ('GOV_PROCEDURE','Trámite administrativo', false, null),
  ('INDETERMINADO','Indeterminado', false, null)
ON CONFLICT (workflow_type) DO NOTHING;

-- 4.2 Petition subtypes --------------------------------------------
INSERT INTO public.peticion_subtypes
  (code, label, duration_value, duration_unit, term_class, legal_basis,
   requires_user_term, requires_silence_effect, default_silence_effect,
   allows_org_duration_override, display_order)
VALUES
  ('GENERAL','Petición en interés general o particular',15,'BUSINESS_DAYS','ADMINISTRATIVO',
   'Ley 1755 de 2015, art. 14 inc. 1 (términos en días hábiles: Ley 4 de 1913, art. 62)',
   false,false,'NEGATIVE_GENERAL',false,10),
  ('DOCUMENTOS_INFORMACION','Petición de documentos e información',10,'BUSINESS_DAYS','ADMINISTRATIVO',
   'Ley 1755 de 2015, art. 14 num. 1 — vencido el término sin respuesta, la petición se entiende aceptada y las copias se entregan dentro de los 3 días siguientes',
   false,false,'POSITIVE_SPECIAL',false,20),
  ('CONSULTA','Consulta a las autoridades',30,'BUSINESS_DAYS','ADMINISTRATIVO',
   'Ley 1755 de 2015, art. 14 num. 2',
   false,false,'NEGATIVE_GENERAL',false,30),
  ('ENTRE_AUTORIDADES_INFO_DOCUMENTOS','Petición entre autoridades — información o documentos',10,'BUSINESS_DAYS','ADMINISTRATIVO',
   'Ley 1755 de 2015, art. 30 — plazo máximo de 10 días; en los demás casos rigen los plazos del art. 14',
   false,false,'NEGATIVE_GENERAL',false,40),
  ('NORMA_ESPECIAL','Petición sujeta a norma legal especial',NULL,'BUSINESS_DAYS','ADMINISTRATIVO',
   'Ley 1755 de 2015, art. 14 inc. 1 — "salvo norma legal especial"; requiere citar la norma, el término y su efecto de silencio',
   true,true,'MANUAL_REVIEW',false,50)
ON CONFLICT (code) DO NOTHING;

-- 4.3 Stage catalog --------------------------------------------------
INSERT INTO public.workflow_stages_global
  (workflow_type, code, label, display_order, is_terminal, is_procedurally_live, expected_next_event, legal_basis)
VALUES
  ('PETICION','BORRADOR','Borrador',10,false,false,'RADICACION_CONFIRMADA','Etapa operativa previa a la radicación; sin efecto legal propio'),
  ('PETICION','RADICADA','Radicada',20,false,true,'ANCLA_RECEPCION_CONFIRMADA','Ley 1755 de 2015, art. 14 — el término corre desde la recepción por la autoridad'),
  ('PETICION','PENDIENTE_RESPUESTA','Pendiente de respuesta',30,false,true,'RESPUESTA_RECIBIDA','Ley 1755 de 2015, art. 14'),
  ('PETICION','AWAITING_PETITIONER_COMPLETION','En espera de complementación del peticionario',40,false,true,'COMPLETION_SUBMITTED','Ley 1755 de 2015, art. 17 — término de decisión suspendido; el peticionario dispone de 1 mes prorrogable'),
  ('PETICION','TRASLADO_POR_COMPETENCIA','Trasladada por competencia',50,false,true,'COMPETENT_AUTHORITY_RECEIPT','Ley 1755 de 2015, art. 21 — los términos corren desde el día siguiente a la recepción por la autoridad competente'),
  ('PETICION','RESPUESTA_PARCIAL','Respuesta parcial',60,false,true,'RESPUESTA_DE_FONDO_CONFIRMADA','Ley 1755 de 2015, art. 14; doctrina constitucional: la respuesta debe ser de fondo, clara, precisa y congruente'),
  ('PETICION','RESPUESTA_DE_FONDO','Respuesta de fondo',70,true,false,NULL,'Ley 1755 de 2015, art. 14; C. Const. — respuesta de fondo, clara, precisa y congruente'),
  ('PETICION','DEVUELTA_PARA_ACLARACION','Devuelta para aclaración',80,false,true,'ACLARACION_PRESENTADA','Ley 1755 de 2015, art. 19 — peticiones incompletas o irrespetuosas: 10 días para corregir'),
  ('PETICION','DESISTIMIENTO_DECRETADO','Desistimiento decretado y archivo',90,true,false,NULL,'Ley 1755 de 2015, art. 17 — desistimiento tácito mediante acto administrativo motivado; procede reposición'),
  ('PETICION','DESISTIMIENTO_EXPRESO','Desistimiento expreso',100,true,false,NULL,'Ley 1755 de 2015, art. 18'),
  ('PETICION','RECHAZADA','Rechazada',110,true,false,NULL,'Ley 1755 de 2015, art. 19 — petición irrespetuosa sin corrección')
ON CONFLICT (workflow_type, code) DO NOTHING;

-- 4.4 Transitions ------------------------------------------------------
INSERT INTO public.workflow_stage_transitions
  (workflow_type, from_stage_code, to_stage_code, allowed_by_suggestion, requires_explicit_user_action, is_regression_allowed, legal_basis)
VALUES
  ('PETICION','BORRADOR','RADICADA',false,true,false,'Radicación es un hecho verificado por el bufete'),
  ('PETICION','RADICADA','PENDIENTE_RESPUESTA',true,false,false,'Ley 1755 art. 14 — confirmada la recepción corre el término'),
  ('PETICION','PENDIENTE_RESPUESTA','AWAITING_PETITIONER_COMPLETION',true,true,false,'Ley 1755 art. 17'),
  ('PETICION','PENDIENTE_RESPUESTA','TRASLADO_POR_COMPETENCIA',true,true,false,'Ley 1755 art. 21'),
  ('PETICION','PENDIENTE_RESPUESTA','RESPUESTA_PARCIAL',true,true,false,'Ley 1755 art. 14'),
  ('PETICION','PENDIENTE_RESPUESTA','RESPUESTA_DE_FONDO',false,true,false,'Requiere confirmación humana: la mera llegada de una respuesta no acredita respuesta de fondo'),
  ('PETICION','PENDIENTE_RESPUESTA','DEVUELTA_PARA_ACLARACION',true,true,false,'Ley 1755 art. 19'),
  ('PETICION','PENDIENTE_RESPUESTA','DESISTIMIENTO_EXPRESO',false,true,false,'Ley 1755 art. 18'),
  ('PETICION','PENDIENTE_RESPUESTA','RECHAZADA',false,true,false,'Ley 1755 art. 19'),
  ('PETICION','AWAITING_PETITIONER_COMPLETION','PENDIENTE_RESPUESTA',true,true,true,'Ley 1755 art. 17 — el término se reactiva al día siguiente de aportados los documentos'),
  ('PETICION','AWAITING_PETITIONER_COMPLETION','DESISTIMIENTO_DECRETADO',false,true,false,'Ley 1755 art. 17 — solo mediante acto administrativo motivado'),
  ('PETICION','AWAITING_PETITIONER_COMPLETION','DESISTIMIENTO_EXPRESO',false,true,false,'Ley 1755 art. 18'),
  ('PETICION','TRASLADO_POR_COMPETENCIA','PENDIENTE_RESPUESTA',true,true,true,'Ley 1755 art. 21 — nuevo término desde la recepción por la autoridad competente'),
  ('PETICION','RESPUESTA_PARCIAL','RESPUESTA_DE_FONDO',false,true,false,'Requiere confirmación humana'),
  ('PETICION','RESPUESTA_PARCIAL','PENDIENTE_RESPUESTA',false,true,true,'El término continúa para la porción no resuelta'),
  ('PETICION','DEVUELTA_PARA_ACLARACION','PENDIENTE_RESPUESTA',true,true,true,'Ley 1755 art. 19 — corrección presentada'),
  ('PETICION','DEVUELTA_PARA_ACLARACION','RECHAZADA',false,true,false,'Ley 1755 art. 19 — sin corrección')
ON CONFLICT (workflow_type, from_stage_code, to_stage_code) DO NOTHING;

-- 4.5 Event vocabulary ---------------------------------------------------
INSERT INTO public.workflow_event_catalog
  (workflow_type, code, label, event_kind, is_excluded_from_inference, legal_basis)
VALUES
  ('PETICION','RADICACION_CONFIRMADA','Radicación confirmada','PROCEDURAL',false,'Ley 1755 art. 14'),
  ('PETICION','RESPONSE_TERM_EXPIRED','Término de respuesta vencido','SYSTEM',false,'Ley 1755 art. 14'),
  ('PETICION','REQUEST_DEEMED_ACCEPTED','Petición entendida como aceptada','SYSTEM',false,'Ley 1755 art. 14 num. 1'),
  ('PETICION','DOCUMENT_DELIVERY_DUE','Entrega de copias exigible (3 días)','SYSTEM',false,'Ley 1755 art. 14 num. 1'),
  ('PETICION','SILENCIO_NEGATIVO_CONFIGURADO','Silencio administrativo negativo configurado','SYSTEM',false,'Ley 1437 de 2011, art. 83'),
  ('PETICION','REQUERIMIENTO_COMPLETACION_RECEIVED','Requerimiento de complementación recibido','ADMINISTRATIVE',false,'Ley 1755 art. 17'),
  ('PETICION','COMPLETION_SUBMITTED','Complementación aportada','PROCEDURAL',false,'Ley 1755 art. 17'),
  ('PETICION','COMPLETION_EXTENSION_REQUESTED','Prórroga de complementación solicitada','PROCEDURAL',false,'Ley 1755 art. 17'),
  ('PETICION','COMPLETION_TERM_EXPIRED','Término de complementación vencido','SYSTEM',false,'Ley 1755 art. 17 — habilita, no decreta, el desistimiento'),
  ('PETICION','DESISTIMIENTO_DECRETADO','Desistimiento decretado por acto motivado','ADMINISTRATIVE',false,'Ley 1755 art. 17'),
  ('PETICION','TRASLADO_POR_COMPETENCIA_INFORMADO','Traslado por competencia informado','ADMINISTRATIVE',false,'Ley 1755 art. 21 — 5 días'),
  ('PETICION','COMPETENT_AUTHORITY_RECEIPT','Recepción por autoridad competente','ADMINISTRATIVE',false,'Ley 1755 art. 21'),
  ('PETICION','EXTENSION_NOTIFIED','Prórroga informada por la autoridad','ADMINISTRATIVE',false,'Ley 1755 art. 14 parágrafo — no puede exceder el doble del término inicial'),
  ('PETICION','RESPUESTA_RECIBIDA','Respuesta recibida','ADMINISTRATIVE',false,'Ley 1755 art. 14'),
  ('PETICION','RESPUESTA_PARCIAL_RECIBIDA','Respuesta parcial recibida','ADMINISTRATIVE',false,'Ley 1755 art. 14'),
  ('PETICION','DEVOLUCION_PARA_ACLARACION','Devolución para aclaración','ADMINISTRATIVE',false,'Ley 1755 art. 19'),
  ('PETICION','RECHAZO_PETICION_IRRESPETUOSA','Rechazo por petición irrespetuosa','ADMINISTRATIVE',false,'Ley 1755 art. 19'),
  ('PETICION','DESISTIMIENTO_EXPRESO_PRESENTADO','Desistimiento expreso presentado','PROCEDURAL',false,'Ley 1755 art. 18'),
  ('PETICION','ACUSE_DE_RECIBO','Acuse de recibo','NOISE',true,'Sin efecto sustantivo: no acredita respuesta'),
  ('PETICION','CONFIRMACION_LECTURA','Confirmación de lectura','NOISE',true,'Sin efecto sustantivo'),
  ('PETICION','FUERA_DE_OFICINA','Respuesta de ausencia (fuera de oficina)','NOISE',true,'Sin efecto sustantivo'),
  ('PETICION','RESPUESTA_AUTOMATICA','Respuesta automática del sistema de correo','NOISE',true,'Sin efecto sustantivo')
ON CONFLICT (workflow_type, code) DO NOTHING;

-- 4.6 Event → stage patterns ------------------------------------------
INSERT INTO public.workflow_event_stage_patterns
  (workflow_type, event_code, pattern_regex, pattern_keywords, base_confidence, priority, suggested_stage_code, is_excluded, notes)
VALUES
  ('PETICION','ACUSE_DE_RECIBO','(?i)acuse de recibo|se acusa recibo|radicado su solicitud',
   ARRAY['acuse de recibo','acusamos recibo'],0.90,10,NULL,true,'Excluido de inferencia sustantiva'),
  ('PETICION','CONFIRMACION_LECTURA','(?i)confirmaci[oó]n de lectura|read receipt|le[ií]do',
   ARRAY['confirmación de lectura','read receipt'],0.95,10,NULL,true,'Excluido'),
  ('PETICION','FUERA_DE_OFICINA','(?i)fuera de la oficina|out of office|automatic reply|respuesta autom[aá]tica',
   ARRAY['fuera de la oficina','out of office'],0.95,10,NULL,true,'Excluido'),
  ('PETICION','RESPUESTA_AUTOMATICA','(?i)no responda a este mensaje|mensaje autom[aá]tico|do not reply',
   ARRAY['mensaje automático','no responder'],0.90,10,NULL,true,'Excluido'),
  ('PETICION','REQUERIMIENTO_COMPLETACION_RECEIVED','(?i)requerimiento.*complet|s[ií]rvase completar|aportar los documentos|art[ií]culo 17',
   ARRAY['completar la petición','aportar documentos'],0.70,50,'AWAITING_PETITIONER_COMPLETION',false,'Ley 1755 art. 17'),
  ('PETICION','TRASLADO_POR_COMPETENCIA_INFORMADO','(?i)por (falta de )?competencia|se remite|traslado por competencia|art[ií]culo 21',
   ARRAY['falta de competencia','traslado por competencia'],0.70,50,'TRASLADO_POR_COMPETENCIA',false,'Ley 1755 art. 21'),
  ('PETICION','EXTENSION_NOTIFIED','(?i)pr[oó]rroga|ampliaci[oó]n del t[eé]rmino|no ser[aá] posible responder dentro',
   ARRAY['prórroga','ampliación del término'],0.70,50,NULL,false,'La prórroga no cambia la etapa procedimental'),
  ('PETICION','RESPUESTA_RECIBIDA','(?i)en respuesta a su (petici[oó]n|solicitud)|damos respuesta|respuesta de fondo',
   ARRAY['en respuesta a su petición','damos respuesta'],0.55,60,'RESPUESTA_PARCIAL',false,'Nunca promueve a RESPUESTA_DE_FONDO sin confirmación humana'),
  ('PETICION','DEVOLUCION_PARA_ACLARACION','(?i)se devuelve|aclarar su (petici[oó]n|solicitud)|art[ií]culo 19',
   ARRAY['devolución','aclarar la petición'],0.65,55,'DEVUELTA_PARA_ACLARACION',false,'Ley 1755 art. 19');

-- 4.7 PETICION deadline rules (authoritative table: deadline_rules) -----
ALTER TABLE public.deadline_rules DROP CONSTRAINT IF EXISTS deadline_rules_day_type_check;
ALTER TABLE public.deadline_rules
  ADD CONSTRAINT deadline_rules_day_type_check
  CHECK (day_type IN ('BUSINESS','CALENDAR','HOURS','MONTHS'));

INSERT INTO public.deadline_rules
  (workflow_type, deadline_type, days_amount, day_type, term_class, norma, description, requires_manual_review, is_active)
VALUES
  ('PETICION','RESPUESTA_PETICION_GENERAL',15,'BUSINESS','ADMINISTRATIVO',
   'Ley 1755 de 2015, art. 14 inc. 1','Término general de respuesta (15 días hábiles)',false,true),
  ('PETICION','RESPUESTA_PETICION_DOCUMENTOS_INFORMACION',10,'BUSINESS','ADMINISTRATIVO',
   'Ley 1755 de 2015, art. 14 num. 1','Petición de documentos e información (10 días hábiles)',false,true),
  ('PETICION','RESPUESTA_PETICION_CONSULTA',30,'BUSINESS','ADMINISTRATIVO',
   'Ley 1755 de 2015, art. 14 num. 2','Consulta a las autoridades (30 días hábiles)',false,true),
  ('PETICION','RESPUESTA_PETICION_ENTRE_AUTORIDADES_INFO_DOCUMENTOS',10,'BUSINESS','ADMINISTRATIVO',
   'Ley 1755 de 2015, art. 30','Petición entre autoridades sobre información o documentos (10 días hábiles)',false,true),
  ('PETICION','RESPUESTA_PETICION_NORMA_ESPECIAL',1,'BUSINESS','ADMINISTRATIVO',
   'Ley 1755 de 2015, art. 14 inc. 1 — norma legal especial','El término lo fija la norma especial citada por el usuario',true,true),
  ('PETICION','ENTREGA_COPIAS_ACEPTACION_FICTA',3,'BUSINESS','ADMINISTRATIVO',
   'Ley 1755 de 2015, art. 14 num. 1','Entrega de copias tras aceptación ficta; se ancla al vencimiento de los 10 días',false,true),
  ('PETICION','TRASLADO_POR_COMPETENCIA',5,'BUSINESS','ADMINISTRATIVO',
   'Ley 1755 de 2015, art. 21','Deber de informar y remitir a la autoridad competente (5 días hábiles)',false,true),
  ('PETICION','COMPLETACION_PETICIONARIO',1,'MONTHS','ADMINISTRATIVO',
   'Ley 1755 de 2015, art. 17','Plazo del peticionario para completar (1 mes, prorrogable por igual término)',false,true),
  ('PETICION','SILENCIO_ADMINISTRATIVO_NEGATIVO',3,'MONTHS','ADMINISTRATIVO',
   'Ley 1437 de 2011, art. 83','Silencio administrativo negativo: 3 meses desde la presentación',false,true)
ON CONFLICT DO NOTHING;

-- 4.8 Relation type for tutela derived from an unanswered petition ------
COMMENT ON COLUMN public.work_item_successions.relation_type IS
  'Tipos: sucesión procesal, remisión por competencia, TUTELA_POR_SILENCIO (tutela derivada de petición sin respuesta — work items separados, sin escritura cruzada).';

-- 4.9 Legacy table freeze marker -----------------------------------------
COMMENT ON TABLE public.peticiones IS
  'LEGACY / DO_NOT_USE — congelada en Fase 1. Ninguna feature nueva de PETICION puede escribir aquí ni leer "phase" para determinar el estado de un work item. El modelo vigente es work_items(workflow_type=PETICION) + peticion_work_item_state + peticion_events.';