-- MCP per-user operational management: grants, idempotency, audit, gated writes.

CREATE OR REPLACE FUNCTION public.mcp_caller_context()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_claims jsonb := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_sid uuid;
  v_claim_client uuid;
  v_sess record;
  v_client uuid;
  v_found boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('authenticated', false, 'surface', 'anonymous');
  END IF;
  BEGIN v_sid := NULLIF(v_claims->>'session_id', '')::uuid; EXCEPTION WHEN others THEN v_sid := NULL; END;
  BEGIN v_claim_client := NULLIF(v_claims->>'client_id', '')::uuid; EXCEPTION WHEN others THEN v_claim_client := NULL; END;
  IF v_sid IS NOT NULL THEN
    SELECT s.id, s.oauth_client_id, s.scopes INTO v_sess
      FROM auth.sessions s WHERE s.id = v_sid AND s.user_id = v_uid;
    v_found := FOUND;
  END IF;
  v_client := CASE WHEN v_found THEN v_sess.oauth_client_id ELSE NULL END;
  IF v_client IS NULL AND v_claim_client IS NOT NULL THEN v_client := v_claim_client; END IF;
  RETURN jsonb_build_object(
    'authenticated', true,
    'user_id', v_uid,
    'session_id', v_sid,
    'session_found', v_found,
    'oauth_client_id', v_client,
    'surface', CASE
      WHEN v_client IS NOT NULL THEN 'oauth_client'
      WHEN v_found THEN 'first_party'
      ELSE 'unverified' END,
    'token_scopes', CASE WHEN v_found THEN v_sess.scopes ELSE v_claims->>'scope' END
  );
END $$;
REVOKE ALL ON FUNCTION public.mcp_caller_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_caller_context() TO authenticated, service_role;

CREATE TABLE public.mcp_client_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  oauth_client_id uuid NOT NULL,
  consent_id uuid NOT NULL,
  consent_granted_at timestamptz NOT NULL,
  access_level text NOT NULL CHECK (access_level IN ('read', 'manage')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_session_id uuid NOT NULL,
  revoked_at timestamptz,
  revoked_reason text
);
CREATE UNIQUE INDEX mcp_client_grants_one_active
  ON public.mcp_client_grants (user_id, oauth_client_id) WHERE revoked_at IS NULL;
GRANT SELECT ON public.mcp_client_grants TO authenticated;
GRANT ALL ON public.mcp_client_grants TO service_role;
ALTER TABLE public.mcp_client_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own MCP grants readable" ON public.mcp_client_grants
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.mcp_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_key uuid NOT NULL,
  action text NOT NULL,
  idem_key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_key, action, idem_key)
);
GRANT SELECT ON public.mcp_idempotency TO authenticated;
GRANT ALL ON public.mcp_idempotency TO service_role;
ALTER TABLE public.mcp_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own MCP idempotency readable" ON public.mcp_idempotency
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.mcp_action_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  oauth_client_id uuid,
  session_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  idem_key text,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_action_audit_user_idx ON public.mcp_action_audit (user_id, created_at DESC);
GRANT SELECT ON public.mcp_action_audit TO authenticated;
GRANT ALL ON public.mcp_action_audit TO service_role;
ALTER TABLE public.mcp_action_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own MCP audit readable" ON public.mcp_action_audit
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.mcp_access_level()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  c jsonb := public.mcp_caller_context();
  v_client uuid;
  v_level text;
  v_scopes text;
BEGIN
  IF NOT (c->>'authenticated')::boolean THEN RETURN 'none'; END IF;
  IF c->>'surface' IN ('first_party', 'unverified') THEN RETURN 'first_party'; END IF;
  v_client := (c->>'oauth_client_id')::uuid;
  SELECT g.access_level INTO v_level
    FROM public.mcp_client_grants g
    JOIN auth.oauth_consents oc ON oc.id = g.consent_id
   WHERE g.user_id = auth.uid() AND g.oauth_client_id = v_client AND g.revoked_at IS NULL
     AND oc.user_id = g.user_id AND oc.client_id = g.oauth_client_id
     AND oc.revoked_at IS NULL AND oc.granted_at = g.consent_granted_at
   LIMIT 1;
  v_level := COALESCE(v_level, 'read');
  v_scopes := COALESCE(c->>'token_scopes', '');
  IF v_scopes ~ '(^|\s)andromeda:read(\s|$)' AND v_scopes !~ '(^|\s)andromeda:manage(\s|$)' THEN
    v_level := 'read';
  END IF;
  RETURN v_level;
END $$;
REVOKE ALL ON FUNCTION public.mcp_access_level() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_access_level() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mcp_write_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.mcp_access_level() IN ('first_party', 'manage') $$;
REVOKE ALL ON FUNCTION public.mcp_write_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_write_allowed() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mcp_assert_write()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF NOT public.mcp_write_allowed() THEN
    RAISE EXCEPTION 'MCP_MANAGE_GRANT_REQUIRED: esta conexión de IA es de solo lectura; el usuario debe activar «Gestionar» en Conectar IA dentro de Andromeda'
      USING ERRCODE = 'MCP01';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.mcp_assert_write() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_assert_write() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._mcp_require_first_party()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE c jsonb := public.mcp_caller_context();
BEGIN
  IF NOT (c->>'authenticated')::boolean THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF c->>'surface' <> 'first_party' THEN
    RAISE EXCEPTION 'MCP_FIRST_PARTY_REQUIRED: los permisos de IA solo se cambian desde una sesión propia de Andromeda'
      USING ERRCODE = 'MCP01';
  END IF;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION public._mcp_require_first_party() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.grant_mcp_client_access(p_oauth_client_id uuid, p_access_level text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  c jsonb := public._mcp_require_first_party();
  v_uid uuid := auth.uid();
  v_consent record;
  v_id uuid;
BEGIN
  IF p_access_level NOT IN ('read', 'manage') THEN
    RAISE EXCEPTION 'invalid access level' USING ERRCODE = 'MCP22';
  END IF;
  PERFORM 1 FROM auth.oauth_clients WHERE id = p_oauth_client_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'OAuth client not found' USING ERRCODE = 'MCP04'; END IF;
  SELECT id, granted_at INTO v_consent FROM auth.oauth_consents
   WHERE user_id = v_uid AND client_id = p_oauth_client_id AND revoked_at IS NULL
   ORDER BY granted_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active authorization for this client' USING ERRCODE = 'MCP04';
  END IF;
  UPDATE public.mcp_client_grants SET revoked_at = now(), revoked_reason = 'REPLACED'
   WHERE user_id = v_uid AND oauth_client_id = p_oauth_client_id AND revoked_at IS NULL;
  INSERT INTO public.mcp_client_grants (user_id, oauth_client_id, consent_id, consent_granted_at,
                                        access_level, granted_session_id)
  VALUES (v_uid, p_oauth_client_id, v_consent.id, v_consent.granted_at, p_access_level,
          (c->>'session_id')::uuid)
  RETURNING id INTO v_id;
  INSERT INTO public.mcp_action_audit (user_id, oauth_client_id, session_id, action, target_type, target_id, after)
  VALUES (v_uid, NULL, (c->>'session_id')::uuid, 'grant_mcp_client_access', 'oauth_client', p_oauth_client_id,
          jsonb_build_object('access_level', p_access_level, 'grant_id', v_id));
  RETURN jsonb_build_object('ok', true, 'grant_id', v_id, 'access_level', p_access_level);
END $$;

CREATE OR REPLACE FUNCTION public.revoke_mcp_client_access(p_oauth_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE c jsonb := public._mcp_require_first_party(); v_n int;
BEGIN
  UPDATE public.mcp_client_grants SET revoked_at = now(), revoked_reason = 'USER_REVOKED'
   WHERE user_id = auth.uid() AND oauth_client_id = p_oauth_client_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.mcp_action_audit (user_id, session_id, action, target_type, target_id, after)
  VALUES (auth.uid(), (c->>'session_id')::uuid, 'revoke_mcp_client_access', 'oauth_client', p_oauth_client_id,
          jsonb_build_object('revoked', v_n));
  RETURN jsonb_build_object('ok', true, 'revoked', v_n, 'access_level', 'read');
END $$;

CREATE OR REPLACE FUNCTION public.list_my_mcp_connections()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE c jsonb := public._mcp_require_first_party();
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'oauth_client_id', oc.client_id,
      'client_name', cl.client_name,
      'authorized_at', oc.granted_at,
      'access_level', COALESCE(g.access_level, 'read'),
      'manage_granted_at', CASE WHEN g.access_level = 'manage' THEN g.granted_at END
    ) ORDER BY oc.granted_at DESC)
    FROM auth.oauth_consents oc
    JOIN auth.oauth_clients cl ON cl.id = oc.client_id AND cl.deleted_at IS NULL
    LEFT JOIN public.mcp_client_grants g
      ON g.user_id = oc.user_id AND g.oauth_client_id = oc.client_id AND g.revoked_at IS NULL
     AND g.consent_id = oc.id AND g.consent_granted_at = oc.granted_at
    WHERE oc.user_id = auth.uid() AND oc.revoked_at IS NULL), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public._mcp_begin(p_action text, p_key text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c jsonb := public.mcp_caller_context();
  v_client uuid := COALESCE((c->>'oauth_client_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid);
  v_hash text := md5(COALESCE(p_payload, '{}'::jsonb)::text);
  v_row public.mcp_idempotency%ROWTYPE;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  PERFORM public.mcp_assert_write();
  IF p_key IS NULL OR length(p_key) < 8 OR length(p_key) > 200 THEN
    RAISE EXCEPTION 'idempotency_key must be 8-200 characters' USING ERRCODE = 'MCP22';
  END IF;
  INSERT INTO public.mcp_idempotency (user_id, client_key, action, idem_key, request_hash)
  VALUES (auth.uid(), v_client, p_action, p_key, v_hash)
  ON CONFLICT (user_id, client_key, action, idem_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_row FROM public.mcp_idempotency
   WHERE user_id = auth.uid() AND client_key = v_client AND action = p_action AND idem_key = p_key;
  IF v_row.request_hash <> v_hash THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED: la clave ya se usó con otros datos' USING ERRCODE = 'MCP09';
  END IF;
  IF v_row.result IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_IN_PROGRESS' USING ERRCODE = 'MCP09';
  END IF;
  RETURN v_row.result || jsonb_build_object('replayed', true);
END $$;
REVOKE ALL ON FUNCTION public._mcp_begin(text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._mcp_finish(p_action text, p_key text, p_result jsonb,
  p_target_type text, p_target_id uuid, p_before jsonb, p_after jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c jsonb := public.mcp_caller_context();
  v_client uuid := (c->>'oauth_client_id')::uuid;
  v_n int;
BEGIN
  UPDATE public.mcp_idempotency SET result = p_result
   WHERE user_id = auth.uid()
     AND client_key = COALESCE(v_client, '00000000-0000-0000-0000-000000000000'::uuid)
     AND action = p_action AND idem_key = p_key AND result IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'idempotency record missing' USING ERRCODE = 'MCP09'; END IF;
  INSERT INTO public.mcp_action_audit (user_id, oauth_client_id, session_id, action, target_type,
                                       target_id, idem_key, before, after)
  VALUES (auth.uid(), v_client, NULLIF(c->>'session_id', '')::uuid, p_action, p_target_type,
          p_target_id, p_key, p_before, p_after);
  RETURN p_result || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION public._mcp_finish(text, text, jsonb, text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._mcp_can_manage_work_item(p_owner uuid, p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (p_owner = auth.uid() OR (p_org IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_memberships m
     WHERE m.organization_id = p_org AND m.user_id = auth.uid()
       AND upper(m.role::text) IN ('OWNER', 'ADMIN'))))
$$;
REVOKE ALL ON FUNCTION public._mcp_can_manage_work_item(uuid, uuid) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_items','work_item_tasks','work_item_deadlines','work_item_hearings',
    'client_wa_consent','client_wa_drafts','work_item_email_links','message_links','detected_processes',
    'alert_instances','notification_user_state','work_item_stage_suggestions','clients']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE POLICY mcp_manage_gate_ins ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.mcp_write_allowed()))', t);
    EXECUTE format('CREATE POLICY mcp_manage_gate_upd ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT public.mcp_write_allowed())) WITH CHECK ((SELECT public.mcp_write_allowed()))', t);
    EXECUTE format('CREATE POLICY mcp_manage_gate_del ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.mcp_write_allowed()))', t);
  END LOOP;
END $$;

DO $$
DECLARE f regprocedure; d text; nd text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.set_work_item_lifecycle(uuid, public.work_item_lifecycle_state, text, text, uuid, jsonb)'::regprocedure,
    'public.manual_link_email_to_work_item(uuid, uuid)'::regprocedure,
    'public.set_notification_user_state(uuid[], text, timestamptz)'::regprocedure,
    'public.accept_workflow_suggestion(uuid, boolean, jsonb)'::regprocedure,
    'public.client_wa_generate_drafts'::regproc::regprocedure]
  LOOP
    d := pg_get_functiondef(f);
    IF position('mcp_assert_write' in d) > 0 THEN CONTINUE; END IF;
    nd := regexp_replace(d, '(\$function\$.*?\mBEGIN\M)', '\1' || E'\n  PERFORM public.mcp_assert_write();', '');
    IF nd = d THEN RAISE EXCEPTION 'gate injection failed for %', f; END IF;
    EXECUTE nd;
  END LOOP;
END $$;