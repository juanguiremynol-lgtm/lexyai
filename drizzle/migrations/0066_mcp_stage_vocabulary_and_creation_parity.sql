-- Canonical stored-stage vocabulary for code-catalogued workflows, generated from
-- src/lib/cgp-stages.ts (CGP Kanban keys, movable) and src/lib/workflow-constants.ts
-- (legacy CGP keys: valid current/creation stages, not move targets; other workflows in order).
-- Catalog-governed workflows (PETICION, GOV_PROCEDURE) use workflow_stages_global.
-- Parity is checked by src/lib/mcp/__tests__/stage-vocabulary.test.ts.
CREATE OR REPLACE FUNCTION public._mcp_stage_vocab()
RETURNS TABLE (workflow_type text, code text, ord int, phase text, target_allowed boolean)
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT * FROM (VALUES
    ('CGP','PREPARACION',1,'FILING',true),
    ('CGP','RADICADO',2,'FILING',true),
    ('CGP','SUBSANACION',3,'FILING',true),
    ('CGP','ADMISION',4,'PROCESS',true),
    ('CGP','CUADERNO',5,'PROCESS',true),
    ('CGP','NOTIFICACION',6,'PROCESS',true),
    ('CGP','CONTESTACION',7,'PROCESS',true),
    ('CGP','SANEAMIENTO',8,'PROCESS',true),
    ('CGP','AUDIENCIA_INICIAL',9,'PROCESS',true),
    ('CGP','INTERVENCION',10,'PROCESS',true),
    ('CGP','SENTENCIA',11,'PROCESS',true),
    ('CGP','RECURSO',12,'PROCESS',true),
    ('CGP','DRAFTED',NULL,'FILING',false),
    ('CGP','SENT_TO_REPARTO',NULL,'FILING',false),
    ('CGP','ACTA_PENDING',NULL,'FILING',false),
    ('CGP','ACTA_RECEIVED',NULL,'FILING',false),
    ('CGP','RADICADO_PENDING',NULL,'FILING',false),
    ('CGP','RADICADO_CONFIRMED',NULL,'FILING',false),
    ('CGP','PENDING_AUTO_ADMISORIO',NULL,'FILING',false),
    ('CGP','AUTO_ADMISORIO',NULL,'PROCESS',false),
    ('CGP','NOTIFICACION_PERSONAL',NULL,'PROCESS',false),
    ('CGP','NOTIFICACION_AVISO',NULL,'PROCESS',false),
    ('CGP','EXCEPCIONES_PREVIAS',NULL,'PROCESS',false),
    ('CGP','PRONUNCIARSE_EXCEPCIONES',NULL,'PROCESS',false),
    ('CGP','AUDIENCIA_INSTRUCCION',NULL,'PROCESS',false),
    ('CGP','ALEGATOS_SENTENCIA',NULL,'PROCESS',false),
    ('CGP','APELACION',NULL,'PROCESS',false),
    ('CPACA','PRECONTENCIOSO',1,NULL,true),
    ('CPACA','DEMANDA_POR_RADICAR',2,NULL,true),
    ('CPACA','DEMANDA_RADICADA',3,NULL,true),
    ('CPACA','AUTO_ADMISORIO',4,NULL,true),
    ('CPACA','TRASLADO_DEMANDA',5,NULL,true),
    ('CPACA','TRASLADO_EXCEPCIONES',6,NULL,true),
    ('CPACA','AUDIENCIA_INICIAL',7,NULL,true),
    ('CPACA','AUDIENCIA_PRUEBAS',8,NULL,true),
    ('CPACA','ALEGATOS_SENTENCIA',9,NULL,true),
    ('CPACA','RECURSOS',10,NULL,true),
    ('CPACA','EJECUCION_CUMPLIMIENTO',11,NULL,true),
    ('TUTELA','TUTELA_RADICADA',1,NULL,true),
    ('TUTELA','TUTELA_ADMITIDA',2,NULL,true),
    ('TUTELA','FALLO_PRIMERA_INSTANCIA',3,NULL,true),
    ('TUTELA','FALLO_SEGUNDA_INSTANCIA',4,NULL,true),
    ('TUTELA','ARCHIVADO',5,NULL,true),
    ('EJECUTIVO','PREPARACION',1,NULL,true),
    ('EJECUTIVO','RADICACION',2,NULL,true),
    ('EJECUTIVO','SUBSANACION',3,NULL,true),
    ('EJECUTIVO','MANDAMIENTO_PAGO',4,NULL,true),
    ('EJECUTIVO','NOTIFICACION_MANDAMIENTO',5,NULL,true),
    ('EJECUTIVO','EXCEPCIONES_MERITO',6,NULL,true),
    ('EJECUTIVO','TRASLADO_EXCEPCIONES',7,NULL,true),
    ('EJECUTIVO','SEGUIR_ADELANTE',8,NULL,true),
    ('EJECUTIVO','LIQUIDACION_CREDITO',9,NULL,true),
    ('EJECUTIVO','AVALUO_REMATE',10,NULL,true),
    ('EJECUTIVO','TERMINACION_PAGO',11,NULL,true),
    ('EJECUTIVO','DESISTIMIENTO',12,NULL,true),
    ('LABORAL','BORRADOR',1,NULL,true),
    ('LABORAL','RADICACION',2,NULL,true),
    ('LABORAL','REPARTO',3,NULL,true),
    ('LABORAL','ADMISION_PENDIENTE',4,NULL,true),
    ('LABORAL','AUDIENCIA_INICIAL',5,NULL,true),
    ('LABORAL','AUDIENCIA_JUZGAMIENTO',6,NULL,true),
    ('LABORAL','SENTENCIA_1A_INSTANCIA',7,NULL,true),
    ('LABORAL','APELACION',8,NULL,true),
    ('LABORAL','EJECUCION',9,NULL,true),
    ('LABORAL','ARCHIVADO',10,NULL,true),
    ('PENAL_906','INDAGACION',1,NULL,true),
    ('PENAL_906','IMPUTACION',2,NULL,true),
    ('PENAL_906','MEDIDA_ASEGURAMIENTO',3,NULL,true),
    ('PENAL_906','ESCRITO_ACUSACION',4,NULL,true),
    ('PENAL_906','AUDIENCIA_ACUSACION',5,NULL,true),
    ('PENAL_906','PREPARATORIA',6,NULL,true),
    ('PENAL_906','JUICIO_ORAL',7,NULL,true),
    ('PENAL_906','SENTENCIA',8,NULL,true),
    ('PENAL_906','RECURSOS',9,NULL,true),
    ('PENAL_906','PRECLUSION',10,NULL,true),
    ('PENAL_906','ARCHIVO',11,NULL,true)
  ) v(workflow_type, code, ord, phase, target_allowed)
$$;
REVOKE ALL ON FUNCTION public._mcp_stage_vocab() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mcp_stage_vocab() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._mcp_is_catalog_governed(p_wf text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE(bool_or(catalog_governed), false) FROM public.workflow_definitions WHERE workflow_type = p_wf AND active $$;
REVOKE ALL ON FUNCTION public._mcp_is_catalog_governed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mcp_is_catalog_governed(text) TO authenticated, service_role;

-- Owner-only management (ROLE_AND_SUBSCRIPTION_SPEC section 5: admins only read work_items).
CREATE OR REPLACE FUNCTION public._mcp_can_manage_work_item(p_owner uuid, p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL AND p_owner = auth.uid() $$;

-- Server-side validation; the caller-supplied order is ignored (kept for signature compatibility).
CREATE OR REPLACE FUNCTION public._mcp_check_stage_move(p_wf text, p_from text, p_to text, p_app_order text[])
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_to record; v_from record; v_has_rules boolean;
BEGIN
  IF NOT public._mcp_is_catalog_governed(p_wf) THEN
    SELECT * INTO v_to FROM public._mcp_stage_vocab() s WHERE s.workflow_type = p_wf AND s.code = p_to;
    IF NOT FOUND OR NOT v_to.target_allowed THEN
      RAISE EXCEPTION 'INVALID_STAGE: % no es una etapa movible de % (consulta list_workflow_stages)', p_to, p_wf USING ERRCODE = 'MCP22'; END IF;
    SELECT * INTO v_from FROM public._mcp_stage_vocab() s WHERE s.workflow_type = p_wf AND s.code = p_from;
    IF v_from.ord IS NOT NULL AND v_to.ord < v_from.ord THEN
      RAISE EXCEPTION 'PRECLUDED_REGRESSION: retroceder de % a % no se hace vía asistente; hazlo en la app si corresponde', p_from, p_to USING ERRCODE = 'MCP22'; END IF;
    -- Legacy CGP key without a Kanban position: only forbid leaving PROCESS for FILING.
    IF v_from.ord IS NULL AND v_from.phase = 'PROCESS' AND v_to.phase = 'FILING' THEN
      RAISE EXCEPTION 'PRECLUDED_REGRESSION: el asunto ya está en fase de proceso' USING ERRCODE = 'MCP22'; END IF;
    RETURN 'application_vocabulary';
  END IF;
  SELECT * INTO v_to FROM public.workflow_stages_global WHERE workflow_type = p_wf AND code = p_to AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STAGE: % no es una etapa de %', p_to, p_wf USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_from FROM public.workflow_stages_global WHERE workflow_type = p_wf AND code = p_from AND active;
  SELECT EXISTS (SELECT 1 FROM public.workflow_stage_transitions WHERE workflow_type = p_wf AND active) INTO v_has_rules;
  IF v_has_rules AND EXISTS (SELECT 1 FROM public.workflow_stage_transitions
       WHERE workflow_type = p_wf AND active AND from_stage_code = p_from AND to_stage_code = p_to) THEN
    RETURN 'catalog_transition';
  END IF;
  IF v_from.display_order IS NOT NULL AND v_to.display_order < v_from.display_order THEN
    RAISE EXCEPTION 'PRECLUDED_REGRESSION: retroceder de % a % no está permitido por el catálogo', p_from, p_to USING ERRCODE = 'MCP22'; END IF;
  IF v_has_rules AND v_from.code IS NOT NULL THEN
    RAISE EXCEPTION 'TRANSITION_NOT_ALLOWED: no hay transición % -> % en el catálogo', p_from, p_to USING ERRCODE = 'MCP22'; END IF;
  RETURN 'catalog_order';
END $$;
REVOKE ALL ON FUNCTION public._mcp_check_stage_move(text, text, text, text[]) FROM PUBLIC, anon, authenticated;

-- Stage write with the same markers the app sets, so automatic projection respects it.
CREATE OR REPLACE FUNCTION public._mcp_apply_stage(p_w public.work_items, p_to text, p_source text, p_suggestion uuid, p_reason text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n int; v_phase text; v_new_phase public.cgp_phase;
BEGIN
  IF p_w.workflow_type::text = 'CGP' THEN
    SELECT s.phase INTO v_phase FROM public._mcp_stage_vocab() s WHERE s.workflow_type = 'CGP' AND s.code = p_to;
    v_new_phase := COALESCE(v_phase::public.cgp_phase, p_w.cgp_phase);
  END IF;
  UPDATE public.work_items SET stage = p_to, last_stage_change_source = p_source,
    last_stage_change_at = now(), last_stage_change_by_user_id = auth.uid(),
    last_stage_suggestion_id = COALESCE(p_suggestion, last_stage_suggestion_id),
    cgp_phase = CASE WHEN p_w.workflow_type::text = 'CGP' THEN v_new_phase ELSE cgp_phase END,
    cgp_phase_source = CASE WHEN p_w.workflow_type::text = 'CGP' THEN 'MANUAL'::public.cgp_phase_source ELSE cgp_phase_source END,
    updated_at = now()
   WHERE id = p_w.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'no se actualizó la etapa' USING ERRCODE = 'MCP09'; END IF;
  IF p_w.organization_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.work_item_stage_audit (work_item_id, organization_id, actor_user_id, previous_stage,
    previous_cgp_phase, new_stage, new_cgp_phase, change_source, suggestion_id, reason, metadata)
  VALUES (p_w.id, p_w.organization_id, auth.uid(), p_w.stage, p_w.cgp_phase::text, p_to,
    COALESCE(v_new_phase, p_w.cgp_phase)::text, p_source, p_suggestion, p_reason, jsonb_build_object('via', 'mcp'));
END $$;
REVOKE ALL ON FUNCTION public._mcp_apply_stage(public.work_items, text, text, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_list_workflow_stages(p_workflow_type text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN public._mcp_is_catalog_governed(p_workflow_type) THEN jsonb_build_object(
    'workflow_type', p_workflow_type, 'source', 'database_catalog',
    'stages', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', s.code, 'label', s.label,
        'order', s.display_order, 'is_terminal', s.is_terminal, 'legal_basis', s.legal_basis, 'movable', true)
        ORDER BY s.display_order) FROM public.workflow_stages_global s
       WHERE s.workflow_type = p_workflow_type AND s.active), '[]'::jsonb),
    'transitions', COALESCE((SELECT jsonb_agg(jsonb_build_object('from', t.from_stage_code, 'to', t.to_stage_code,
        'is_regression_allowed', t.is_regression_allowed, 'requires_explicit_user_action', t.requires_explicit_user_action,
        'legal_basis', t.legal_basis)) FROM public.workflow_stage_transitions t
       WHERE t.workflow_type = p_workflow_type AND t.active), '[]'::jsonb))
  ELSE jsonb_build_object(
    'workflow_type', p_workflow_type, 'source', 'application_vocabulary',
    'stages', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', v.code, 'order', v.ord, 'cgp_phase', v.phase,
        'movable', v.target_allowed) ORDER BY v.ord NULLS LAST, v.code)
       FROM public._mcp_stage_vocab() v WHERE v.workflow_type = p_workflow_type), '[]'::jsonb),
    'transitions', '[]'::jsonb,
    'rule', 'Solo avances a etapas movibles; retrocesos y etapas heredadas se gestionan en la app.')
  END
$$;

CREATE OR REPLACE FUNCTION public.mcp_create_work_item(p_workflow_type text, p_stage text, p_radicado text,
  p_title text, p_client_id uuid, p_demandantes text, p_demandados text, p_authority_name text,
  p_monitoring_off_reason text, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prior jsonb; v_digits text; v_dup record; v_id uuid; v_after jsonb; v_stage text;
BEGIN
  v_prior := public._mcp_begin('create_work_item', p_idempotency_key, jsonb_build_object('wf', p_workflow_type,
    'st', p_stage, 'rad', p_radicado, 't', p_title, 'c', p_client_id, 'dte', p_demandantes, 'ddo', p_demandados,
    'a', p_authority_name));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                  WHERE t.typname = 'workflow_type' AND e.enumlabel = p_workflow_type) THEN
    RAISE EXCEPTION 'workflow_type inválido' USING ERRCODE = 'MCP22'; END IF;
  IF public._mcp_is_catalog_governed(p_workflow_type) THEN
    -- Live catalogue wins over stale TS defaults.
    SELECT s.code INTO v_stage FROM public.workflow_stages_global s
     WHERE s.workflow_type = p_workflow_type AND s.active AND s.code = p_stage;
    IF v_stage IS NULL THEN
      SELECT s.code INTO v_stage FROM public.workflow_stages_global s
       WHERE s.workflow_type = p_workflow_type AND s.active ORDER BY s.display_order LIMIT 1;
    END IF;
  ELSE
    SELECT v.code INTO v_stage FROM public._mcp_stage_vocab() v WHERE v.workflow_type = p_workflow_type AND v.code = p_stage;
  END IF;
  IF v_stage IS NULL THEN
    RAISE EXCEPTION 'INVALID_STAGE: % no es una etapa inicial válida de %', p_stage, p_workflow_type USING ERRCODE = 'MCP22'; END IF;
  v_digits := NULLIF(regexp_replace(COALESCE(p_radicado, ''), '[^0-9]', '', 'g'), '');
  IF v_digits IS NOT NULL AND length(v_digits) <> 23 THEN
    RAISE EXCEPTION 'el radicado debe tener 23 dígitos' USING ERRCODE = 'MCP22'; END IF;
  IF v_digits IS NOT NULL THEN
    -- Includes trash/archive: (owner_id, radicado, workflow_type) is unique.
    SELECT id, lifecycle_state, deleted_at, purge_after INTO v_dup FROM public.work_items
     WHERE owner_id = auth.uid() AND workflow_type::text = p_workflow_type
       AND (radicado = v_digits OR regexp_replace(COALESCE(radicado_digits, radicado, ''), '[^0-9]', '', 'g') = v_digits)
     ORDER BY deleted_at NULLS FIRST LIMIT 1;
    IF FOUND THEN
      IF v_dup.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'DUPLICATE_IN_TRASH: el asunto % con este radicado está en la papelera hasta %; restáuralo en lugar de crearlo', v_dup.id, v_dup.purge_after USING ERRCODE = 'MCP09';
      END IF;
      RAISE EXCEPTION 'DUPLICATE: ya tienes este radicado en % (asunto %, estado %)', p_workflow_type, v_dup.id, v_dup.lifecycle_state USING ERRCODE = 'MCP09';
    END IF;
  END IF;
  IF p_client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients
       WHERE id = p_client_id AND owner_id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'NOT_FOUND: cliente no encontrado' USING ERRCODE = 'MCP04'; END IF;
  -- status derives from lifecycle via trigger; owner is always the caller; quota/enrollment triggers run.
  INSERT INTO public.work_items (owner_id, workflow_type, stage, source, title, radicado, radicado_raw,
    radicado_verified, authority_name, demandantes, demandados, client_id, cgp_phase, cgp_phase_source,
    is_flagged, monitoring_enabled, monitoring_disabled_reason, email_linking_enabled)
  VALUES (auth.uid(), p_workflow_type::public.workflow_type, v_stage, 'MANUAL', NULLIF(p_title, ''),
    v_digits, NULLIF(p_radicado, ''), false, NULLIF(p_authority_name, ''), NULLIF(p_demandantes, ''),
    NULLIF(p_demandados, ''), p_client_id,
    CASE WHEN p_workflow_type = 'CGP' THEN 'FILING'::public.cgp_phase ELSE NULL END,
    CASE WHEN p_workflow_type = 'CGP' THEN 'MANUAL'::public.cgp_phase_source ELSE NULL END,
    false, p_monitoring_off_reason IS NULL, p_monitoring_off_reason, true)
  RETURNING id INTO v_id;
  v_after := public._mcp_wi_snapshot(v_id);
  RETURN public._mcp_finish('create_work_item', p_idempotency_key,
    jsonb_build_object('ok', true, 'work_item', v_after), 'work_item', v_id, NULL, v_after);
END $$;