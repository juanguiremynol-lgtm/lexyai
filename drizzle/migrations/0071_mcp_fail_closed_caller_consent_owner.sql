-- 0071: fail-closed MCP caller/consent/owner semantics (review patch 2026-10-24).
-- Additive replacement of helper bodies; signatures unchanged. Keeps the
-- narrower token-scope restriction (andromeda:read without andromeda:manage => read)
-- and the existing explicit trusted-backend definition (_mcp_is_trusted_backend).

CREATE OR REPLACE FUNCTION public.mcp_caller_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid; v_role text; v_claims jsonb;
  v_sid uuid; v_claim_client uuid; v_sess record; v_consent record;
BEGIN
  BEGIN
    v_uid := auth.uid();
    v_role := auth.role();
    v_claims := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'invalid', 'unverified_reason', 'MALFORMED_CLAIMS');
  END;
  IF jsonb_typeof(v_claims) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'invalid', 'unverified_reason', 'MALFORMED_CLAIMS');
  END IF;
  IF v_uid IS NULL AND public._mcp_is_trusted_backend() THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'maintenance', 'trusted_maintenance', true);
  END IF;
  IF v_uid IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'anonymous', 'unverified_reason', 'AUTHENTICATED_USER_REQUIRED');
  END IF;
  BEGIN
    v_sid := NULLIF(v_claims->>'session_id', '')::uuid;
    v_claim_client := NULLIF(v_claims->>'client_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'MALFORMED_CLAIMS');
  END;
  IF v_sid IS NULL THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'NO_SESSION');
  END IF;
  SELECT s.id, s.user_id, s.oauth_client_id, s.scopes, s.not_after INTO v_sess
    FROM auth.sessions s WHERE s.id = v_sid AND s.user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'SESSION_NOT_FOUND');
  END IF;
  IF v_sess.not_after IS NOT NULL AND v_sess.not_after <= now() THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'SESSION_EXPIRED');
  END IF;
  -- Both sides must agree: OAuth session without claim, or native session with claim, is invalid.
  IF v_sess.oauth_client_id IS DISTINCT FROM v_claim_client THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'CLIENT_MISMATCH');
  END IF;
  IF v_sess.oauth_client_id IS NULL THEN
    RETURN jsonb_build_object('authenticated', true, 'surface', 'first_party', 'user_id', v_uid,
      'session_id', v_sid, 'session_found', true, 'oauth_client_id', NULL,
      'unverified_reason', NULL, 'token_scopes', v_sess.scopes);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.oauth_clients cl WHERE cl.id = v_sess.oauth_client_id AND cl.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'CLIENT_DELETED');
  END IF;
  SELECT oc.id, oc.granted_at INTO v_consent
    FROM auth.oauth_consents oc
   WHERE oc.user_id = v_uid AND oc.client_id = v_sess.oauth_client_id AND oc.revoked_at IS NULL
   ORDER BY oc.granted_at DESC, oc.id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'unverified', 'unverified_reason', 'CONSENT_INACTIVE');
  END IF;
  RETURN jsonb_build_object('authenticated', true, 'surface', 'oauth_client', 'user_id', v_uid,
    'session_id', v_sid, 'session_found', true, 'oauth_client_id', v_sess.oauth_client_id,
    'unverified_reason', NULL, 'token_scopes', v_sess.scopes,
    'consent_id', v_consent.id, 'consent_granted_at', v_consent.granted_at);
END $function$;

CREATE OR REPLACE FUNCTION public.mcp_access_level()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE c jsonb := public.mcp_caller_context(); v_level text; v_scopes text;
BEGIN
  IF c->>'surface' = 'maintenance' AND COALESCE((c->>'trusted_maintenance')::boolean, false) THEN
    RETURN 'maintenance';
  END IF;
  IF NOT COALESCE((c->>'authenticated')::boolean, false) THEN RETURN 'none'; END IF;
  IF c->>'surface' = 'first_party' THEN RETURN 'first_party'; END IF;
  IF c->>'surface' IS DISTINCT FROM 'oauth_client' THEN RETURN 'none'; END IF;
  -- Only the grant bound to the caller's current consent generation counts.
  SELECT g.access_level INTO v_level
    FROM public.mcp_client_grants g
    JOIN auth.oauth_consents oc ON oc.id = g.consent_id
   WHERE g.user_id = (c->>'user_id')::uuid
     AND g.oauth_client_id = (c->>'oauth_client_id')::uuid
     AND g.revoked_at IS NULL
     AND oc.user_id = g.user_id AND oc.client_id = g.oauth_client_id
     AND oc.revoked_at IS NULL AND oc.granted_at = g.consent_granted_at
     AND oc.id = (c->>'consent_id')::uuid
     AND oc.granted_at = (c->>'consent_granted_at')::timestamptz
   LIMIT 1;
  v_level := CASE WHEN v_level = 'manage' THEN 'manage' ELSE 'read' END;
  -- Narrower token scope still restricts an app grant.
  v_scopes := COALESCE(c->>'token_scopes', '');
  IF v_scopes ~ '(^|\s)andromeda:read(\s|$)' AND v_scopes !~ '(^|\s)andromeda:manage(\s|$)' THEN
    v_level := 'read';
  END IF;
  RETURN v_level;
END $function$;

CREATE OR REPLACE FUNCTION public.mcp_write_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$ SELECT COALESCE(public.mcp_access_level() IN ('first_party', 'manage', 'maintenance'), false) $function$;

CREATE OR REPLACE FUNCTION public.mcp_assert_write()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NOT public.mcp_write_allowed() THEN
    RAISE EXCEPTION 'MCP_MANAGE_GRANT_REQUIRED: sesión no válida o conexión de IA sin permiso Gestionar; autoriza desde una sesión propia de Andromeda'
      USING ERRCODE = 'MCP01';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public._mcp_can_manage_work_item(p_owner uuid, p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  -- Owner-only (ROLE_AND_SUBSCRIPTION_SPEC §5); p_org kept for signature compatibility.
  SELECT COALESCE(p_owner = auth.uid(), false) AND public.mcp_write_allowed()
$function$;

REVOKE ALL ON FUNCTION public.mcp_caller_context() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_access_level() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_write_allowed() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_assert_write() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_caller_context(), public.mcp_access_level(),
  public.mcp_write_allowed(), public.mcp_assert_write() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_can_manage_work_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mcp_can_manage_work_item(uuid, uuid) TO service_role;
