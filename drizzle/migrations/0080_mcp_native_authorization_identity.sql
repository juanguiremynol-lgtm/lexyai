CREATE OR REPLACE FUNCTION public.mcp_native_authorization_identity(p_authorization_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE c jsonb := public._mcp_require_first_party(); a record;
BEGIN
  SELECT oa.client_id, cl.client_name, oa.scope INTO a
  FROM auth.oauth_authorizations oa
  JOIN auth.oauth_clients cl ON cl.id = oa.client_id AND cl.deleted_at IS NULL
  WHERE oa.authorization_id = p_authorization_id AND oa.user_id = auth.uid()
    AND oa.expires_at > now() AND oa.status IN ('pending', 'approved');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MCP_AUTHORIZATION_INVALID: solicitud inexistente o vencida' USING ERRCODE = 'MCP04';
  END IF;
  RETURN jsonb_build_object('client_id', a.client_id, 'client_name', a.client_name, 'scope', a.scope);
END $function$;
REVOKE ALL ON FUNCTION public.mcp_native_authorization_identity(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_native_authorization_identity(text) TO authenticated;
COMMENT ON FUNCTION public.mcp_native_authorization_identity(text) IS 'Read-only native consent identity; owner, live native session, unexpired authorization and active client required. No OAuth code, state or token returned.';