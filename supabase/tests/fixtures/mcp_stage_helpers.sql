CREATE OR REPLACE FUNCTION public._mcp_stage_vocab()
 RETURNS TABLE(workflow_type text, code text, ord integer, phase text, target_allowed boolean)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public._mcp_is_catalog_governed(p_wf text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT COALESCE(bool_or(catalog_governed), false) FROM public.workflow_definitions WHERE workflow_type = p_wf AND active $function$
;
CREATE OR REPLACE FUNCTION public._mcp_check_manual_stage_move(p_wf text, p_from text, p_to text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_to record; v_from record; v_has_rules boolean; v_t record; v_regression boolean := false;
  v_reason_ok boolean := length(btrim(COALESCE(p_reason, ''))) >= 5;
BEGIN
  IF p_from = p_to THEN RAISE EXCEPTION 'SAME_STAGE: el asunto ya está en %', p_to USING ERRCODE = 'MCP09'; END IF;
  IF NOT public._mcp_is_catalog_governed(p_wf) THEN
    SELECT * INTO v_to FROM public._mcp_stage_vocab() s WHERE s.workflow_type = p_wf AND s.code = p_to;
    IF NOT FOUND OR NOT v_to.target_allowed THEN
      RAISE EXCEPTION 'INVALID_STAGE: % no es una etapa movible de % (consulta list_workflow_stages)', p_to, p_wf USING ERRCODE = 'MCP22'; END IF;
    SELECT * INTO v_from FROM public._mcp_stage_vocab() s WHERE s.workflow_type = p_wf AND s.code = p_from;
    v_regression := COALESCE(v_from.ord IS NOT NULL AND v_to.ord < v_from.ord, false)
                 OR COALESCE(v_from.phase = 'PROCESS' AND v_to.phase = 'FILING', false);
    IF v_regression AND NOT v_reason_ok THEN
      RAISE EXCEPTION 'REASON_REQUIRED: retroceder de % a % exige el motivo indicado por el usuario (reason)', p_from, p_to USING ERRCODE = 'MCP22'; END IF;
    RETURN jsonb_build_object('rule', 'application_vocabulary', 'is_regression', v_regression);
  END IF;
  SELECT * INTO v_to FROM public.workflow_stages_global WHERE workflow_type = p_wf AND code = p_to AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STAGE: % no es una etapa de %', p_to, p_wf USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_from FROM public.workflow_stages_global WHERE workflow_type = p_wf AND code = p_from AND active;
  SELECT EXISTS (SELECT 1 FROM public.workflow_stage_transitions WHERE workflow_type = p_wf AND active) INTO v_has_rules;
  IF v_has_rules AND v_from.code IS NOT NULL THEN
    SELECT * INTO v_t FROM public.workflow_stage_transitions
     WHERE workflow_type = p_wf AND active AND from_stage_code = p_from AND to_stage_code = p_to;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRANSITION_NOT_ALLOWED: el catálogo no contempla % -> %', p_from, p_to USING ERRCODE = 'MCP22'; END IF;
    v_regression := COALESCE(v_t.is_regression_allowed, false) OR COALESCE(v_to.display_order < v_from.display_order, false);
  ELSE
    v_regression := COALESCE(v_to.display_order < v_from.display_order, false);
  END IF;
  IF v_regression AND NOT v_reason_ok THEN
    RAISE EXCEPTION 'REASON_REQUIRED: retroceder de % a % exige el motivo indicado por el usuario (reason)', p_from, p_to USING ERRCODE = 'MCP22'; END IF;
  RETURN jsonb_build_object('rule', CASE WHEN v_has_rules AND v_from.code IS NOT NULL THEN 'catalog_transition' ELSE 'catalog_stage' END,
                            'is_regression', v_regression);
END $function$
;
CREATE OR REPLACE FUNCTION public._mcp_apply_stage(p_w work_items, p_to text, p_source text, p_suggestion uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;
