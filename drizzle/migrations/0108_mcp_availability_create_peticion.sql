CREATE OR REPLACE FUNCTION public.mcp_mutation_availability()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE tools jsonb:='{}'; r record; executable boolean; authorized boolean:=public.mcp_write_allowed();
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('create_work_item','public.mcp_create_work_item(text,text,text,text,uuid,text,text,text,text,text)'),
 ('create_peticion','public.mcp_create_peticion(text,uuid,text,text,text,boolean,date,text,text,text,text[],text)'),
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
 ('correct_hearing','public.mcp_correct_hearing(uuid,jsonb,timestamptz,text,text)'), ('reclassify_work_item','public.mcp_reclassify_work_item(uuid,text,text,timestamptz,text,text)'), ('create_client','public.mcp_create_client(text,text,text,text,text)'), ('update_client','public.mcp_update_client(uuid,jsonb,timestamptz,text)'), ('add_note','public.append_work_item_note(uuid,text)')) g(tool,signature) LOOP
 executable:=COALESCE(has_function_privilege(current_user,to_regprocedure(r.signature),'EXECUTE'),false);
 tools:=tools||jsonb_build_object(r.tool,jsonb_build_object('execution_available',executable,'available',executable AND authorized));
 END LOOP;
 FOR r IN SELECT * FROM (VALUES('add_hearing','public.work_item_hearings','INSERT'),('manage_deadline','public.work_item_deadlines','INSERT,UPDATE'),('manage_task','public.work_item_tasks','INSERT,UPDATE'),('whatsapp_prepare','public.client_wa_consent','INSERT,UPDATE')) g(tool,tbl,privs) LOOP
 executable:=COALESCE(has_table_privilege(current_user,to_regclass(r.tbl),r.privs),false);
 IF r.tool='whatsapp_prepare' THEN executable:=executable AND COALESCE(has_table_privilege(current_user,to_regclass('public.client_wa_drafts'),'UPDATE'),false) AND COALESCE(has_function_privilege(current_user,to_regprocedure('public.client_wa_generate_drafts(uuid,integer)'),'EXECUTE'),false); END IF;
 tools:=tools||jsonb_build_object(r.tool,jsonb_build_object('execution_available',executable,'available',executable AND authorized));
 END LOOP;
 RETURN jsonb_build_object('verified',true,'tools',tools,'permission',public.mcp_access_level());
END $function$;