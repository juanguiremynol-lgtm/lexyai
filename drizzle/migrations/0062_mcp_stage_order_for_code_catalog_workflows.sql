-- Only catalog-governed workflows (workflow_definitions.catalog_governed) have
-- DB stage rows; the rest use the application stage order, passed explicitly.
DROP FUNCTION IF EXISTS public.mcp_move_work_item_stage(uuid, text, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.mcp_resolve_stage_suggestion(uuid, text, timestamptz, text, text);
DROP FUNCTION IF EXISTS public._mcp_check_stage_move(text, text, text);

CREATE OR REPLACE FUNCTION public._mcp_check_stage_move(p_wf text, p_from text, p_to text, p_app_order text[])
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_to record; v_from record; v_has_rules boolean; v_governed boolean; v_i int; v_j int;
BEGIN
  SELECT COALESCE(bool_or(catalog_governed), false) INTO v_governed
    FROM public.workflow_definitions WHERE workflow_type = p_wf AND active;
  IF NOT v_governed THEN
    v_j := array_position(p_app_order, p_to);
    IF p_app_order IS NULL OR cardinality(p_app_order) = 0 OR v_j IS NULL THEN
      RAISE EXCEPTION 'INVALID_STAGE: % no es una etapa de % en la fase actual', p_to, p_wf USING ERRCODE = 'MCP22'; END IF;
    v_i := array_position(p_app_order, p_from);
    IF v_i IS NOT NULL AND v_j < v_i THEN
      RAISE EXCEPTION 'PRECLUDED_REGRESSION: retroceder de % a % no se hace vía asistente; hazlo en la app si corresponde', p_from, p_to USING ERRCODE = 'MCP22'; END IF;
    RETURN 'application_order';
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

CREATE OR REPLACE FUNCTION public.mcp_move_work_item_stage(p_work_item_id uuid, p_to_stage text,
  p_expected_updated_at timestamptz, p_app_stage_order text[], p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prior jsonb; v_w public.work_items%ROWTYPE; v_before jsonb; v_after jsonb; v_rule text;
BEGIN
  v_prior := public._mcp_begin('move_stage', p_idempotency_key,
    jsonb_build_object('id', p_work_item_id, 'to', p_to_stage, 'exp', p_expected_updated_at, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'expected_updated_at es obligatorio' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_w FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF NOT FOUND OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) OR v_w.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: asunto no encontrado' USING ERRCODE = 'MCP04'; END IF;
  IF v_w.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_REVISION: el asunto cambió (updated_at actual %)', v_w.updated_at USING ERRCODE = 'MCP09'; END IF;
  IF v_w.lifecycle_state <> 'ACTIVE' THEN RAISE EXCEPTION 'el asunto no está activo' USING ERRCODE = 'MCP09'; END IF;
  IF v_w.stage = p_to_stage THEN RAISE EXCEPTION 'el asunto ya está en %', p_to_stage USING ERRCODE = 'MCP09'; END IF;
  v_rule := public._mcp_check_stage_move(v_w.workflow_type::text, v_w.stage, p_to_stage, p_app_stage_order);
  v_before := public._mcp_wi_snapshot(p_work_item_id);
  PERFORM public._mcp_apply_stage(v_w, p_to_stage, 'MANUAL_USER', NULL, COALESCE(p_reason, 'Cambio de etapa vía asistente IA'));
  v_after := public._mcp_wi_snapshot(p_work_item_id);
  RETURN public._mcp_finish('move_stage', p_idempotency_key,
    jsonb_build_object('ok', true, 'work_item', v_after, 'previous_stage', v_w.stage, 'validated_by', v_rule),
    'work_item', p_work_item_id, v_before, v_after);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_resolve_stage_suggestion(p_suggestion_id uuid, p_decision text,
  p_expected_updated_at timestamptz, p_app_stage_order text[], p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prior jsonb; v_s public.work_item_stage_suggestions%ROWTYPE; v_w public.work_items%ROWTYPE;
  v_before jsonb; v_after jsonb;
BEGIN
  v_prior := public._mcp_begin('resolve_stage_suggestion', p_idempotency_key,
    jsonb_build_object('id', p_suggestion_id, 'd', p_decision, 'exp', p_expected_updated_at, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_decision NOT IN ('apply', 'dismiss') THEN RAISE EXCEPTION 'decisión inválida' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_s FROM public.work_item_stage_suggestions WHERE id = p_suggestion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: sugerencia no encontrada' USING ERRCODE = 'MCP04'; END IF;
  SELECT * INTO v_w FROM public.work_items WHERE id = v_s.work_item_id FOR UPDATE;
  IF NOT FOUND OR v_w.deleted_at IS NOT NULL
     OR NOT (v_s.owner_id = auth.uid() OR (v_s.organization_id IS NOT NULL AND public.is_business_org_admin(v_s.organization_id)))
     OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: sugerencia no encontrada' USING ERRCODE = 'MCP04'; END IF;
  IF v_s.status <> 'PENDING' THEN
    RAISE EXCEPTION 'ALREADY_RESOLVED: la sugerencia ya está %', v_s.status USING ERRCODE = 'MCP09'; END IF;
  v_before := jsonb_build_object('suggestion_status', v_s.status, 'work_item', public._mcp_wi_snapshot(v_w.id));
  IF p_decision = 'apply' THEN
    IF p_expected_updated_at IS NULL OR v_w.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'STALE_REVISION: el asunto cambió (updated_at actual %)', v_w.updated_at USING ERRCODE = 'MCP09'; END IF;
    IF v_s.suggested_stage IS NULL OR v_s.suggested_stage = v_w.stage THEN
      RAISE EXCEPTION 'la sugerencia no implica un cambio de etapa' USING ERRCODE = 'MCP09'; END IF;
    PERFORM public._mcp_check_stage_move(v_w.workflow_type::text, v_w.stage, v_s.suggested_stage, p_app_stage_order);
    PERFORM public._mcp_apply_stage(v_w, v_s.suggested_stage, 'SUGGESTION_APPLIED', v_s.id,
      COALESCE(p_reason, 'Sugerencia aceptada vía asistente IA: ' || COALESCE(v_s.reason, '')));
    UPDATE public.work_item_stage_suggestions SET status = 'APPLIED', applied_by_user_id = auth.uid(),
      applied_at = now(), updated_at = now() WHERE id = v_s.id AND status = 'PENDING';
  ELSE
    UPDATE public.work_item_stage_suggestions SET status = 'DISMISSED', dismiss_reason = COALESCE(p_reason, 'MCP_DISMISS'),
      updated_at = now() WHERE id = v_s.id AND status = 'PENDING';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'la sugerencia cambió' USING ERRCODE = 'MCP09'; END IF;
  v_after := jsonb_build_object('suggestion_status', CASE p_decision WHEN 'apply' THEN 'APPLIED' ELSE 'DISMISSED' END,
                                'work_item', public._mcp_wi_snapshot(v_w.id));
  RETURN public._mcp_finish('resolve_stage_suggestion', p_idempotency_key,
    jsonb_build_object('ok', true, 'suggestion_id', v_s.id) || v_after, 'stage_suggestion', v_s.id, v_before, v_after);
END $$;

REVOKE ALL ON FUNCTION public.mcp_move_work_item_stage(uuid, text, timestamptz, text[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_move_work_item_stage(uuid, text, timestamptz, text[], text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_resolve_stage_suggestion(uuid, text, timestamptz, text[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_resolve_stage_suggestion(uuid, text, timestamptz, text[], text, text) TO authenticated, service_role;