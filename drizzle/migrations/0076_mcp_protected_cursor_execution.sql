CREATE ROLE mcp_feed_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
GRANT authenticated TO mcp_feed_executor;
DO $membership$ BEGIN EXECUTE format('GRANT mcp_feed_executor TO %I',current_user); END $membership$;
GRANT USAGE ON SCHEMA public,auth TO mcp_feed_executor;
GRANT CREATE ON SCHEMA public TO mcp_feed_executor;
DO $auth$ DECLARE s text; BEGIN
 SELECT pg_get_functiondef('public.mcp_caller_context()'::regprocedure) INTO s;
 IF strpos(s,'IF v_uid IS NULL OR v_role IS DISTINCT FROM ''authenticated'' THEN')=0 THEN RAISE EXCEPTION 'auth anchor mismatch'; END IF;
 s:=replace(s,'IF v_uid IS NULL OR v_role IS DISTINCT FROM ''authenticated'' THEN','IF v_uid IS NULL OR v_role IS DISTINCT FROM ''authenticated'' OR v_claims->>''role'' IS DISTINCT FROM ''authenticated'' THEN'); EXECUTE s;
END $auth$;
CREATE POLICY mcp_cursor_client_scope ON public.mcp_feed_cursors AS RESTRICTIVE FOR ALL TO authenticated USING (
 user_id=auth.uid() AND COALESCE((public.mcp_caller_context()->>'authenticated')::boolean,false)
 AND client_key=COALESCE((public.mcp_caller_context()->>'oauth_client_id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
) WITH CHECK (
 user_id=auth.uid() AND COALESCE((public.mcp_caller_context()->>'authenticated')::boolean,false)
 AND client_key=COALESCE((public.mcp_caller_context()->>'oauth_client_id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE POLICY mcp_cursor_server_insert ON public.mcp_feed_cursors AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (current_user='mcp_feed_executor');
REVOKE INSERT,UPDATE ON public.mcp_feed_cursors FROM authenticated,anon;
GRANT SELECT,INSERT,DELETE ON public.mcp_feed_cursors TO mcp_feed_executor;
REVOKE ALL ON FUNCTION public._mcp_feed_step(uuid,uuid,text,timestamptz,text,uuid,timestamptz,timestamptz,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._mcp_feed_step(uuid,uuid,text,timestamptz,text,uuid,timestamptz,timestamptz,integer) TO mcp_feed_executor;
DO $steps$ DECLARE s text; BEGIN
 SELECT pg_get_functiondef('public._mcp_feed_step(uuid,uuid,text,timestamptz,text,uuid,timestamptz,timestamptz,integer)'::regprocedure) INTO s;
 s:=replace(s,'BEGIN','BEGIN
 IF current_user <> ''mcp_feed_executor'' THEN RAISE EXCEPTION ''CURSOR_SERVER_ONLY'' USING ERRCODE=''42501''; END IF;
 IF NOT COALESCE((public.mcp_caller_context()->>''authenticated'')::boolean,false) THEN RAISE EXCEPTION ''not authenticated'' USING ERRCODE=''42501''; END IF;
 p_client:=public._mcp_client_key();
 IF p_ts IS NULL OR p_ts < now()-interval ''401 days'' OR p_ts>v_upper OR v_upper>now() OR p_checkpoint>v_upper OR p_mode NOT IN (''incremental'',''reconcile'') THEN RAISE EXCEPTION ''CURSOR_BOUNDS_INVALID'' USING ERRCODE=''MCP22''; END IF;'); EXECUTE s;
END $steps$;
DO $wrappers$ DECLARE s text; sig text; BEGIN
 FOREACH sig IN ARRAY ARRAY['public.mcp_list_updates(text,integer,uuid)','public.mcp_reconcile_updates(timestamptz,integer,uuid)'] LOOP
 SELECT pg_get_functiondef(sig::regprocedure) INTO s;
 s:=replace(s,'BEGIN','BEGIN
 IF NOT COALESCE((public.mcp_caller_context()->>''authenticated'')::boolean,false) THEN RAISE EXCEPTION ''not authenticated'' USING ERRCODE=''42501''; END IF;'); EXECUTE s;
 END LOOP;
END $wrappers$;
ALTER FUNCTION public.mcp_list_updates(text,integer,uuid) SECURITY DEFINER;
ALTER FUNCTION public.mcp_reconcile_updates(timestamptz,integer,uuid) SECURITY DEFINER;
ALTER FUNCTION public.mcp_list_updates(text,integer,uuid) OWNER TO mcp_feed_executor;
ALTER FUNCTION public.mcp_reconcile_updates(timestamptz,integer,uuid) OWNER TO mcp_feed_executor;
REVOKE CREATE ON SCHEMA public FROM mcp_feed_executor;
COMMENT ON FUNCTION public._mcp_feed_step(uuid,uuid,text,timestamptz,text,uuid,timestamptz,timestamptz,integer) IS 'Internal invoker; only non-BYPASSRLS mcp_feed_executor may issue server cursors. No authenticated direct EXECUTE.';