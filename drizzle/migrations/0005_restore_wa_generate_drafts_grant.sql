-- client_wa_generate_drafts already enforces membership (is_org_member) and is
-- called by the lawyer's own screen and by MCP with the caller's JWT. It is not
-- an unauthenticated surface: restore the authenticated grant, keep anon revoked.
GRANT EXECUTE ON FUNCTION public.client_wa_generate_drafts(uuid, integer) TO authenticated;