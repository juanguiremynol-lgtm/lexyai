CREATE FUNCTION public.mcp_update_work_item(p_work_item_id uuid,p_patch jsonb,p_monitoring_enabled boolean DEFAULT NULL,p_monitoring_off_reason text DEFAULT NULL,p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE w public.work_items%ROWTYPE; v public.work_items%ROWTYPE; saved public.work_items%ROWTYPE; prior jsonb; before_json jsonb; k text; n int; key text:=COALESCE(p_idempotency_key,gen_random_uuid()::text);
BEGIN
 PERFORM public.mcp_assert_write();
 IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' THEN RAISE EXCEPTION 'INVALID_PATCH: objeto requerido' USING ERRCODE='MCP22'; END IF;
 FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
  IF NOT (k=ANY(ARRAY['title','description','demandantes','demandados','authority_name','authority_email','authority_city','expediente_url','client_id','is_flagged','email_linking_enabled'])) THEN RAISE EXCEPTION 'INVALID_PATCH: campo no editable %',k USING ERRCODE='MCP22'; END IF;
  IF k IN ('is_flagged','email_linking_enabled') THEN
   IF jsonb_typeof(p_patch->k) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'INVALID_PATCH: boolean requerido' USING ERRCODE='MCP22'; END IF;
  ELSE
   IF jsonb_typeof(p_patch->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_PATCH: texto requerido' USING ERRCODE='MCP22'; END IF;
   IF length(p_patch->>k)>(CASE k WHEN 'title' THEN 300 WHEN 'description' THEN 4000 WHEN 'authority_email' THEN 200 WHEN 'authority_city' THEN 120 WHEN 'authority_name' THEN 300 WHEN 'expediente_url' THEN 2000 WHEN 'client_id' THEN 36 ELSE 1000 END) THEN RAISE EXCEPTION 'INVALID_PATCH: texto demasiado largo' USING ERRCODE='MCP22'; END IF;
  END IF;
 END LOOP;
 IF p_patch='{}'::jsonb AND p_monitoring_enabled IS NULL THEN RAISE EXCEPTION 'INVALID_PATCH: sin cambios' USING ERRCODE='MCP22'; END IF;
 IF p_monitoring_enabled=false AND (p_monitoring_off_reason IS NULL OR length(btrim(p_monitoring_off_reason))<3 OR length(btrim(p_monitoring_off_reason))>500) THEN RAISE EXCEPTION 'REASON_REQUIRED: motivo de pausa entre 3 y 500 caracteres' USING ERRCODE='MCP22'; END IF;
 SELECT * INTO w FROM public.work_items WHERE id=p_work_item_id FOR UPDATE;
 IF NOT FOUND OR w.owner_id IS DISTINCT FROM auth.uid() OR w.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND: asunto no encontrado' USING ERRCODE='MCP04'; END IF;
 v:=jsonb_populate_record(w,p_patch);
 IF p_patch?'client_id' AND NOT EXISTS(SELECT 1 FROM public.clients WHERE id=v.client_id AND owner_id=auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'NOT_FOUND: cliente no encontrado' USING ERRCODE='MCP04'; END IF;
 prior:=public._mcp_begin('update_work_item',key,jsonb_build_object('id',p_work_item_id,'patch',p_patch,'monitoring',p_monitoring_enabled,'reason',p_monitoring_off_reason));
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 before_json:=to_jsonb(w);
 UPDATE public.work_items SET title=v.title,description=v.description,demandantes=v.demandantes,demandados=v.demandados,authority_name=v.authority_name,authority_email=v.authority_email,authority_city=v.authority_city,expediente_url=v.expediente_url,client_id=v.client_id,is_flagged=v.is_flagged,email_linking_enabled=v.email_linking_enabled,updated_at=now() WHERE id=w.id;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'NOT_FOUND: no se actualizó el asunto' USING ERRCODE='MCP04'; END IF;
 IF p_monitoring_enabled=true THEN PERFORM public.resume_work_item_monitoring(w.id);
 ELSIF p_monitoring_enabled=false THEN PERFORM public.suspend_work_item_monitoring(w.id,p_monitoring_off_reason); END IF;
 SELECT * INTO saved FROM public.work_items WHERE id=w.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'READBACK_FAILED' USING ERRCODE='MCP09'; END IF;
 RETURN public._mcp_finish('update_work_item',key,jsonb_build_object('ok',true,'work_item',jsonb_build_object('id',saved.id,'radicado',saved.radicado,'title',saved.title,'description',saved.description,'demandantes',saved.demandantes,'demandados',saved.demandados,'authority_name',saved.authority_name,'authority_email',saved.authority_email,'authority_city',saved.authority_city,'expediente_url',saved.expediente_url,'client_id',saved.client_id,'is_flagged',saved.is_flagged,'email_linking_enabled',saved.email_linking_enabled,'monitoring_enabled',saved.monitoring_enabled,'monitoring_disabled_by',saved.monitoring_disabled_by,'monitoring_disabled_reason',saved.monitoring_disabled_reason,'updated_at',saved.updated_at),'idempotency_key',key),'work_item',saved.id,before_json,to_jsonb(saved));
END $fn$;
REVOKE ALL ON FUNCTION public.mcp_update_work_item(uuid,jsonb,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_update_work_item(uuid,jsonb,boolean,text,text) TO service_role;
CREATE FUNCTION public.mcp_mutation_availability() RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $fn$
DECLARE tools jsonb:='{}'; r record; executable boolean; authorized boolean:=public.mcp_write_allowed();
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('create_work_item','public.mcp_create_work_item(text,text,text,text,uuid,text,text,text,text,text)'),
 ('change_work_item_lifecycle','public.mcp_work_item_lifecycle(uuid,text,timestamptz,text,text)'),
 ('move_work_item_stage','public.mcp_move_work_item_stage(uuid,text,timestamptz,text[],text,text)'),
 ('resolve_stage_suggestion','public.mcp_resolve_stage_suggestion(uuid,text,timestamptz,text[],text,text)'),
 ('resolve_alert','public.mcp_resolve_alert(uuid,text,text,text)'),
 ('set_notification_state','public.mcp_set_notification_state(uuid[],text,timestamptz,text)'),
 ('resolve_email_question','public.mcp_resolve_email_question(uuid,text,text)'),
 ('add_email_association','public.mcp_add_email_association(uuid,uuid,text)'),
 ('resolve_detected_process','public.mcp_resolve_detected_process(uuid,text,uuid,text)'),
 ('assign_work_item_radicado','public.mcp_assign_work_item_radicado(uuid,text,timestamptz,text)'),
 ('update_work_item','public.mcp_update_work_item(uuid,jsonb,boolean,text,text)'),
 ('add_note','public.append_work_item_note(uuid,text)')) g(tool,signature) LOOP
 executable:=COALESCE(has_function_privilege(current_user,to_regprocedure(r.signature),'EXECUTE'),false);
 tools:=tools||jsonb_build_object(r.tool,jsonb_build_object('execution_available',executable,'available',executable AND authorized));
 END LOOP;
 FOR r IN SELECT * FROM (VALUES('add_hearing','public.work_item_hearings','INSERT'),('manage_deadline','public.work_item_deadlines','INSERT,UPDATE'),('manage_task','public.work_item_tasks','INSERT,UPDATE'),('whatsapp_prepare','public.client_wa_consent','INSERT,UPDATE')) g(tool,tbl,privs) LOOP
 executable:=COALESCE(has_table_privilege(current_user,to_regclass(r.tbl),r.privs),false);
 IF r.tool='whatsapp_prepare' THEN executable:=executable AND COALESCE(has_table_privilege(current_user,to_regclass('public.client_wa_drafts'),'UPDATE'),false) AND COALESCE(has_function_privilege(current_user,to_regprocedure('public.client_wa_generate_drafts(uuid,integer)'),'EXECUTE'),false); END IF;
 tools:=tools||jsonb_build_object(r.tool,jsonb_build_object('execution_available',executable,'available',executable AND authorized));
 END LOOP;
 RETURN jsonb_build_object('verified',true,'tools',tools,'permission',public.mcp_access_level());
END $fn$;
REVOKE ALL ON FUNCTION public.mcp_mutation_availability() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_mutation_availability() TO authenticated,service_role;
DO $repair$ DECLARE s text; old text:='ORDER BY t.work_item_id, t.provider, t.operation, COALESCE(t.finished_at, t.started_at, t.created_at) DESC'; BEGIN
 SELECT pg_get_functiondef('public._mcp_feed_freshness(uuid,uuid[])'::regprocedure) INTO s;
 IF strpos(s,old)=0 THEN RAISE EXCEPTION 'freshness ordering anchor mismatch'; END IF;
 s:=replace(s,old,old||', t.id DESC'); EXECUTE s;
END $repair$;
