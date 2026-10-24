-- 0068: release-blocker hardening for MCP management (independent review 2026-10-24).
-- Write RPC EXECUTE grants stay revoked (temporary review gate); CREATE OR REPLACE preserves ACLs.

CREATE OR REPLACE FUNCTION public.mcp_caller_context()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_claims jsonb := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_sid uuid; v_claim_client uuid; v_bad_claim boolean := false;
  v_sess record; v_found boolean := false; v_reason text := NULL; v_client uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'anonymous');
  END IF;
  BEGIN v_sid := NULLIF(v_claims->>'session_id', '')::uuid; EXCEPTION WHEN others THEN v_sid := NULL; v_bad_claim := true; END;
  BEGIN v_claim_client := NULLIF(v_claims->>'client_id', '')::uuid; EXCEPTION WHEN others THEN v_claim_client := NULL; v_bad_claim := true; END;
  IF v_bad_claim THEN v_reason := 'MALFORMED_CLAIMS';
  ELSIF v_sid IS NULL THEN v_reason := 'NO_SESSION';
  ELSE
    SELECT s.id, s.user_id, s.oauth_client_id, s.scopes, s.not_after INTO v_sess
      FROM auth.sessions s WHERE s.id = v_sid;
    v_found := FOUND;
    IF NOT v_found THEN v_reason := 'SESSION_NOT_FOUND';
    ELSIF v_sess.user_id IS DISTINCT FROM v_uid THEN v_reason := 'SESSION_USER_MISMATCH';
    ELSIF v_sess.not_after IS NOT NULL AND v_sess.not_after <= now() THEN v_reason := 'SESSION_EXPIRED';
    ELSIF v_claim_client IS NOT NULL AND v_sess.oauth_client_id IS DISTINCT FROM v_claim_client THEN v_reason := 'CLIENT_MISMATCH';
    ELSIF v_sess.oauth_client_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM auth.oauth_clients oc WHERE oc.id = v_sess.oauth_client_id AND oc.deleted_at IS NULL) THEN
      v_reason := 'CLIENT_DELETED';
    END IF;
  END IF;
  v_client := CASE WHEN v_reason IS NULL THEN v_sess.oauth_client_id END;
  RETURN jsonb_build_object(
    'authenticated', true, 'user_id', v_uid, 'session_id', v_sid,
    'session_found', v_found AND v_reason IS NULL,
    'oauth_client_id', COALESCE(v_client, v_claim_client),
    'surface', CASE WHEN v_reason IS NOT NULL THEN 'unverified'
                    WHEN v_client IS NOT NULL THEN 'oauth_client' ELSE 'first_party' END,
    'unverified_reason', v_reason,
    'token_scopes', CASE WHEN v_reason IS NULL THEN v_sess.scopes END);
END $function$;

CREATE OR REPLACE FUNCTION public.mcp_access_level()
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c jsonb := public.mcp_caller_context(); v_client uuid; v_level text; v_scopes text;
BEGIN
  IF NOT (c->>'authenticated')::boolean THEN RETURN 'none'; END IF;
  IF c->>'surface' = 'first_party' THEN RETURN 'first_party'; END IF;
  IF c->>'surface' IS DISTINCT FROM 'oauth_client' THEN RETURN 'none'; END IF;
  v_client := (c->>'oauth_client_id')::uuid;
  SELECT g.access_level INTO v_level
    FROM public.mcp_client_grants g
    JOIN auth.oauth_consents oc ON oc.id = g.consent_id
   WHERE g.user_id = auth.uid() AND g.oauth_client_id = v_client AND g.revoked_at IS NULL
     AND oc.user_id = g.user_id AND oc.client_id = g.oauth_client_id
     AND oc.revoked_at IS NULL AND oc.granted_at = g.consent_granted_at
   LIMIT 1;
  v_level := COALESCE(v_level, 'read');
  v_scopes := COALESCE(c->>'token_scopes', '');
  IF v_scopes ~ '(^|\s)andromeda:read(\s|$)' AND v_scopes !~ '(^|\s)andromeda:manage(\s|$)' THEN v_level := 'read'; END IF;
  RETURN v_level;
END $function$;

CREATE OR REPLACE FUNCTION public._assert_owner_direct_write(p_owner uuid, p_allow_trusted boolean)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF p_allow_trusted AND public._mcp_is_trusted_backend() THEN RETURN; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  PERFORM public.mcp_assert_write();
  IF p_owner IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
END $function$;
REVOKE ALL ON FUNCTION public._assert_owner_direct_write(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._assert_owner_direct_write(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.suspend_work_item_monitoring(p_work_item_id uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_owner uuid; v_n int;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'a reason is required to suspend monitoring'; END IF;
  SELECT owner_id INTO v_owner FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF NOT FOUND THEN
    IF public._mcp_is_trusted_backend() THEN RAISE EXCEPTION 'TRABAJO_NO_ENCONTRADO'; END IF;
    RAISE EXCEPTION 'NO_AUTORIZADO' USING ERRCODE = '42501';
  END IF;
  PERFORM public._assert_owner_direct_write(v_owner, true);
  UPDATE public.work_items SET monitoring_disabled_by = 'USER', monitoring_disabled_reason = btrim(p_reason),
         monitoring_disabled_at = now(), updated_at = now()
   WHERE id = p_work_item_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'monitoring not suspended'; END IF;
  RETURN jsonb_build_object('ok', true, 'suspended', true);
END $function$;

CREATE OR REPLACE FUNCTION public.resume_work_item_monitoring(p_work_item_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_owner uuid; v_n int;
BEGIN
  SELECT owner_id INTO v_owner FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF NOT FOUND THEN
    IF public._mcp_is_trusted_backend() THEN RAISE EXCEPTION 'TRABAJO_NO_ENCONTRADO'; END IF;
    RAISE EXCEPTION 'NO_AUTORIZADO' USING ERRCODE = '42501';
  END IF;
  PERFORM public._assert_owner_direct_write(v_owner, true);
  UPDATE public.work_items SET monitoring_disabled_by = NULL, monitoring_disabled_reason = NULL,
         monitoring_disabled_at = NULL, consecutive_404_count = 0, provider_reachable = true, updated_at = now()
   WHERE id = p_work_item_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'monitoring not resumed'; END IF;
  RETURN jsonb_build_object('ok', true, 'resumed', true);
END $function$;

REVOKE ALL ON FUNCTION public.suspend_work_item_monitoring(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resume_work_item_monitoring(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suspend_work_item_monitoring(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resume_work_item_monitoring(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_system_computed_stage(p_work_item_id uuid, p_new_stage text, p_reason text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_wf text; v_current text; v_org uuid;
BEGIN
  IF NOT public._mcp_is_trusted_backend() THEN
    RAISE EXCEPTION 'SYSTEM_ONLY: apply_system_computed_stage is restricted to trusted backend jobs' USING ERRCODE = '42501';
  END IF;
  SELECT workflow_type::text, stage, organization_id INTO v_wf, v_current, v_org
    FROM public.work_items WHERE id = p_work_item_id;
  IF v_wf IS NULL OR v_current = p_new_stage THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_stage_transitions t
     WHERE t.workflow_type = v_wf AND t.from_stage_code = v_current
       AND t.to_stage_code = p_new_stage AND t.active AND t.requires_explicit_user_action = false
  ) THEN RETURN false; END IF;
  UPDATE public.work_items SET stage = p_new_stage, updated_at = now() WHERE id = p_work_item_id;
  INSERT INTO public.work_item_stage_audit
    (work_item_id, organization_id, actor_user_id, previous_stage, new_stage, change_source, reason, metadata)
  VALUES (p_work_item_id, v_org, NULL, v_current, p_new_stage, 'SYSTEM_COMPUTED', p_reason,
          p_metadata || jsonb_build_object('deterministic', true, 'inference', false));
  RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.apply_system_computed_stage(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_system_computed_stage(uuid, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.decide_deadline_discharge(p_suggestion_id uuid, p_confirm boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s record; v_prev text;
BEGIN
  SELECT * INTO s FROM public.deadline_discharge_suggestions WHERE id = p_suggestion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
  PERFORM public._assert_owner_direct_write(s.owner_id, false);
  IF s.status <> 'PENDING' THEN RETURN jsonb_build_object('ok', false, 'reason','ALREADY_DECIDED'); END IF;
  SELECT status INTO v_prev FROM public.work_item_deadlines WHERE id = s.deadline_id;
  UPDATE public.deadline_discharge_suggestions
     SET status = CASE WHEN p_confirm THEN 'CONFIRMED' ELSE 'REJECTED' END, decided_at = now(), decided_by = auth.uid()
   WHERE id = p_suggestion_id;
  IF p_confirm THEN
    UPDATE public.work_item_deadlines
       SET status = 'FULFILLED', met_at = COALESCE(met_at, now()),
           closure_reason = 'DISCHARGE_CONFIRMED_BY_LAWYER',
           calculation_meta = COALESCE(calculation_meta,'{}'::jsonb)
             || jsonb_build_object('discharge_state','CUMPLIDO_CONFIRMADO',
                                   'discharge_suggestion_id', p_suggestion_id, 'discharge_act_id', s.act_id)
             || CASE WHEN v_prev = 'VENCIDO_SIN_ACTUACION'
                     THEN jsonb_build_object('recovered_from_drain_at', now()) ELSE '{}'::jsonb END
     WHERE id = s.deadline_id;
  ELSE
    UPDATE public.work_item_deadlines
       SET calculation_meta = COALESCE(calculation_meta,'{}'::jsonb) || jsonb_build_object('discharge_state','RECHAZADO_POR_ABOGADO')
     WHERE id = s.deadline_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'confirmed', p_confirm, 'previous_status', v_prev);
END $function$;

CREATE OR REPLACE FUNCTION public.decide_correspondence_closure(p_deadline_id uuid, p_decision text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE d record;
BEGIN
  IF p_decision NOT IN ('CONFIRM','REOPEN') THEN RAISE EXCEPTION 'DECISION_INVALIDA'; END IF;
  SELECT wd.id, wd.status, wd.deadline_date, wd.calculation_meta, w.owner_id INTO d
    FROM public.work_item_deadlines wd JOIN public.work_items w ON w.id = wd.work_item_id
   WHERE wd.id = p_deadline_id FOR UPDATE OF wd;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_AUTORIZADO' USING ERRCODE = '42501'; END IF;
  PERFORM public._assert_owner_direct_write(d.owner_id, false);
  IF d.status <> 'CERRADO_POR_CORRESPONDENCIA_SIN_VERIFICAR' THEN RAISE EXCEPTION 'ESTADO_NO_DECIDIBLE'; END IF;
  UPDATE public.work_item_deadlines
     SET status = CASE WHEN p_decision = 'CONFIRM' THEN 'FULFILLED'
                       WHEN deadline_date IS NULL THEN 'REQUIERE_REVISION_MANUAL' ELSE 'PENDING' END,
         met_at = CASE WHEN p_decision = 'CONFIRM' THEN met_at ELSE NULL END,
         calculation_meta = calculation_meta || jsonb_build_object('correspondence_closure',
           COALESCE(calculation_meta->'correspondence_closure','{}'::jsonb)
             || jsonb_build_object('verified', p_decision = 'CONFIRM', 'decided_by', auth.uid(),
                                   'decided_at', now(), 'decision', p_decision))
   WHERE id = p_deadline_id;
  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END $function$;
REVOKE ALL ON FUNCTION public.decide_deadline_discharge(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_correspondence_closure(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_deadline_discharge(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_correspondence_closure(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._notification_ids_visible_to_caller(p_ids uuid[])
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(n.id), ARRAY[]::uuid[]) FROM public.notifications n
   WHERE n.id = ANY (p_ids) AND auth.uid() IS NOT NULL AND (
         (n.audience_scope = 'USER' AND n.user_id = auth.uid())
      OR (n.audience_scope = 'ORG_ADMIN' AND n.org_id IS NOT NULL AND public.is_org_admin(n.org_id))
      OR (n.audience_scope = 'SUPER_ADMIN' AND public.is_platform_admin()))
$function$;
REVOKE ALL ON FUNCTION public._notification_ids_visible_to_caller(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._notification_ids_visible_to_caller(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.set_notification_user_state(_ids uuid[], _action text, _until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS SETOF notification_user_state LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE v_vis uuid[];
BEGIN
  PERFORM public.mcp_assert_write();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF _action NOT IN ('read','dismiss','snooze') OR _ids IS NULL OR cardinality(_ids) > 500 THEN RAISE EXCEPTION 'Acción inválida'; END IF;
  IF _action = 'snooze' AND (_until IS NULL OR _until <= now()) THEN RAISE EXCEPTION 'Fecha inválida'; END IF;
  v_vis := public._notification_ids_visible_to_caller(_ids);
  IF cardinality(v_vis) <> (SELECT count(DISTINCT x) FROM unnest(_ids) x) THEN RAISE EXCEPTION 'Notificación no accesible'; END IF;
  RETURN QUERY INSERT INTO public.notification_user_state AS s(notification_id, user_id, read_at, dismissed_at, snoozed_until)
  SELECT x, auth.uid(), CASE WHEN _action='read' THEN now() END, CASE WHEN _action='dismiss' THEN now() END,
         CASE WHEN _action='snooze' THEN _until END
    FROM unnest(v_vis) x
  ON CONFLICT (notification_id, user_id) DO UPDATE SET
    read_at = coalesce(s.read_at, excluded.read_at), dismissed_at = coalesce(s.dismissed_at, excluded.dismissed_at),
    snoozed_until = CASE WHEN _action='snooze' AND s.dismissed_at IS NULL THEN excluded.snoozed_until ELSE s.snoozed_until END
  RETURNING s.*;
END $function$;
REVOKE ALL ON FUNCTION public.set_notification_user_state(uuid[], text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_notification_user_state(uuid[], text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._notification_ids_visible_to_caller(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_set_notification_state(p_ids uuid[], p_action text, p_until timestamp with time zone, p_idempotency_key text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_prior jsonb; v_n int; v_ids uuid[];
BEGIN
  v_prior := public._mcp_begin('set_notification_state', p_idempotency_key,
    jsonb_build_object('ids', p_ids, 'a', p_action, 'until', p_until));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 200 THEN
    RAISE EXCEPTION 'entre 1 y 200 IDs' USING ERRCODE = 'MCP22'; END IF;
  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_ids) x;
  IF EXISTS (SELECT 1 FROM public.alert_instances WHERE id = ANY (v_ids) AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'WRONG_KIND: hay IDs de alertas; usa resolve_alert' USING ERRCODE = 'MCP22'; END IF;
  IF cardinality(public._notification_ids_visible_to_caller(v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'NOT_FOUND: notificación no encontrada' USING ERRCODE = 'MCP04'; END IF;
  SELECT count(*) INTO v_n FROM public.set_notification_user_state(v_ids, p_action, p_until);
  IF v_n <> cardinality(v_ids) THEN RAISE EXCEPTION 'no se actualizaron todas las notificaciones' USING ERRCODE = 'MCP09'; END IF;
  RETURN public._mcp_finish('set_notification_state', p_idempotency_key,
    jsonb_build_object('ok', true, 'updated', v_n, 'action', p_action,
      'states', (SELECT jsonb_agg(jsonb_build_object('notification_id', notification_id, 'read_at', read_at,
         'dismissed_at', dismissed_at, 'snoozed_until', snoozed_until))
         FROM public.notification_user_state WHERE user_id = auth.uid() AND notification_id = ANY (v_ids))),
    'notifications', NULL, NULL, jsonb_build_object('ids', v_ids, 'action', p_action));
END $function$;

CREATE OR REPLACE FUNCTION public.mcp_resolve_alert(p_alert_id uuid, p_action text, p_idempotency_key text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_prior jsonb; v_a public.alert_instances%ROWTYPE; v_after jsonb;
BEGIN
  v_prior := public._mcp_begin('resolve_alert', p_idempotency_key,
    jsonb_build_object('id', p_alert_id, 'a', p_action, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_action NOT IN ('acknowledge', 'dismiss') THEN RAISE EXCEPTION 'acción inválida' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_a FROM public.alert_instances WHERE id = p_alert_id AND owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    IF cardinality(public._notification_ids_visible_to_caller(ARRAY[p_alert_id])) = 1 THEN
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
  IF NOT FOUND THEN RAISE EXCEPTION 'la alerta no se actualizó' USING ERRCODE = 'MCP09'; END IF;
  SELECT jsonb_build_object('id', id, 'status', status, 'acknowledged_at', acknowledged_at,
    'dismissed_at', dismissed_at, 'read_at', read_at, 'resolution_mode', resolution_mode) INTO v_after
    FROM public.alert_instances WHERE id = v_a.id;
  RETURN public._mcp_finish('resolve_alert', p_idempotency_key,
    jsonb_build_object('ok', true, 'alert', v_after,
      'note', 'Descartar o marcar vista una alerta es personal: no cumple ni cierra ningún término.'),
    'alert_instance', v_a.id, jsonb_build_object('status', v_a.status), v_after);
END $function$;

CREATE OR REPLACE FUNCTION public._mcp_subject_radicado_bases(p_subject text)
 RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT left(d, 21)) FILTER (WHERE length(d) BETWEEN 21 AND 23), ARRAY[]::text[])
    FROM (SELECT regexp_replace(m[1], '[^0-9]', '', 'g') AS d
            FROM regexp_matches(COALESCE(p_subject, ''), '(\d(?:[ .\-]?\d){20,22})', 'g') AS m) s
$function$;

CREATE OR REPLACE FUNCTION public.mcp_resolve_email_question(p_link_id uuid, p_decision text, p_idempotency_key text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_prior jsonb; v_l public.work_item_email_links%ROWTYPE; v_w public.work_items%ROWTYPE;
  v_bases text[]; v_target text; v_dismissed int := 0; v_ids uuid[];
BEGIN
  v_prior := public._mcp_begin('resolve_email_question', p_idempotency_key, jsonb_build_object('id', p_link_id, 'd', p_decision));
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
    SELECT COALESCE(array_agg(DISTINCT b), ARRAY[]::text[]) INTO v_bases
      FROM unnest(public._mcp_message_radicado_bases(v_l.evidence_meta) || public._mcp_subject_radicado_bases(v_l.subject)) b;
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
    UPDATE public.work_item_email_links SET link_status = 'DISMISSED' WHERE id = ANY (v_ids) AND link_status = 'SUGGESTED';
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
END $function$;

CREATE OR REPLACE FUNCTION public.mcp_create_work_item(p_workflow_type text, p_stage text, p_radicado text, p_title text, p_client_id uuid, p_demandantes text, p_demandados text, p_authority_name text, p_monitoring_off_reason text, p_idempotency_key text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_prior jsonb; v_digits text; v_dup record; v_id uuid; v_after jsonb; v_stage text; v_phase text;
  v_reason text := NULLIF(btrim(COALESCE(p_monitoring_off_reason, '')), ''); v_w public.work_items%ROWTYPE;
  v_next timestamptz; v_rem text[] := ARRAY[]::text[]; v_sync text[] := ARRAY[]::text[];
BEGIN
  v_prior := public._mcp_begin('create_work_item', p_idempotency_key, jsonb_build_object('wf', p_workflow_type,
    'st', p_stage, 'rad', p_radicado, 't', p_title, 'c', p_client_id, 'dte', p_demandantes, 'ddo', p_demandados,
    'a', p_authority_name, 'mor', p_monitoring_off_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                  WHERE t.typname = 'workflow_type' AND e.enumlabel = p_workflow_type) THEN
    RAISE EXCEPTION 'workflow_type inválido' USING ERRCODE = 'MCP22'; END IF;
  IF public._mcp_is_catalog_governed(p_workflow_type) THEN
    IF p_stage IS NOT NULL THEN
      SELECT s.code INTO v_stage FROM public.workflow_stages_global s
       WHERE s.workflow_type = p_workflow_type AND s.active AND s.code = p_stage;
      IF v_stage IS NULL AND p_stage IN ('PETICION_RADICADA', 'INICIO_APERTURA') THEN p_stage := NULL; END IF;
    END IF;
    IF p_stage IS NULL THEN
      SELECT s.code INTO v_stage FROM public.workflow_stages_global s
       WHERE s.workflow_type = p_workflow_type AND s.active ORDER BY s.display_order LIMIT 1;
    END IF;
  ELSE
    SELECT v.code, v.phase INTO v_stage, v_phase FROM public._mcp_stage_vocab() v
     WHERE v.workflow_type = p_workflow_type AND (v.code = p_stage OR (p_stage IS NULL AND v.ord IS NOT NULL))
     ORDER BY v.ord NULLS LAST LIMIT 1;
  END IF;
  IF v_stage IS NULL THEN
    RAISE EXCEPTION 'INVALID_STAGE: % no es una etapa inicial válida de % (consulta list_workflow_stages)', p_stage, p_workflow_type USING ERRCODE = 'MCP22'; END IF;
  v_digits := NULLIF(regexp_replace(COALESCE(p_radicado, ''), '[^0-9]', '', 'g'), '');
  IF v_digits IS NOT NULL AND length(v_digits) <> 23 THEN
    RAISE EXCEPTION 'el radicado debe tener 23 dígitos' USING ERRCODE = 'MCP22'; END IF;
  IF v_digits IS NOT NULL THEN
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
  INSERT INTO public.work_items (owner_id, workflow_type, stage, source, title, radicado, radicado_raw,
    radicado_verified, authority_name, demandantes, demandados, client_id, cgp_phase, cgp_phase_source,
    is_flagged, monitoring_enabled, monitoring_disabled_reason, monitoring_disabled_by, monitoring_disabled_at,
    email_linking_enabled)
  VALUES (auth.uid(), p_workflow_type::public.workflow_type, v_stage, 'MANUAL', NULLIF(p_title, ''),
    v_digits, NULLIF(p_radicado, ''), false, NULLIF(p_authority_name, ''), NULLIF(p_demandantes, ''),
    NULLIF(p_demandados, ''), p_client_id,
    CASE WHEN p_workflow_type = 'CGP' THEN COALESCE(v_phase, 'FILING')::public.cgp_phase END,
    CASE WHEN p_workflow_type = 'CGP' THEN 'MANUAL'::public.cgp_phase_source END,
    false, v_reason IS NULL, v_reason,
    CASE WHEN v_reason IS NOT NULL THEN 'USER' END, CASE WHEN v_reason IS NOT NULL THEN now() END, true)
  RETURNING id INTO v_id;
  SELECT * INTO v_w FROM public.work_items WHERE id = v_id;

  IF p_workflow_type IN ('CGP', 'CPACA', 'TUTELA', 'LABORAL') THEN
    IF v_w.authority_name IS NULL THEN v_rem := v_rem || 'ACTA_REPARTO_PENDING'::text; END IF;
    IF v_digits IS NULL OR right(v_digits, 2) NOT IN ('00', '01') THEN v_rem := v_rem || 'RADICADO_PENDING'::text; END IF;
    v_rem := v_rem || ARRAY['EXPEDIENTE_PENDING', 'AUTO_ADMISORIO_PENDING']::text[];
    v_next := (public.add_business_days_sql((now() AT TIME ZONE 'America/Bogota')::date, 5)
               + (now() AT TIME ZONE 'America/Bogota')::time) AT TIME ZONE 'America/Bogota';
    INSERT INTO public.work_item_reminders (organization_id, owner_id, work_item_id, reminder_type,
      cadence_business_days, next_run_at, status, created_by)
    SELECT v_w.organization_id, v_w.owner_id, v_w.id, r::public.reminder_type, 5, v_next, 'ACTIVE', v_w.owner_id
      FROM unnest(v_rem) r
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_w.monitoring_enabled AND v_digits IS NOT NULL
     AND p_workflow_type IN ('CGP', 'CPACA', 'LABORAL', 'PENAL_906', 'TUTELA', 'EJECUTIVO') THEN
    INSERT INTO public.sync_retry_queue (work_item_id, organization_id, radicado, stage, kind, provider,
      attempt, max_attempts, next_run_at, last_error_code, last_error_message)
    VALUES
      (v_id, v_w.organization_id, v_digits, v_stage, 'PUB_RETRY',
       CASE WHEN p_workflow_type = 'CPACA' THEN 'samai' ELSE 'publicaciones' END, 0, 3, now(),
       'MCP_INITIAL_SYNC', 'Sincronización inicial de un asunto creado vía asistente IA'),
      (v_id, v_w.organization_id, v_digits, v_stage, 'ACT_SCRAPE_RETRY',
       CASE WHEN p_workflow_type = 'CPACA' THEN 'samai' ELSE 'cpnu' END, 0, 3, now() + interval '1 minute',
       'MCP_INITIAL_SYNC', 'Sincronización inicial de un asunto creado vía asistente IA')
    ON CONFLICT (work_item_id, kind) DO NOTHING;
    v_sync := ARRAY['PUB_RETRY', 'ACT_SCRAPE_RETRY']::text[];
  END IF;

  v_after := public._mcp_wi_snapshot(v_id);
  RETURN public._mcp_finish('create_work_item', p_idempotency_key,
    jsonb_build_object('ok', true, 'work_item', v_after, 'reminders_created', to_jsonb(v_rem),
      'initial_sync_enqueued', to_jsonb(v_sync),
      'note', CASE WHEN v_reason IS NOT NULL THEN 'Monitoreo suspendido deliberadamente por el usuario: ' || v_reason
                   WHEN NOT v_w.monitoring_enabled THEN 'Sin monitoreo automático: ' || COALESCE(v_w.monitoring_disabled_reason, '')
                   ELSE 'Monitoreo activo; la primera consulta queda en cola duradera.' END),
    'work_item', v_id, NULL, v_after || jsonb_build_object('reminders', to_jsonb(v_rem), 'initial_sync', to_jsonb(v_sync)));
END $function$;

CREATE TABLE public.mcp_feed_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_key uuid NOT NULL,
  work_item_id uuid,
  mode text NOT NULL CHECK (mode IN ('incremental', 'reconcile')),
  scan_ts timestamptz, scan_kind text, scan_id uuid,
  scan_upper timestamptz,
  checkpoint timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
GRANT SELECT, INSERT, DELETE ON public.mcp_feed_cursors TO authenticated;
GRANT ALL ON public.mcp_feed_cursors TO service_role;
ALTER TABLE public.mcp_feed_cursors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own feed cursors select" ON public.mcp_feed_cursors FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own feed cursors insert" ON public.mcp_feed_cursors FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own feed cursors delete" ON public.mcp_feed_cursors FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX mcp_feed_cursors_user_idx ON public.mcp_feed_cursors (user_id, expires_at);

CREATE OR REPLACE FUNCTION public._mcp_feed_page(p_ts timestamptz, p_kind text, p_id uuid, p_upper timestamptz, p_limit integer, p_work_item_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE v_lim int := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500); v_rows jsonb; v_n int; v_more boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  WITH vis AS (
    SELECT w.id FROM public.work_items w WHERE p_work_item_id IS NULL OR w.id = p_work_item_id
  ), ev AS (
    SELECT * FROM (
      SELECT COALESCE(a.updated_at, a.created_at) AS ts, 'actuacion'::text AS kind, a.id, a.work_item_id,
        md5(COALESCE(a.updated_at, a.created_at)::text || '|' || COALESCE(a.content_hash, '') || '|' || COALESCE(a.is_archived::text, '')) AS rev,
        jsonb_build_object('act_date', a.act_date, 'description', left(a.description, 400), 'source', a.source,
          'detected_at', a.detected_at, 'changed_at', a.changed_at, 'created_at', a.created_at,
          'updated_at', a.updated_at, 'is_archived', a.is_archived, 'content_hash', a.content_hash) AS data
        FROM public.work_item_acts a JOIN vis ON vis.id = a.work_item_id
       WHERE (COALESCE(a.updated_at, a.created_at), 'actuacion'::text, a.id) > (p_ts, p_kind, p_id)
         AND COALESCE(a.updated_at, a.created_at) <= p_upper
       ORDER BY 1, 3 LIMIT v_lim + 1) x
    UNION ALL SELECT * FROM (
      SELECT COALESCE(p.updated_at, p.created_at), 'estado'::text, p.id, p.work_item_id,
        md5(COALESCE(p.updated_at, p.created_at)::text || '|' || COALESCE(p.content_hash, '') || '|' || COALESCE(p.is_archived::text, '')),
        jsonb_build_object('title', left(p.title, 300), 'fecha_fijacion', p.fecha_fijacion,
          'fecha_desfijacion', p.fecha_desfijacion, 'tipo_publicacion', p.tipo_publicacion, 'source', p.source,
          'detected_at', p.detected_at, 'changed_at', p.changed_at, 'created_at', p.created_at,
          'updated_at', p.updated_at, 'is_archived', p.is_archived, 'content_hash', p.content_hash)
        FROM public.work_item_publicaciones p JOIN vis ON vis.id = p.work_item_id
       WHERE (COALESCE(p.updated_at, p.created_at), 'estado'::text, p.id) > (p_ts, p_kind, p_id)
         AND COALESCE(p.updated_at, p.created_at) <= p_upper
       ORDER BY 1, 3 LIMIT v_lim + 1) y
    UNION ALL SELECT * FROM (
      SELECT w.lifecycle_changed_at, 'work_item_lifecycle'::text, w.id, w.id,
        md5(w.lifecycle_changed_at::text || '|' || w.lifecycle_state::text),
        jsonb_build_object('lifecycle_state', w.lifecycle_state, 'deleted_at', w.deleted_at, 'purge_after', w.purge_after)
        FROM public.work_items w JOIN vis ON vis.id = w.id
       WHERE (w.lifecycle_changed_at, 'work_item_lifecycle'::text, w.id) > (p_ts, p_kind, p_id)
         AND w.lifecycle_changed_at <= p_upper
       ORDER BY 1, 3 LIMIT v_lim + 1) z
  ), page AS (SELECT * FROM ev ORDER BY ts, kind, id LIMIT v_lim + 1)
  SELECT jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'work_item_id', work_item_id, 'change_ts', ts,
           'revision', rev, 'dedupe_key', kind || ':' || id || ':' || rev, 'data', data) ORDER BY ts, kind, id), count(*)
    INTO v_rows, v_n FROM page;
  v_more := COALESCE(v_n, 0) > v_lim;
  IF v_more THEN v_rows := v_rows - v_lim; END IF;
  RETURN jsonb_build_object('events', COALESCE(v_rows, '[]'::jsonb), 'has_more', v_more);
END $function$;

CREATE OR REPLACE FUNCTION public._mcp_feed_freshness(p_work_item_id uuid, p_page_items uuid[])
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH scope AS (
    SELECT w.id, w.last_synced_at, w.scrape_status, w.monitoring_enabled FROM public.work_items w
     WHERE w.deleted_at IS NULL AND (p_work_item_id IS NULL OR w.id = p_work_item_id)
  ), latest AS (
    SELECT DISTINCT ON (t.work_item_id, t.provider, t.operation) t.work_item_id, t.provider, t.operation, t.status,
           t.error_code, t.started_at, t.finished_at, t.records_inserted, t.records_skipped,
           COALESCE(t.finished_at, t.started_at, t.created_at) AS at
      FROM public.work_item_sync_timeline t JOIN scope s ON s.id = t.work_item_id
     WHERE t.created_at > now() - interval '30 days'
     ORDER BY t.work_item_id, t.provider, t.operation, COALESCE(t.finished_at, t.started_at, t.created_at) DESC
  ), last_ok AS (
    SELECT t.work_item_id, t.provider, t.operation, max(COALESCE(t.finished_at, t.started_at)) AS at
      FROM public.work_item_sync_timeline t JOIN scope s ON s.id = t.work_item_id
     WHERE t.status = 'success' AND t.created_at > now() - interval '30 days'
     GROUP BY 1, 2, 3
  )
  SELECT jsonb_build_object(
    'window', '30 days',
    'scope', CASE WHEN p_work_item_id IS NULL THEN 'portfolio' ELSE 'work_item' END,
    'monitored_items', (SELECT count(*) FROM scope WHERE monitoring_enabled),
    'monitored_items_without_check', (SELECT count(*) FROM scope s WHERE s.monitoring_enabled
                                      AND NOT EXISTS (SELECT 1 FROM latest l WHERE l.work_item_id = s.id)),
    'by_provider', COALESCE((SELECT jsonb_agg(jsonb_build_object('provider', provider, 'operation', operation,
        'items_checked', n, 'items_latest_success', n_ok, 'items_latest_not_success', n - n_ok,
        'oldest_last_success_at', oldest_ok, 'newest_last_success_at', newest_ok) ORDER BY provider, operation)
      FROM (SELECT l.provider, l.operation, count(*) n, count(*) FILTER (WHERE l.status = 'success') n_ok,
                   min(o.at) oldest_ok, max(o.at) newest_ok
              FROM latest l LEFT JOIN last_ok o USING (work_item_id, provider, operation)
             GROUP BY 1, 2) g), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('work_item_id', s.id,
        'cache_summary', jsonb_build_object('last_synced_at', s.last_synced_at, 'scrape_status', s.scrape_status),
        'sync_checks', (SELECT jsonb_agg(jsonb_build_object('provider', l.provider, 'operation', l.operation,
             'status', l.status, 'successful_check', l.status = 'success', 'error_code', l.error_code,
             'started_at', l.started_at, 'finished_at', l.finished_at, 'records_inserted', l.records_inserted,
             'records_skipped', l.records_skipped, 'last_success_at', o.at) ORDER BY l.provider, l.operation)
           FROM latest l LEFT JOIN last_ok o USING (work_item_id, provider, operation) WHERE l.work_item_id = s.id)))
      FROM scope s WHERE s.id = ANY (COALESCE(p_page_items, ARRAY[]::uuid[])) OR s.id = p_work_item_id), '[]'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION public._mcp_feed_step(p_client uuid, p_work_item_id uuid, p_mode text,
  p_ts timestamptz, p_kind text, p_id uuid, p_upper timestamptz, p_checkpoint timestamptz, p_limit integer)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path TO 'public'
AS $function$
DECLARE v_upper timestamptz := COALESCE(p_upper, now()); v_page jsonb; v_last jsonb; v_new uuid; v_cp timestamptz;
  v_wis uuid[]; v_more boolean;
BEGIN
  v_page := public._mcp_feed_page(p_ts, p_kind, p_id, v_upper, p_limit, p_work_item_id);
  v_more := (v_page->>'has_more')::boolean;
  v_last := (v_page->'events') -> (jsonb_array_length(v_page->'events') - 1);
  DELETE FROM public.mcp_feed_cursors WHERE user_id = auth.uid() AND expires_at < now();
  IF v_more THEN
    v_cp := p_checkpoint;
    INSERT INTO public.mcp_feed_cursors (user_id, client_key, work_item_id, mode, scan_ts, scan_kind, scan_id, scan_upper, checkpoint)
    VALUES (auth.uid(), p_client, p_work_item_id, p_mode, (v_last->>'change_ts')::timestamptz, v_last->>'kind',
            (v_last->>'id')::uuid, v_upper, p_checkpoint) RETURNING id INTO v_new;
  ELSE
    v_cp := GREATEST(v_upper, COALESCE(p_checkpoint, v_upper));
    INSERT INTO public.mcp_feed_cursors (user_id, client_key, work_item_id, mode, checkpoint)
    VALUES (auth.uid(), p_client, p_work_item_id, 'incremental', v_cp) RETURNING id INTO v_new;
  END IF;
  SELECT array_agg(DISTINCT (e->>'work_item_id')::uuid) INTO v_wis FROM jsonb_array_elements(v_page->'events') e;
  RETURN jsonb_build_object('mode', p_mode, 'events', v_page->'events', 'has_more', v_more,
    'caught_up', NOT v_more, 'next_cursor', 'c1.' || v_new::text,
    'scan_lower_exclusive', jsonb_build_object('change_ts', p_ts, 'kind', p_kind, 'id', p_id),
    'scan_upper_watermark', v_upper, 'checkpoint', v_cp,
    'overlap_window_seconds', 900,
    'freshness', public._mcp_feed_freshness(p_work_item_id, v_wis),
    'limitations', 'Cursor opaco guardado en el servidor, ligado a usuario, cliente de IA y filtro; caduca a los 30 días (entonces usa reconcile_since=checkpoint menos 15 min; nunca se reinicia en silencio). Cada pasada tiene un tope fijo (scan_upper_watermark); al terminarla checkpoint avanza a ese tope y la siguiente pasada relee 15 minutos antes del checkpoint. Cambios seleccionados por revisión (updated_at): incluye correcciones y archivados de filas antiguas; detected_at solo para mostrar. Cada evento muestra el estado ACTUAL de la fila: revisiones intermedias entre consultas se fusionan. Las purgas definitivas no generan evento. updated_at se fija al inicio de la transacción: una transacción que confirme más de 15 minutos después de iniciar puede no aparecer; reconcilia periódicamente. Primera llamada sin cursor: últimos 3 días. Frescura: solo status=success cuenta como consulta exitosa (empty, error, skipped, rejected, pending_upstream y partial no); los intentos diarios internos no son visibles para el usuario. Sin eventos no significa que los proveedores hayan respondido.');
END $function$;

CREATE OR REPLACE FUNCTION public._mcp_client_key()
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT COALESCE((public.mcp_caller_context()->>'oauth_client_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) $function$;
REVOKE ALL ON FUNCTION public._mcp_client_key() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mcp_client_key() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mcp_list_updates(p_cursor text, p_limit integer DEFAULT 100, p_work_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_ck uuid; c public.mcp_feed_cursors%ROWTYPE; v_cid uuid;
  z uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  v_ck := public._mcp_client_key();
  IF p_cursor IS NULL OR p_cursor = '' THEN
    RETURN public._mcp_feed_step(v_ck, p_work_item_id, 'incremental', now() - interval '3 days', '', z, NULL, NULL, p_limit);
  END IF;
  IF p_cursor !~ '^c1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'CURSOR_INVALID: cursor no reconocido (los cursores anteriores a esta versión no son válidos)' USING ERRCODE = 'MCP22'; END IF;
  v_cid := substr(p_cursor, 4)::uuid;
  SELECT * INTO c FROM public.mcp_feed_cursors WHERE id = v_cid AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'CURSOR_INVALID: cursor no reconocido' USING ERRCODE = 'MCP22'; END IF;
  IF c.client_key <> v_ck THEN RAISE EXCEPTION 'CURSOR_FOREIGN: el cursor pertenece a otra conexión' USING ERRCODE = 'MCP22'; END IF;
  IF c.work_item_id IS DISTINCT FROM p_work_item_id THEN RAISE EXCEPTION 'CURSOR_SCOPE_MISMATCH' USING ERRCODE = 'MCP22'; END IF;
  IF c.expires_at < now() THEN
    RAISE EXCEPTION 'CURSOR_EXPIRED: reconcilia con reconcile_since=% (checkpoint menos 15 minutos)',
      COALESCE(c.checkpoint, c.scan_ts) - interval '15 minutes' USING ERRCODE = 'MCP09'; END IF;
  IF c.scan_upper IS NULL THEN
    RETURN public._mcp_feed_step(v_ck, p_work_item_id, 'incremental', c.checkpoint - interval '15 minutes', '', z, NULL, c.checkpoint, p_limit);
  END IF;
  RETURN public._mcp_feed_step(v_ck, p_work_item_id, c.mode, c.scan_ts, c.scan_kind, c.scan_id, c.scan_upper, c.checkpoint, p_limit);
END $function$;

CREATE OR REPLACE FUNCTION public.mcp_reconcile_updates(p_since timestamp with time zone, p_limit integer DEFAULT 100, p_work_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_since IS NULL OR p_since < now() - interval '400 days' OR p_since > now() THEN
    RAISE EXCEPTION 'RECONCILE_RANGE: reconcile_since debe estar dentro de 400 días' USING ERRCODE = 'MCP22'; END IF;
  RETURN public._mcp_feed_step(public._mcp_client_key(), p_work_item_id, 'reconcile', p_since, '',
    '00000000-0000-0000-0000-000000000000'::uuid, NULL, NULL, p_limit);
END $function$;

REVOKE ALL ON FUNCTION public._mcp_feed_page(timestamptz, text, uuid, timestamptz, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._mcp_feed_freshness(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._mcp_feed_step(uuid, uuid, text, timestamptz, text, uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_list_updates(text, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_reconcile_updates(timestamptz, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mcp_feed_page(timestamptz, text, uuid, timestamptz, integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._mcp_feed_freshness(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._mcp_feed_step(uuid, uuid, text, timestamptz, text, uuid, timestamptz, timestamptz, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_list_updates(text, integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mcp_reconcile_updates(timestamptz, integer, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public._mcp_updates_page(timestamptz, text, uuid, integer, uuid, text) IS 'DEPRECATED: replaced by _mcp_feed_page/_mcp_feed_step (server-stored cursors, fixed watermark).';
REVOKE ALL ON FUNCTION public._mcp_updates_page(timestamptz, text, uuid, integer, uuid, text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.mcp_create_work_item(text, text, text, text, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mcp_work_item_lifecycle(uuid, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mcp_move_work_item_stage(uuid, text, timestamptz, text[], text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mcp_resolve_stage_suggestion(uuid, text, timestamptz, text[], text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mcp_resolve_alert(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mcp_set_notification_state(uuid[], text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mcp_resolve_email_question(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mcp_add_email_association(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mcp_resolve_detected_process(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;