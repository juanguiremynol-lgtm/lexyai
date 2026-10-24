CREATE OR REPLACE FUNCTION public.mcp_native_authorization_identity(p_authorization_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE c jsonb := public._mcp_require_first_party(); a record;
BEGIN
  SELECT oa.client_id, cl.client_name, oa.scope INTO a
  FROM auth.oauth_authorizations AS oa
  JOIN auth.oauth_clients AS cl ON cl.id = oa.client_id AND cl.deleted_at IS NULL
  WHERE oa.authorization_id = p_authorization_id AND oa.user_id = auth.uid()
    AND oa.expires_at > pg_catalog.now() AND oa.status IN ('pending', 'approved');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUTHORIZATION_UNAVAILABLE' USING ERRCODE = 'MCP04';
  END IF;
  RETURN pg_catalog.jsonb_build_object('client', pg_catalog.jsonb_build_object('id', a.client_id, 'name', a.client_name), 'scope', a.scope);
END $function$;
REVOKE ALL ON FUNCTION public.mcp_native_authorization_identity(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_native_authorization_identity(text) TO authenticated;
COMMENT ON FUNCTION public.mcp_native_authorization_identity(text) IS 'Native-only read-only identity for owned bound unexpired pending/approved authorization; uniform unavailable error; no codes/state/tokens.';