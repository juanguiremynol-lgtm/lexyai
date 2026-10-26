CREATE FUNCTION public.mcp_correct_hearing(p_hearing_id uuid,p_patch jsonb,p_expected_updated_at timestamptz,p_reason text,p_idempotency_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE h public.work_item_hearings%ROWTYPE; v public.work_item_hearings%ROWTYPE; w public.work_items%ROWTYPE; prior jsonb; k text; BEGIN
PERFORM public.mcp_assert_write();
IF p_reason IS NULL OR length(btrim(p_reason))<5 OR length(p_reason)>2000 OR p_expected_updated_at IS NULL OR p_idempotency_key IS NULL OR length(p_idempotency_key)<8 THEN RAISE EXCEPTION 'REASON_REVISION_KEY_REQUIRED' USING ERRCODE='MCP22'; END IF;
IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb THEN RAISE EXCEPTION 'INVALID_PATCH' USING ERRCODE='MCP22'; END IF;
FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
 IF k<>ALL(ARRAY['scheduled_at','occurred_at','status','modality','location','custom_name']) OR jsonb_typeof(p_patch->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_FIELD %',k USING ERRCODE='MCP22'; END IF;
END LOOP;
SELECT * INTO h FROM public.work_item_hearings WHERE id=p_hearing_id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='MCP04'; END IF;
SELECT * INTO w FROM public.work_items WHERE id=h.work_item_id FOR UPDATE;
IF NOT FOUND OR w.owner_id IS DISTINCT FROM auth.uid() OR w.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='MCP04'; END IF;
prior:=public._mcp_begin('correct_hearing',p_idempotency_key,jsonb_build_object('id',h.id,'patch',p_patch,'revision',p_expected_updated_at,'reason',p_reason));
IF prior IS NOT NULL THEN RETURN prior; END IF;
IF h.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='MCP09'; END IF;
v:=jsonb_populate_record(h,p_patch);
IF v.status='held' AND v.occurred_at IS NULL THEN RAISE EXCEPTION 'OCCURRENCE_REQUIRED' USING ERRCODE='MCP22'; END IF;
IF EXISTS(SELECT 1 FROM public.work_item_hearings WHERE work_item_id=h.work_item_id AND scheduled_at=v.scheduled_at AND id<>h.id) THEN RAISE EXCEPTION 'DUPLICATE_HEARING' USING ERRCODE='MCP09'; END IF;
UPDATE public.work_item_hearings SET scheduled_at=v.scheduled_at,occurred_at=v.occurred_at,status=v.status,modality=v.modality,location=v.location,custom_name=v.custom_name,updated_at=now(),updated_by=auth.uid() WHERE id=h.id RETURNING * INTO v;
INSERT INTO public.hearing_audit_log(organization_id,user_id,action,work_item_id,work_item_hearing_id,detail) VALUES(w.organization_id,auth.uid(),'MCP_CORRECTION',w.id,h.id,jsonb_build_object('before',to_jsonb(h),'after',to_jsonb(v),'reason',p_reason));
RETURN public._mcp_finish('correct_hearing',p_idempotency_key,jsonb_build_object('ok',true,'hearing',to_jsonb(v)),'hearing',h.id,to_jsonb(h),to_jsonb(v)); END $fn$;
REVOKE ALL ON FUNCTION public.mcp_correct_hearing(uuid,jsonb,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_correct_hearing(uuid,jsonb,timestamptz,text,text) TO service_role;
COMMENT ON FUNCTION public.mcp_correct_hearing(uuid,jsonb,timestamptz,text,text) IS 'Gated release: owner/manage, optimistic revision, idempotency, audit, original event identity preserved; no delete.';