CREATE OR REPLACE FUNCTION public._mcp_normalize_client_id_number(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$ SELECT NULLIF(regexp_replace(upper(COALESCE(p,'')),'[^0-9A-Z]','','g'),'') $f$;

CREATE FUNCTION public.mcp_create_client(p_name text,p_id_number text,p_email text,p_city text,p_idempotency_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v public.clients%ROWTYPE; prior jsonb; v_norm text; v_existing public.clients%ROWTYPE; v_org uuid;
 n text:=NULLIF(btrim(COALESCE(p_name,'')),''); e text:=NULLIF(lower(btrim(COALESCE(p_email,''))),''); ci text:=NULLIF(btrim(COALESCE(p_city,'')),''); idn text:=NULLIF(btrim(COALESCE(p_id_number,'')),'');
BEGIN
PERFORM public.mcp_assert_write();
IF n IS NULL OR length(n)>300 OR length(COALESCE(idn,''))>60 OR length(COALESCE(ci,''))>120 OR length(COALESCE(e,''))>200 OR (e IS NOT NULL AND e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN RAISE EXCEPTION 'INVALID_CLIENT_FIELDS' USING ERRCODE='MCP22'; END IF;
v_norm:=public._mcp_normalize_client_id_number(idn);
IF idn IS NOT NULL AND v_norm IS NULL THEN RAISE EXCEPTION 'INVALID_ID_NUMBER' USING ERRCODE='MCP22'; END IF;
prior:=public._mcp_begin('create_client',p_idempotency_key,jsonb_build_object('name',n,'id_number',idn,'email',e,'city',ci));
IF prior IS NOT NULL THEN RETURN prior; END IF;
IF v_norm IS NOT NULL THEN
 -- Serializes concurrent creations for the same owner+identification (different keys).
 PERFORM pg_advisory_xact_lock(hashtextextended('mcp_client:'||auth.uid()::text||':'||v_norm,0));
 SELECT * INTO v_existing FROM public.clients WHERE owner_id=auth.uid() AND public._mcp_normalize_client_id_number(id_number)=v_norm ORDER BY deleted_at NULLS FIRST, created_at LIMIT 1;
 IF FOUND THEN
  RETURN public._mcp_finish('create_client',p_idempotency_key,jsonb_build_object('ok',false,'conflict','IDENTIFICATION_EXISTS','client_id',v_existing.id,'archived',v_existing.deleted_at IS NOT NULL),'client',v_existing.id,NULL,NULL);
 END IF;
END IF;
SELECT organization_id INTO v_org FROM public.organization_memberships WHERE user_id=auth.uid() LIMIT 1;
INSERT INTO public.clients(owner_id,organization_id,name,id_number,city,email) VALUES(auth.uid(),v_org,n,idn,ci,e) RETURNING * INTO v;
RETURN public._mcp_finish('create_client',p_idempotency_key,jsonb_build_object('ok',true,'client',jsonb_build_object('id',v.id,'name',v.name,'id_number',v.id_number,'city',v.city,'email',v.email,'updated_at',v.updated_at)),'client',v.id,NULL,to_jsonb(v));
END $fn$;

CREATE FUNCTION public.mcp_update_client(p_client_id uuid,p_patch jsonb,p_expected_updated_at timestamptz,p_idempotency_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE w public.clients%ROWTYPE; v public.clients%ROWTYPE; prior jsonb; k text; v_norm text; v_other uuid;
 n text; e text; ci text; idn text;
BEGIN
PERFORM public.mcp_assert_write();
IF p_expected_updated_at IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb THEN RAISE EXCEPTION 'PATCH_AND_REVISION_REQUIRED' USING ERRCODE='MCP22'; END IF;
FOR k IN SELECT jsonb_object_keys(p_patch) LOOP IF k NOT IN ('name','id_number','email','city') THEN RAISE EXCEPTION 'UNSUPPORTED_FIELD %',k USING ERRCODE='MCP22'; END IF; END LOOP;
IF p_patch ? 'name' AND (jsonb_typeof(p_patch->'name')<>'string' OR NULLIF(btrim(p_patch->>'name'),'') IS NULL) THEN RAISE EXCEPTION 'NAME_REQUIRED' USING ERRCODE='MCP22'; END IF;
SELECT * INTO w FROM public.clients WHERE id=p_client_id FOR UPDATE;
IF NOT FOUND OR w.owner_id IS DISTINCT FROM auth.uid() OR w.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='MCP04'; END IF;
n:=CASE WHEN p_patch ? 'name' THEN btrim(p_patch->>'name') ELSE w.name END;
idn:=CASE WHEN p_patch ? 'id_number' THEN NULLIF(btrim(COALESCE(p_patch->>'id_number','')),'') ELSE w.id_number END;
e:=CASE WHEN p_patch ? 'email' THEN NULLIF(lower(btrim(COALESCE(p_patch->>'email',''))),'') ELSE w.email END;
ci:=CASE WHEN p_patch ? 'city' THEN NULLIF(btrim(COALESCE(p_patch->>'city','')),'') ELSE w.city END;
IF length(n)>300 OR length(COALESCE(idn,''))>60 OR length(COALESCE(ci,''))>120 OR length(COALESCE(e,''))>200 OR (p_patch ? 'email' AND e IS NOT NULL AND e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN RAISE EXCEPTION 'INVALID_CLIENT_FIELDS' USING ERRCODE='MCP22'; END IF;
prior:=public._mcp_begin('update_client',p_idempotency_key,jsonb_build_object('id',w.id,'patch',p_patch,'revision',p_expected_updated_at));
IF prior IS NOT NULL THEN RETURN prior; END IF;
IF w.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='MCP09'; END IF;
IF p_patch ? 'id_number' THEN
 v_norm:=public._mcp_normalize_client_id_number(idn);
 IF idn IS NOT NULL AND v_norm IS NULL THEN RAISE EXCEPTION 'INVALID_ID_NUMBER' USING ERRCODE='MCP22'; END IF;
 IF v_norm IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('mcp_client:'||auth.uid()::text||':'||v_norm,0));
  SELECT id INTO v_other FROM public.clients WHERE owner_id=auth.uid() AND id<>w.id AND public._mcp_normalize_client_id_number(id_number)=v_norm LIMIT 1;
  IF v_other IS NOT NULL THEN RAISE EXCEPTION 'IDENTIFICATION_EXISTS client_id=%',v_other USING ERRCODE='MCP09'; END IF;
 END IF;
END IF;
UPDATE public.clients SET name=n,id_number=idn,email=e,city=ci WHERE id=w.id RETURNING * INTO v;
RETURN public._mcp_finish('update_client',p_idempotency_key,jsonb_build_object('ok',true,'client',jsonb_build_object('id',v.id,'name',v.name,'id_number',v.id_number,'city',v.city,'email',v.email,'updated_at',v.updated_at)),'client',w.id,to_jsonb(w),to_jsonb(v));
END $fn$;

REVOKE ALL ON FUNCTION public.mcp_create_client(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mcp_update_client(uuid,jsonb,timestamptz,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._mcp_normalize_client_id_number(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_create_client(text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_update_client(uuid,jsonb,timestamptz,text) TO service_role;
COMMENT ON FUNCTION public.mcp_create_client(text,text,text,text,text) IS 'Gated owner/manage client creation; never merges by name; same-owner normalized identification returns an audited conflict with the existing id; advisory lock + idempotency prevent duplicates.';
COMMENT ON FUNCTION public.mcp_update_client(uuid,jsonb,timestamptz,text) IS 'Gated owner/manage client correction of name/id_number/email/city with mandatory expected_updated_at, identification conflict check, idempotency and atomic audit.';

DO $patch$ DECLARE s text; BEGIN SELECT pg_get_functiondef('public.mcp_mutation_availability()'::regprocedure) INTO s; IF strpos(s,'(''add_note'',''public.append_work_item_note(uuid,text)'')')=0 THEN RAISE EXCEPTION 'availability anchor mismatch'; END IF; s:=replace(s,'(''add_note'',''public.append_work_item_note(uuid,text)'')','(''create_client'',''public.mcp_create_client(text,text,text,text,text)''), (''update_client'',''public.mcp_update_client(uuid,jsonb,timestamptz,text)''), (''add_note'',''public.append_work_item_note(uuid,text)'')'); EXECUTE s; END $patch$;