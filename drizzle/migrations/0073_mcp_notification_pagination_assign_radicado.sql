CREATE INDEX IF NOT EXISTS notifications_created_id_cursor_idx ON public.notifications (created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.mcp_list_notifications(p_limit integer DEFAULT 30, p_include_dismissed boolean DEFAULT false, p_cursor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
DECLARE v_uid uuid := auth.uid(); v_lim int := LEAST(GREATEST(COALESCE(p_limit,30),1),100);
 v_c jsonb; v_ts timestamptz; v_id uuid; v_rows jsonb; v_count int; v_last jsonb;
BEGIN
 IF v_uid IS NULL OR public.mcp_access_level() NOT IN ('read','manage','first_party') THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
 IF p_cursor IS NOT NULL THEN
  BEGIN
   v_c := convert_from(decode(p_cursor,'base64'),'UTF8')::jsonb;
   v_ts := (v_c->>'t')::timestamptz; v_id := (v_c->>'id')::uuid;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'CURSOR_INVALID' USING ERRCODE='MCP22'; END;
  IF v_ts IS NULL OR v_id IS NULL OR v_c->>'v' IS DISTINCT FROM '1' OR v_c->>'u' IS DISTINCT FROM v_uid::text OR (v_c->>'d')::boolean IS DISTINCT FROM COALESCE(p_include_dismissed,false) THEN
   RAISE EXCEPTION 'CURSOR_INVALID: user or filter mismatch' USING ERRCODE='MCP22'; END IF;
 END IF;
 -- Invoker RLS and the explicit user join isolate shared notification state.
 -- Any state relation/query failure propagates; never substitute an empty state.
 WITH page AS (
  SELECT n.id,n.title,n.created_at,n.work_item_id,n.category,n.severity,s.read_at,s.dismissed_at,s.snoozed_until
  FROM public.notifications n LEFT JOIN public.notification_user_state s ON s.notification_id=n.id AND s.user_id=v_uid
  WHERE (COALESCE(p_include_dismissed,false) OR s.dismissed_at IS NULL)
   AND (v_ts IS NULL OR (n.created_at,n.id)<(v_ts,v_id))
  ORDER BY n.created_at DESC,n.id DESC LIMIT v_lim+1
 ) SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,id DESC),'[]'::jsonb),count(*) INTO v_rows,v_count FROM page;
 IF v_count>v_lim THEN v_rows:=v_rows-v_lim; END IF;
 v_last:=v_rows->(jsonb_array_length(v_rows)-1);
 RETURN jsonb_build_object('notifications',v_rows,'has_more',v_count>v_lim,'next_cursor',CASE WHEN v_count>v_lim THEN
 replace(encode(convert_to(jsonb_build_object('v',1,'u',v_uid,'d',COALESCE(p_include_dismissed,false),'t',v_last->>'created_at','id',v_last->>'id')::text,'UTF8'),'base64'),E'\n','') END);
END $fn$;
REVOKE ALL ON FUNCTION public.mcp_list_notifications(integer,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_list_notifications(integer,boolean,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.mcp_assign_work_item_radicado(p_work_item_id uuid,p_radicado text,p_expected_updated_at timestamptz,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_prior jsonb; v_w public.work_items%ROWTYPE; v_dup record; v_digits text;
 v_before jsonb; v_after jsonb; v_lifecycle jsonb; v_max int; v_n int; v_monitor boolean;
BEGIN
 v_prior:=public._mcp_begin('assign_work_item_radicado',p_idempotency_key,jsonb_build_object('id',p_work_item_id,'radicado',p_radicado,'expected_updated_at',p_expected_updated_at));
 IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
 IF p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'expected_updated_at es obligatorio' USING ERRCODE='MCP22'; END IF;
 v_digits:=regexp_replace(COALESCE(p_radicado,''),'[^0-9]','','g');
 IF length(v_digits)<>23 THEN RAISE EXCEPTION 'el radicado debe tener exactamente 23 dígitos' USING ERRCODE='MCP22'; END IF;
 -- Serializes owner identity allocation; the existing unique index is the final race barrier.
 PERFORM pg_advisory_xact_lock(hashtextextended('mcp-radicado:'||auth.uid()::text,0));
 SELECT * INTO v_w FROM public.work_items WHERE id=p_work_item_id FOR UPDATE;
 IF NOT FOUND OR NOT public._mcp_can_manage_work_item(v_w.owner_id,v_w.organization_id) THEN RAISE EXCEPTION 'NOT_FOUND: asunto no encontrado' USING ERRCODE='MCP04'; END IF;
 IF v_w.lifecycle_state IS DISTINCT FROM 'ACTIVE'::public.work_item_lifecycle_state OR v_w.deleted_at IS NOT NULL THEN
  RAISE EXCEPTION 'ACTIVE_REQUIRED: no se reactiva un asunto archivado o eliminado' USING ERRCODE='MCP09'; END IF;
 IF NULLIF(btrim(COALESCE(v_w.radicado,'')),'') IS NOT NULL THEN RAISE EXCEPTION 'RADICADO_ALREADY_SET: no se reemplaza la identidad existente' USING ERRCODE='MCP09'; END IF;
 IF v_w.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'STALE_REVISION: el asunto cambió' USING ERRCODE='MCP09'; END IF;
 SELECT id,deleted_at INTO v_dup FROM public.work_items WHERE owner_id=v_w.owner_id AND workflow_type=v_w.workflow_type AND id<>v_w.id
  AND (radicado=v_digits OR regexp_replace(COALESCE(radicado_digits,radicado,''),'[^0-9]','','g')=v_digits) LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION '%: ya existe este radicado en la cartera, incluida la papelera',CASE WHEN v_dup.deleted_at IS NOT NULL THEN 'DUPLICATE_IN_TRASH' ELSE 'DUPLICATE' END USING ERRCODE='MCP09'; END IF;
 v_monitor:=public.is_provider_monitored_workflow(v_w.workflow_type::text) AND NOT (
  COALESCE(v_w.monitoring_disabled_by,'')='USER' AND COALESCE(btrim(v_w.monitoring_disabled_reason),'')<>'' AND v_w.monitoring_disabled_reason<>'PENDIENTE_DE_RADICACION');
 -- The existing BEFORE limit trigger runs before the invariant by name. Check the prospective
 -- value explicitly under an org lock rather than relying on that trigger seeing the new flag.
 IF v_monitor AND NOT COALESCE(v_w.monitoring_enabled,false) AND v_w.organization_id IS NOT NULL THEN
  PERFORM 1 FROM public.organizations WHERE id=v_w.organization_id FOR UPDATE;
  v_max:=(public.get_effective_limits(v_w.organization_id)->>'max_monitored_items')::int;
  SELECT count(*) INTO v_n FROM public.work_items WHERE organization_id=v_w.organization_id AND monitoring_enabled AND deleted_at IS NULL AND id<>v_w.id;
  IF v_max IS NOT NULL AND v_n>=v_max THEN RAISE EXCEPTION 'Monitoring limit reached: maximum % monitored items for your plan.',v_max USING ERRCODE='P0429'; END IF;
 END IF;
 v_before:=public._mcp_wi_snapshot(v_w.id)||jsonb_build_object('radicado_verified',v_w.radicado_verified,'scrape_status',v_w.scrape_status);
 UPDATE public.work_items SET radicado=v_digits,radicado_verified=false,scrape_status='NOT_ATTEMPTED',consecutive_404_count=0,provider_reachable=true,
  -- This sentinel means missing identity, not a deliberate suspension; preserve all other reasons.
  monitoring_disabled_reason=CASE WHEN monitoring_disabled_reason='PENDIENTE_DE_RADICACION' THEN NULL ELSE monitoring_disabled_reason END,
  monitoring_disabled_by=CASE WHEN monitoring_disabled_reason='PENDIENTE_DE_RADICACION' THEN NULL ELSE monitoring_disabled_by END,
  monitoring_disabled_at=CASE WHEN monitoring_disabled_reason='PENDIENTE_DE_RADICACION' THEN NULL ELSE monitoring_disabled_at END,
  updated_at=clock_timestamp() WHERE id=v_w.id;
 GET DIAGNOSTICS v_n=ROW_COUNT;
 IF v_n<>1 THEN RAISE EXCEPTION 'NOT_FOUND: no se guardó el radicado' USING ERRCODE='MCP04'; END IF;
 -- Same canonical ACTIVE call as AddRadicadoInline, after requiring ACTIVE: always a no-op,
 -- never a restoration or lifecycle/history change. Enrollment is owned by existing triggers.
 v_lifecycle:=public.set_work_item_lifecycle(v_w.id,'ACTIVE','RADICADO_SET','USER',auth.uid(),'{}');
 IF (v_lifecycle->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'LIFECYCLE_FAILED' USING ERRCODE='MCP09'; END IF;
 v_after:=public._mcp_wi_snapshot(v_w.id)||(SELECT jsonb_build_object('radicado_verified',radicado_verified,'scrape_status',scrape_status,'consecutive_404_count',consecutive_404_count,'provider_reachable',provider_reachable) FROM public.work_items WHERE id=v_w.id);
 IF v_after->>'radicado' IS DISTINCT FROM v_digits THEN RAISE EXCEPTION 'READBACK_FAILED' USING ERRCODE='MCP09'; END IF;
 RETURN public._mcp_finish('assign_work_item_radicado',p_idempotency_key,jsonb_build_object('ok',true,'work_item',v_after,'synchronization','scheduled_pending','synced',false,
  'note','Radicado guardado; sincronización programada pendiente. No se consultó ningún proveedor.'),'work_item',v_w.id,v_before,v_after);
END $fn$;
REVOKE ALL ON FUNCTION public.mcp_assign_work_item_radicado(uuid,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_assign_work_item_radicado(uuid,text,timestamptz,text) TO service_role;
COMMENT ON FUNCTION public.mcp_assign_work_item_radicado(uuid,text,timestamptz,text) IS 'Review gated. Assign once to owned ACTIVE empty matter only; no providers, restore, stage/workflow replacement or purge. Tests grant EXECUTE transaction-locally.';