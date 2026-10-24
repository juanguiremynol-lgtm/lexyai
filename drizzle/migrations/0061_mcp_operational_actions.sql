-- MCP operational actions: SECURITY DEFINER with explicit authority checks,
-- idempotency + atomic audit, expected-revision checks, committed state returned.

CREATE OR REPLACE FUNCTION public._mcp_wi_snapshot(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object('id', w.id, 'radicado', w.radicado, 'workflow_type', w.workflow_type,
    'stage', w.stage, 'lifecycle_state', w.lifecycle_state, 'status', w.status,
    'deleted_at', w.deleted_at, 'purge_after', w.purge_after,
    'monitoring_enabled', w.monitoring_enabled, 'monitoring_disabled_reason', w.monitoring_disabled_reason,
    'updated_at', w.updated_at)
  FROM public.work_items w WHERE w.id = p_id
$$;
REVOKE ALL ON FUNCTION public._mcp_wi_snapshot(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_work_item_lifecycle(
  p_work_item_id uuid, p_action text, p_expected_updated_at timestamptz,
  p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prior jsonb; v_w public.work_items%ROWTYPE; v_state public.work_item_lifecycle_state;
  v_before jsonb; v_after jsonb; v_r jsonb; v_c jsonb := public.mcp_caller_context();
BEGIN
  v_prior := public._mcp_begin('work_item_lifecycle', p_idempotency_key,
    jsonb_build_object('id', p_work_item_id, 'action', p_action, 'exp', p_expected_updated_at, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_action NOT IN ('archive', 'trash', 'restore') THEN
    RAISE EXCEPTION 'acción inválida' USING ERRCODE = 'MCP22'; END IF;
  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'expected_updated_at es obligatorio' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_w FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF NOT FOUND OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: asunto no encontrado' USING ERRCODE = 'MCP04'; END IF;
  IF v_w.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_REVISION: el asunto cambió (updated_at actual %)', v_w.updated_at USING ERRCODE = 'MCP09'; END IF;
  v_before := public._mcp_wi_snapshot(p_work_item_id);
  IF p_action = 'archive' THEN
    IF v_w.lifecycle_state NOT IN ('ACTIVE', 'CLOSED') THEN
      RAISE EXCEPTION 'solo se archiva un asunto activo o cerrado (estado %)', v_w.lifecycle_state USING ERRCODE = 'MCP09'; END IF;
    v_state := 'ARCHIVED';
  ELSIF p_action = 'trash' THEN
    IF v_w.lifecycle_state = 'DELETED' THEN
      RAISE EXCEPTION 'el asunto ya está en la papelera' USING ERRCODE = 'MCP09'; END IF;
    v_state := 'DELETED';
  ELSE
    IF v_w.lifecycle_state NOT IN ('ARCHIVED', 'DELETED') THEN
      RAISE EXCEPTION 'solo se restaura un asunto archivado o en papelera' USING ERRCODE = 'MCP09'; END IF;
    IF v_w.lifecycle_state = 'DELETED' AND v_w.purge_after IS NOT NULL AND v_w.purge_after <= now() THEN
      RAISE EXCEPTION 'venció el plazo de recuperación (%)', v_w.purge_after USING ERRCODE = 'MCP09'; END IF;
    v_state := 'ACTIVE';
  END IF;
  v_r := public.set_work_item_lifecycle(p_work_item_id, v_state, COALESCE(p_reason, 'MCP_' || upper(p_action)),
           'MCP', auth.uid(), jsonb_build_object('via', 'mcp', 'oauth_client_id', v_c->>'oauth_client_id'));
  IF COALESCE((v_r->>'ok')::boolean, false) IS NOT TRUE OR COALESCE((v_r->>'no_op')::boolean, false) THEN
    RAISE EXCEPTION 'la transición no se aplicó: %', v_r USING ERRCODE = 'MCP09'; END IF;
  v_after := public._mcp_wi_snapshot(p_work_item_id);
  RETURN public._mcp_finish('work_item_lifecycle', p_idempotency_key,
    jsonb_build_object('ok', true, 'effect', p_action, 'work_item', v_after,
      'recovery_deadline', v_after->'purge_after',
      'note', CASE p_action
        WHEN 'trash' THEN 'En papelera: recuperable hasta recovery_deadline; luego se purga según la retención vigente.'
        WHEN 'archive' THEN 'Archivado: se conserva sin plazo y se puede restaurar; el monitoreo queda apagado.'
        ELSE 'Restaurado como activo.' END),
    'work_item', p_work_item_id, v_before, v_after);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_list_workflow_stages(p_workflow_type text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'workflow_type', p_workflow_type,
    'stages', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', s.code, 'label', s.label,
        'order', s.display_order, 'is_terminal', s.is_terminal, 'legal_basis', s.legal_basis)
        ORDER BY s.display_order) FROM public.workflow_stages_global s
       WHERE s.workflow_type = p_workflow_type AND s.active), '[]'::jsonb),
    'transitions', COALESCE((SELECT jsonb_agg(jsonb_build_object('from', t.from_stage_code, 'to', t.to_stage_code,
        'is_regression_allowed', t.is_regression_allowed, 'requires_explicit_user_action', t.requires_explicit_user_action,
        'legal_basis', t.legal_basis)) FROM public.workflow_stage_transitions t
       WHERE t.workflow_type = p_workflow_type AND t.active), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.mcp_list_workflow_stages(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_list_workflow_stages(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._mcp_check_stage_move(p_wf text, p_from text, p_to text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_to record; v_from record; v_has_rules boolean; v_rule record;
BEGIN
  SELECT * INTO v_to FROM public.workflow_stages_global WHERE workflow_type = p_wf AND code = p_to AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STAGE: % no es una etapa de %', p_to, p_wf USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_from FROM public.workflow_stages_global WHERE workflow_type = p_wf AND code = p_from AND active;
  SELECT EXISTS (SELECT 1 FROM public.workflow_stage_transitions WHERE workflow_type = p_wf AND active) INTO v_has_rules;
  IF v_has_rules THEN
    SELECT * INTO v_rule FROM public.workflow_stage_transitions
     WHERE workflow_type = p_wf AND active AND from_stage_code = p_from AND to_stage_code = p_to LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;
  IF v_from.display_order IS NOT NULL AND v_to.display_order < v_from.display_order THEN
    RAISE EXCEPTION 'PRECLUDED_REGRESSION: retroceder de % a % no está permitido por el catálogo; hazlo en la app si corresponde', p_from, p_to USING ERRCODE = 'MCP22';
  END IF;
  IF v_has_rules AND v_from.code IS NOT NULL THEN
    RAISE EXCEPTION 'TRANSITION_NOT_ALLOWED: no hay transición % -> % en el catálogo', p_from, p_to USING ERRCODE = 'MCP22';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._mcp_check_stage_move(text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._mcp_apply_stage(p_w public.work_items, p_to text, p_source text,
  p_suggestion uuid, p_reason text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  UPDATE public.work_items SET stage = p_to, last_stage_change_source = p_source,
    last_stage_change_at = now(), last_stage_change_by_user_id = auth.uid(),
    last_stage_suggestion_id = COALESCE(p_suggestion, last_stage_suggestion_id), updated_at = now()
   WHERE id = p_w.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'no se actualizó la etapa' USING ERRCODE = 'MCP09'; END IF;
  IF p_w.organization_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.work_item_stage_audit (work_item_id, organization_id, actor_user_id, previous_stage,
    previous_cgp_phase, new_stage, new_cgp_phase, change_source, suggestion_id, reason, metadata)
  VALUES (p_w.id, p_w.organization_id, auth.uid(), p_w.stage, p_w.cgp_phase::text, p_to, p_w.cgp_phase::text,
    p_source, p_suggestion, p_reason, jsonb_build_object('via', 'mcp'));
END $$;
REVOKE ALL ON FUNCTION public._mcp_apply_stage(public.work_items, text, text, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_move_work_item_stage(p_work_item_id uuid, p_to_stage text,
  p_expected_updated_at timestamptz, p_idempotency_key text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prior jsonb; v_w public.work_items%ROWTYPE; v_before jsonb; v_after jsonb;
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
  PERFORM public._mcp_check_stage_move(v_w.workflow_type::text, v_w.stage, p_to_stage);
  v_before := public._mcp_wi_snapshot(p_work_item_id);
  PERFORM public._mcp_apply_stage(v_w, p_to_stage, 'MANUAL_USER', NULL, COALESCE(p_reason, 'Cambio de etapa vía asistente IA'));
  v_after := public._mcp_wi_snapshot(p_work_item_id);
  RETURN public._mcp_finish('move_stage', p_idempotency_key,
    jsonb_build_object('ok', true, 'work_item', v_after, 'previous_stage', v_w.stage),
    'work_item', p_work_item_id, v_before, v_after);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_resolve_stage_suggestion(p_suggestion_id uuid, p_decision text,
  p_expected_updated_at timestamptz, p_idempotency_key text, p_reason text DEFAULT NULL)
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
    PERFORM public._mcp_check_stage_move(v_w.workflow_type::text, v_w.stage, v_s.suggested_stage);
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

CREATE OR REPLACE FUNCTION public.mcp_resolve_alert(p_alert_id uuid, p_action text, p_idempotency_key text,
  p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prior jsonb; v_a public.alert_instances%ROWTYPE; v_after jsonb;
BEGIN
  v_prior := public._mcp_begin('resolve_alert', p_idempotency_key,
    jsonb_build_object('id', p_alert_id, 'a', p_action, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_action NOT IN ('acknowledge', 'dismiss') THEN RAISE EXCEPTION 'acción inválida' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_a FROM public.alert_instances WHERE id = p_alert_id AND owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.notifications WHERE id = p_alert_id) THEN
      RAISE EXCEPTION 'WRONG_KIND: ese ID es una notificación; usa set_notification_state' USING ERRCODE = 'MCP22'; END IF;
    RAISE EXCEPTION 'NOT_FOUND: alerta no encontrada' USING ERRCODE = 'MCP04'; END IF;
  IF v_a.status NOT IN ('PENDING', 'SENT', 'ACKNOWLEDGED', 'FIRED') THEN
    RAISE EXCEPTION 'ALREADY_CLOSED: la alerta está %', v_a.status USING ERRCODE = 'MCP09'; END IF;
  IF p_action = 'dismiss' AND v_a.resolution_mode = 'AUTO_ON_CAUSE_CLEARED' THEN
    RAISE EXCEPTION 'NOT_DISMISSABLE: esta alerta se cierra sola cuando desaparece su causa; solo se puede marcar como vista' USING ERRCODE = 'MCP22'; END IF;
  IF p_action = 'acknowledge' THEN
    UPDATE public.alert_instances SET status = 'ACKNOWLEDGED', acknowledged_at = COALESCE(acknowledged_at, now()),
      read_at = COALESCE(read_at, now()), seen_at = COALESCE(seen_at, now()) WHERE id = v_a.id;
  ELSE
    UPDATE public.alert_instances SET status = 'DISMISSED', dismissed_at = now(),
      dismissal_reason = COALESCE(p_reason, 'MCP_DISMISS'),
      read_at = COALESCE(read_at, now()), seen_at = COALESCE(seen_at, now()) WHERE id = v_a.id;
  END IF;
  SELECT jsonb_build_object('id', id, 'status', status, 'acknowledged_at', acknowledged_at,
    'dismissed_at', dismissed_at, 'read_at', read_at, 'resolution_mode', resolution_mode) INTO v_after
    FROM public.alert_instances WHERE id = v_a.id;
  RETURN public._mcp_finish('resolve_alert', p_idempotency_key,
    jsonb_build_object('ok', true, 'alert', v_after,
      'note', 'Descartar o marcar vista una alerta es personal: no cumple ni cierra ningún término.'),
    'alert_instance', v_a.id, jsonb_build_object('status', v_a.status), v_after);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_set_notification_state(p_ids uuid[], p_action text,
  p_until timestamptz, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prior jsonb; v_n int;
BEGIN
  v_prior := public._mcp_begin('set_notification_state', p_idempotency_key,
    jsonb_build_object('ids', p_ids, 'a', p_action, 'until', p_until));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 200 THEN
    RAISE EXCEPTION 'entre 1 y 200 IDs' USING ERRCODE = 'MCP22'; END IF;
  IF EXISTS (SELECT 1 FROM public.alert_instances WHERE id = ANY (p_ids)) THEN
    RAISE EXCEPTION 'WRONG_KIND: hay IDs de alertas; usa resolve_alert' USING ERRCODE = 'MCP22'; END IF;
  SELECT count(*) INTO v_n FROM public.set_notification_user_state(p_ids, p_action, p_until);
  IF v_n <> cardinality(p_ids) THEN RAISE EXCEPTION 'no se actualizaron todas las notificaciones' USING ERRCODE = 'MCP09'; END IF;
  RETURN public._mcp_finish('set_notification_state', p_idempotency_key,
    jsonb_build_object('ok', true, 'updated', v_n, 'action', p_action,
      'states', (SELECT jsonb_agg(jsonb_build_object('notification_id', notification_id, 'read_at', read_at,
         'dismissed_at', dismissed_at, 'snoozed_until', snoozed_until))
         FROM public.notification_user_state WHERE user_id = auth.uid() AND notification_id = ANY (p_ids))),
    'notifications', NULL, NULL, jsonb_build_object('ids', p_ids, 'action', p_action));
END $$;

CREATE OR REPLACE FUNCTION public._mcp_message_radicado_bases(p_meta jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT left(regexp_replace(x, '[^0-9]', '', 'g'), 21))
                  FILTER (WHERE length(regexp_replace(x, '[^0-9]', '', 'g')) >= 21), ARRAY[]::text[])
  FROM (SELECT jsonb_array_elements_text(COALESCE(p_meta->k, '[]'::jsonb)) x
          FROM unnest(ARRAY['body_radicados', 'subject_radicados', 'radicados']) k
         WHERE jsonb_typeof(p_meta->k) = 'array') s
$$;

CREATE OR REPLACE FUNCTION public.mcp_resolve_email_question(p_link_id uuid, p_decision text, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prior jsonb; v_l public.work_item_email_links%ROWTYPE; v_w public.work_items%ROWTYPE;
  v_bases text[]; v_target text; v_dismissed int := 0; v_ids uuid[];
BEGIN
  v_prior := public._mcp_begin('resolve_email_question', p_idempotency_key,
    jsonb_build_object('id', p_link_id, 'd', p_decision));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_decision NOT IN ('confirm', 'dismiss') THEN RAISE EXCEPTION 'decisión inválida' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_l FROM public.work_item_email_links WHERE id = p_link_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: vínculo no encontrado' USING ERRCODE = 'MCP04'; END IF;
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM (
    SELECT id FROM public.work_item_email_links
     WHERE user_id = auth.uid()
       AND CASE WHEN v_l.internet_message_id IS NOT NULL THEN internet_message_id = v_l.internet_message_id
                ELSE message_id = v_l.message_id END
     ORDER BY id FOR UPDATE) s;
  SELECT * INTO v_l FROM public.work_item_email_links WHERE id = p_link_id;
  IF p_decision = 'confirm' THEN
    IF v_l.link_status <> 'SUGGESTED' THEN
      RAISE EXCEPTION 'ALREADY_RESOLVED: el vínculo está %', v_l.link_status USING ERRCODE = 'MCP09'; END IF;
    SELECT * INTO v_w FROM public.work_items WHERE id = v_l.work_item_id;
    IF NOT FOUND OR v_w.deleted_at IS NOT NULL OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) THEN
      RAISE EXCEPTION 'NOT_FOUND: expediente destino no gestionable' USING ERRCODE = 'MCP04'; END IF;
    v_bases := public._mcp_message_radicado_bases(v_l.evidence_meta);
    v_target := left(regexp_replace(COALESCE(v_w.radicado, ''), '[^0-9]', '', 'g'), 21);
    IF COALESCE(v_l.conflict_flag, false)
       OR (cardinality(v_bases) > 0 AND v_target <> '' AND NOT v_target = ANY (v_bases)) THEN
      RAISE EXCEPTION 'RADICADO_CONFLICT: el correo cita otro radicado; usa add_email_association si es deliberado' USING ERRCODE = 'MCP09'; END IF;
    UPDATE public.work_item_email_links SET link_status = 'DISMISSED'
     WHERE id = ANY (v_ids) AND id <> v_l.id AND link_status = 'SUGGESTED';
    GET DIAGNOSTICS v_dismissed = ROW_COUNT;
    UPDATE public.work_item_email_links SET link_status = 'CONFIRMED' WHERE id = v_l.id AND link_status = 'SUGGESTED';
    IF NOT FOUND THEN RAISE EXCEPTION 'el vínculo cambió' USING ERRCODE = 'MCP09'; END IF;
  ELSE
    UPDATE public.work_item_email_links SET link_status = 'DISMISSED'
     WHERE id = ANY (v_ids) AND link_status = 'SUGGESTED';
    GET DIAGNOSTICS v_dismissed = ROW_COUNT;
    IF v_dismissed = 0 THEN RAISE EXCEPTION 'ALREADY_RESOLVED: no hay sugerencias pendientes para este correo' USING ERRCODE = 'MCP09'; END IF;
  END IF;
  RETURN public._mcp_finish('resolve_email_question', p_idempotency_key,
    jsonb_build_object('ok', true, 'decision', p_decision,
      'confirmed_link_id', CASE WHEN p_decision = 'confirm' THEN v_l.id END,
      'work_item_id', CASE WHEN p_decision = 'confirm' THEN v_l.work_item_id END,
      'siblings_dismissed', v_dismissed,
      'note', 'Asociar un correo nunca cambia la etapa ni da por cumplido un término.'),
    'email_message', v_l.id, jsonb_build_object('link_ids', v_ids),
    jsonb_build_object('decision', p_decision, 'dismissed', v_dismissed));
END $$;

CREATE OR REPLACE FUNCTION public.mcp_add_email_association(p_link_id uuid, p_work_item_id uuid, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prior jsonb; v_w public.work_items%ROWTYPE; v_new uuid; v_l public.work_item_email_links%ROWTYPE;
BEGIN
  v_prior := public._mcp_begin('add_email_association', p_idempotency_key,
    jsonb_build_object('id', p_link_id, 'wi', p_work_item_id));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  SELECT * INTO v_l FROM public.work_item_email_links WHERE id = p_link_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: vínculo no encontrado' USING ERRCODE = 'MCP04'; END IF;
  SELECT * INTO v_w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND OR v_w.deleted_at IS NOT NULL OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: expediente destino no gestionable' USING ERRCODE = 'MCP04'; END IF;
  v_new := public.manual_link_email_to_work_item(p_link_id, p_work_item_id);
  IF v_new IS NULL THEN RAISE EXCEPTION 'no se creó el vínculo' USING ERRCODE = 'MCP09'; END IF;
  RETURN public._mcp_finish('add_email_association', p_idempotency_key,
    jsonb_build_object('ok', true, 'link_id', v_new, 'work_item_id', p_work_item_id,
      'note', 'Se agregó la asociación confirmada. Asociaciones ya confirmadas con otros expedientes se conservan; esto no es un traslado exclusivo ni cambia etapas o términos.'),
    'email_link', v_new, jsonb_build_object('source_link', p_link_id, 'source_status', v_l.link_status),
    jsonb_build_object('link_id', v_new, 'work_item_id', p_work_item_id));
END $$;

CREATE OR REPLACE FUNCTION public.mcp_resolve_detected_process(p_id uuid, p_decision text, p_work_item_id uuid,
  p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prior jsonb; v_d public.detected_processes%ROWTYPE; v_w public.work_items%ROWTYPE; v_status text;
BEGIN
  v_prior := public._mcp_begin('resolve_detected_process', p_idempotency_key,
    jsonb_build_object('id', p_id, 'd', p_decision, 'wi', p_work_item_id));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_decision NOT IN ('dismiss', 'matched_existing', 'created') THEN RAISE EXCEPTION 'decisión inválida' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_d FROM public.detected_processes WHERE id = p_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: proceso detectado no encontrado' USING ERRCODE = 'MCP04'; END IF;
  IF v_d.status <> 'PENDING' THEN RAISE EXCEPTION 'ALREADY_RESOLVED: está %', v_d.status USING ERRCODE = 'MCP09'; END IF;
  IF p_decision = 'dismiss' THEN
    UPDATE public.detected_processes SET status = 'DISMISSED', dismissed_at = now(), updated_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('resolved_via', 'mcp') WHERE id = p_id;
    v_status := 'DISMISSED';
  ELSE
    IF p_work_item_id IS NULL THEN RAISE EXCEPTION 'work_item_id es obligatorio' USING ERRCODE = 'MCP22'; END IF;
    SELECT * INTO v_w FROM public.work_items WHERE id = p_work_item_id;
    IF NOT FOUND OR v_w.deleted_at IS NOT NULL OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) THEN
      RAISE EXCEPTION 'NOT_FOUND: expediente no gestionable' USING ERRCODE = 'MCP04'; END IF;
    IF left(regexp_replace(COALESCE(v_w.radicado, ''), '[^0-9]', '', 'g'), 21)
       <> left(regexp_replace(COALESCE(v_d.radicado, ''), '[^0-9]', '', 'g'), 21) THEN
      RAISE EXCEPTION 'RADICADO_MISMATCH: el expediente no corresponde al radicado detectado' USING ERRCODE = 'MCP22'; END IF;
    IF p_decision = 'created' AND v_w.created_at < v_d.first_seen_at THEN
      RAISE EXCEPTION 'el expediente ya existía antes de la detección; usa matched_existing' USING ERRCODE = 'MCP22'; END IF;
    v_status := CASE p_decision WHEN 'created' THEN 'CREATED' ELSE 'MATCHED_EXISTING' END;
    UPDATE public.detected_processes SET status = v_status, created_work_item_id = p_work_item_id, updated_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('resolved_via', 'mcp') WHERE id = p_id;
  END IF;
  RETURN public._mcp_finish('resolve_detected_process', p_idempotency_key,
    jsonb_build_object('ok', true, 'id', p_id, 'status', v_status, 'work_item_id', p_work_item_id),
    'detected_process', p_id, jsonb_build_object('status', v_d.status), jsonb_build_object('status', v_status));
END $$;

CREATE OR REPLACE FUNCTION public.mcp_create_work_item(p_workflow_type text, p_stage text, p_radicado text,
  p_title text, p_client_id uuid, p_demandantes text, p_demandados text, p_authority_name text,
  p_monitoring_off_reason text, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_prior jsonb; v_digits text; v_dup uuid; v_id uuid; v_after jsonb;
BEGIN
  v_prior := public._mcp_begin('create_work_item', p_idempotency_key, jsonb_build_object('wf', p_workflow_type,
    'st', p_stage, 'rad', p_radicado, 't', p_title, 'c', p_client_id, 'dte', p_demandantes, 'ddo', p_demandados,
    'a', p_authority_name));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                  WHERE t.typname = 'workflow_type' AND e.enumlabel = p_workflow_type) THEN
    RAISE EXCEPTION 'workflow_type inválido' USING ERRCODE = 'MCP22'; END IF;
  v_digits := NULLIF(regexp_replace(COALESCE(p_radicado, ''), '[^0-9]', '', 'g'), '');
  IF v_digits IS NOT NULL AND length(v_digits) <> 23 THEN
    RAISE EXCEPTION 'el radicado debe tener 23 dígitos' USING ERRCODE = 'MCP22'; END IF;
  IF v_digits IS NOT NULL THEN
    SELECT id INTO v_dup FROM public.work_items
     WHERE owner_id = auth.uid() AND deleted_at IS NULL
       AND regexp_replace(COALESCE(radicado_digits, radicado, ''), '[^0-9]', '', 'g') = v_digits LIMIT 1;
    IF v_dup IS NOT NULL THEN
      RAISE EXCEPTION 'DUPLICATE: ya tienes este radicado (asunto %)', v_dup USING ERRCODE = 'MCP09'; END IF;
  END IF;
  IF p_client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients
       WHERE id = p_client_id AND owner_id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'NOT_FOUND: cliente no encontrado' USING ERRCODE = 'MCP04'; END IF;
  INSERT INTO public.work_items (owner_id, workflow_type, stage, status, source, title, radicado, radicado_raw,
    radicado_verified, authority_name, demandantes, demandados, client_id, cgp_phase, cgp_phase_source,
    is_flagged, monitoring_enabled, monitoring_disabled_reason, email_linking_enabled)
  VALUES (auth.uid(), p_workflow_type::public.workflow_type, p_stage, 'ACTIVE', 'MANUAL', NULLIF(p_title, ''),
    v_digits, NULLIF(p_radicado, ''), false, NULLIF(p_authority_name, ''), NULLIF(p_demandantes, ''),
    NULLIF(p_demandados, ''), p_client_id,
    CASE WHEN p_workflow_type = 'CGP' THEN 'FILING'::public.cgp_phase END,
    CASE WHEN p_workflow_type = 'CGP' THEN 'MANUAL'::public.cgp_phase_source END,
    false, p_monitoring_off_reason IS NULL, p_monitoring_off_reason, true)
  RETURNING id INTO v_id;
  v_after := public._mcp_wi_snapshot(v_id);
  RETURN public._mcp_finish('create_work_item', p_idempotency_key,
    jsonb_build_object('ok', true, 'work_item', v_after), 'work_item', v_id, NULL, v_after);
END $$;

CREATE OR REPLACE FUNCTION public.mcp_list_updates(p_cursor text, p_limit int DEFAULT 100,
  p_work_item_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lim int := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_cur jsonb; v_ts timestamptz; v_kind text := ''; v_id uuid := '00000000-0000-0000-0000-000000000000';
  v_overlap interval := interval '15 minutes';
  v_rows jsonb; v_n int; v_last jsonb; v_next text; v_more boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_cursor IS NOT NULL AND p_cursor <> '' THEN
    BEGIN v_cur := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'CURSOR_INVALID' USING ERRCODE = 'MCP22'; END;
    IF v_cur->>'u' IS DISTINCT FROM v_uid::text THEN RAISE EXCEPTION 'CURSOR_FOREIGN: el cursor pertenece a otra cuenta' USING ERRCODE = 'MCP22'; END IF;
    IF (v_cur->>'w') IS DISTINCT FROM (p_work_item_id::text) THEN RAISE EXCEPTION 'CURSOR_SCOPE_MISMATCH' USING ERRCODE = 'MCP22'; END IF;
    IF (v_cur->>'iat')::timestamptz < now() - interval '7 days' THEN RAISE EXCEPTION 'CURSOR_EXPIRED: pide un cursor nuevo' USING ERRCODE = 'MCP09'; END IF;
    v_ts := (v_cur->>'ts')::timestamptz; v_kind := v_cur->>'k'; v_id := (v_cur->>'id')::uuid;
    IF (v_cur->>'caught_up')::boolean THEN
      v_ts := v_ts - v_overlap; v_kind := ''; v_id := '00000000-0000-0000-0000-000000000000';
    END IF;
  ELSE
    v_ts := now() - interval '3 days';
  END IF;

  WITH ev AS (
    SELECT * FROM (
      SELECT COALESCE(a.updated_at, a.created_at) AS ts, 'actuacion'::text AS kind, a.id, a.work_item_id,
        jsonb_build_object('act_date', a.act_date, 'description', left(a.description, 400), 'source', a.source,
          'detected_at', a.detected_at, 'changed_at', a.changed_at, 'created_at', a.created_at,
          'is_archived', a.is_archived, 'content_hash', a.content_hash) AS data
        FROM public.work_item_acts a
       WHERE (p_work_item_id IS NULL OR a.work_item_id = p_work_item_id)
         AND (COALESCE(a.updated_at, a.created_at), 'actuacion'::text, a.id) > (v_ts, v_kind, v_id)
       ORDER BY 1, 3 LIMIT v_lim + 1) x
    UNION ALL SELECT * FROM (
      SELECT COALESCE(p.updated_at, p.created_at), 'estado'::text, p.id, p.work_item_id,
        jsonb_build_object('title', left(p.title, 300), 'fecha_fijacion', p.fecha_fijacion,
          'fecha_desfijacion', p.fecha_desfijacion, 'tipo_publicacion', p.tipo_publicacion, 'source', p.source,
          'detected_at', p.detected_at, 'changed_at', p.changed_at, 'created_at', p.created_at,
          'is_archived', p.is_archived, 'content_hash', p.content_hash)
        FROM public.work_item_publicaciones p
       WHERE (p_work_item_id IS NULL OR p.work_item_id = p_work_item_id)
         AND (COALESCE(p.updated_at, p.created_at), 'estado'::text, p.id) > (v_ts, v_kind, v_id)
       ORDER BY 1, 3 LIMIT v_lim + 1) y
    UNION ALL SELECT * FROM (
      SELECT w.lifecycle_changed_at, 'work_item_lifecycle'::text, w.id, w.id,
        jsonb_build_object('lifecycle_state', w.lifecycle_state, 'deleted_at', w.deleted_at, 'purge_after', w.purge_after)
        FROM public.work_items w
       WHERE (p_work_item_id IS NULL OR w.id = p_work_item_id)
         AND (w.lifecycle_changed_at, 'work_item_lifecycle'::text, w.id) > (v_ts, v_kind, v_id)
       ORDER BY 1, 3 LIMIT v_lim + 1) z
  ), page AS (
    SELECT * FROM ev ORDER BY ts, kind, id LIMIT v_lim + 1
  )
  SELECT jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'work_item_id', work_item_id, 'change_ts', ts,
           'dedupe_key', kind || ':' || id || ':' || ts, 'data', data) ORDER BY ts, kind, id), count(*)
    INTO v_rows, v_n FROM page;
  v_more := COALESCE(v_n, 0) > v_lim;
  IF v_more THEN v_rows := v_rows - v_lim; END IF;
  v_last := v_rows -> (jsonb_array_length(COALESCE(v_rows, '[]'::jsonb)) - 1);
  v_next := encode(convert_to(jsonb_build_object('v', 1, 'u', v_uid, 'w', p_work_item_id, 'iat', now(),
    'ts', COALESCE(v_last->>'change_ts', v_ts::text),
    'k', COALESCE(v_last->>'kind', v_kind), 'id', COALESCE(v_last->>'id', v_id::text),
    'caught_up', NOT v_more)::text, 'UTF8'), 'base64');
  RETURN jsonb_build_object('events', COALESCE(v_rows, '[]'::jsonb), 'has_more', v_more,
    'next_cursor', replace(v_next, E'\n', ''),
    'overlap_window_seconds', extract(epoch FROM v_overlap)::int,
    'freshness', (SELECT jsonb_agg(jsonb_build_object('work_item_id', w.id, 'last_synced_at', w.last_synced_at,
        'scrape_status', w.scrape_status)) FROM public.work_items w
        WHERE w.id IN (SELECT (e->>'work_item_id')::uuid FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) e)),
    'limitations', 'Orden estable por (change_ts, kind, id). Al ponerse al día, la siguiente consulta repasa los últimos 15 minutos: deduplica por dedupe_key. Una transacción que confirme más de 15 minutos después de su marca de tiempo podría no aparecer. Sin eventos no significa que los proveedores hayan respondido: revisa freshness.');
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'mcp_work_item_lifecycle(uuid,text,timestamptz,text,text)',
    'mcp_move_work_item_stage(uuid,text,timestamptz,text,text)',
    'mcp_resolve_stage_suggestion(uuid,text,timestamptz,text,text)',
    'mcp_resolve_alert(uuid,text,text,text)',
    'mcp_set_notification_state(uuid[],text,timestamptz,text)',
    'mcp_resolve_email_question(uuid,text,text)',
    'mcp_add_email_association(uuid,uuid,text)',
    'mcp_resolve_detected_process(uuid,text,uuid,text)',
    'mcp_create_work_item(text,text,text,text,uuid,text,text,text,text,text)',
    'mcp_list_updates(text,int,uuid)',
    'grant_mcp_client_access(uuid,text)', 'revoke_mcp_client_access(uuid)', 'list_my_mcp_connections()']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;