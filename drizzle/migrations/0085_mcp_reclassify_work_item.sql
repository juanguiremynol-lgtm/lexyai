CREATE FUNCTION public.mcp_reclassify_work_item(p_work_item_id uuid,p_workflow_type text,p_stage text,p_expected_updated_at timestamptz,p_reason text,p_idempotency_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE w public.work_items%ROWTYPE; v public.work_items%ROWTYPE; prior jsonb; BEGIN
PERFORM public.mcp_assert_write();
IF p_expected_updated_at IS NULL OR length(btrim(COALESCE(p_reason,'')))<5 OR length(p_reason)>2000 OR length(COALESCE(p_idempotency_key,''))<8 THEN RAISE EXCEPTION 'REASON_REVISION_KEY_REQUIRED' USING ERRCODE='MCP22'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='workflow_type' AND e.enumlabel=p_workflow_type) THEN RAISE EXCEPTION 'INVALID_WORKFLOW' USING ERRCODE='MCP22'; END IF;
IF public._mcp_is_catalog_governed(p_workflow_type) THEN
 IF NOT EXISTS(SELECT 1 FROM public.workflow_stages_global WHERE workflow_type=p_workflow_type AND code=p_stage AND active) THEN RAISE EXCEPTION 'INVALID_STAGE' USING ERRCODE='MCP22'; END IF;
ELSE
 IF NOT EXISTS(SELECT 1 FROM public._mcp_stage_vocab() WHERE workflow_type=p_workflow_type AND code=p_stage AND target_allowed) THEN RAISE EXCEPTION 'INVALID_STAGE' USING ERRCODE='MCP22'; END IF;
END IF;
SELECT * INTO w FROM public.work_items WHERE id=p_work_item_id FOR UPDATE;
IF NOT FOUND OR w.owner_id IS DISTINCT FROM auth.uid() OR w.deleted_at IS NOT NULL OR w.lifecycle_state<>'ACTIVE' THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='MCP04'; END IF;
prior:=public._mcp_begin('reclassify_work_item',p_idempotency_key,jsonb_build_object('id',w.id,'workflow',p_workflow_type,'stage',p_stage,'revision',p_expected_updated_at,'reason',p_reason));
IF prior IS NOT NULL THEN RETURN prior; END IF;
IF w.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='MCP09'; END IF;
UPDATE public.work_items SET workflow_type=p_workflow_type::public.workflow_type,stage=p_stage,last_stage_change_source='MANUAL_USER',last_stage_change_at=now(),last_stage_change_by_user_id=auth.uid(),updated_at=now() WHERE id=w.id RETURNING * INTO v;
IF w.organization_id IS NOT NULL THEN INSERT INTO public.work_item_stage_audit(work_item_id,organization_id,actor_user_id,previous_stage,previous_cgp_phase,new_stage,new_cgp_phase,change_source,reason,metadata) VALUES(w.id,w.organization_id,auth.uid(),w.stage,w.cgp_phase::text,v.stage,v.cgp_phase::text,'MANUAL_USER',p_reason,jsonb_build_object('before_workflow',w.workflow_type,'after_workflow',v.workflow_type,'via','mcp_reclassification')); END IF;
RETURN public._mcp_finish('reclassify_work_item',p_idempotency_key,jsonb_build_object('ok',true,'work_item',to_jsonb(v)),'work_item',w.id,to_jsonb(w),to_jsonb(v)); END $fn$;
REVOKE ALL ON FUNCTION public.mcp_reclassify_work_item(uuid,text,text,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_reclassify_work_item(uuid,text,text,timestamptz,text,text) TO service_role;
COMMENT ON FUNCTION public.mcp_reclassify_work_item(uuid,text,text,timestamptz,text,text) IS 'Gated owner/manage explicit reclassification, live target-stage validation, optimistic revision, idempotency and audit; no child records rewritten and no radicado change.';