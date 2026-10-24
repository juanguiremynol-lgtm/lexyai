-- 1) Fail closed: an authenticated JWT whose session cannot be verified is read-only, never first-party.
CREATE OR REPLACE FUNCTION public.mcp_access_level()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c jsonb := public.mcp_caller_context();
  v_client uuid;
  v_level text;
  v_scopes text;
BEGIN
  IF NOT (c->>'authenticated')::boolean THEN RETURN 'none'; END IF;
  IF c->>'surface' = 'first_party' THEN RETURN 'first_party'; END IF;
  IF c->>'surface' <> 'oauth_client' THEN RETURN 'read'; END IF;
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

-- 2) Trusted-caller test that never relies on current_user (SECURITY DEFINER changes it to the owner).
-- Trusted = JWT role service_role, or no JWT at all on a non-API login role (session_user is unaffected by definer).
CREATE OR REPLACE FUNCTION public._mcp_is_trusted_backend()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_role text;
BEGIN
  v_role := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                     (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'));
  IF v_role IS NOT NULL THEN RETURN v_role = 'service_role'; END IF;
  RETURN session_user::text NOT IN ('authenticator', 'anon', 'authenticated');
END $$;
REVOKE ALL ON FUNCTION public._mcp_is_trusted_backend() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mcp_is_trusted_backend() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mcp_assert_write()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    IF public._mcp_is_trusted_backend() THEN RETURN; END IF;
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.mcp_write_allowed() THEN
    RAISE EXCEPTION 'MCP_MANAGE_GRANT_REQUIRED: esta conexión de IA es de solo lectura; el usuario debe activar «Gestionar» en Conectar IA dentro de Andromeda'
      USING ERRCODE = 'MCP01';
  END IF;
END $$;

-- 3) Revision-based incremental feed. Change selection uses updated_at (row revision);
-- detected_at is immutable and returned only for display.
CREATE OR REPLACE FUNCTION public._mcp_updates_page(p_ts timestamptz, p_kind text, p_id uuid,
  p_limit int, p_work_item_id uuid, p_mode text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lim int := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_overlap interval := interval '15 minutes';
  v_rows jsonb; v_n int; v_last jsonb; v_next text; v_more boolean; v_wis uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  WITH vis AS (
    SELECT w.id FROM public.work_items w  -- RLS-scoped visibility
     WHERE p_work_item_id IS NULL OR w.id = p_work_item_id
  ), ev AS (
    SELECT * FROM (
      SELECT COALESCE(a.updated_at, a.created_at) AS ts, 'actuacion'::text AS kind, a.id, a.work_item_id,
        md5(COALESCE(a.updated_at, a.created_at)::text || '|' || COALESCE(a.content_hash, '') || '|' || COALESCE(a.is_archived::text, '')) AS rev,
        jsonb_build_object('act_date', a.act_date, 'description', left(a.description, 400), 'source', a.source,
          'detected_at', a.detected_at, 'changed_at', a.changed_at, 'created_at', a.created_at,
          'updated_at', a.updated_at, 'is_archived', a.is_archived, 'content_hash', a.content_hash) AS data
        FROM public.work_item_acts a JOIN vis ON vis.id = a.work_item_id
       WHERE (COALESCE(a.updated_at, a.created_at), 'actuacion'::text, a.id) > (p_ts, p_kind, p_id)
       ORDER BY 1, 3 LIMIT v_lim + 1) x
    UNION ALL SELECT * FROM (
      SELECT COALESCE(p.updated_at, p.created_at), 'estado'::text, p.id, p.work_item_id,
        md5(COALESCE(p.updated_at, p.created_at)::text || '|' || COALESCE(p.content_hash, '') || '|' || COALESCE(p.is_archived::text, '')),
        jsonb_build_object('title', left(p.title, 300), 'fecha_fijacion', p.fecha_fijacion,
          'fecha_desfijacion', p.fecha_desfijacion, 'tipo_publicacion', p.tipo_publicacion, 'source', p.source,
          'detected_at', p.detected_at, 'changed_at', p.changed_at, 'created_at', p.created_at,
          'updated_at', p.updated_at, 'is_archived', p.is_archived, 'content_hash', p.content_hash)
        FROM public.work_item_publicaciones p JOIN vis ON vis.id = p.work_item_id
       WHERE (COALESCE(p.updated_at, p.created_at), 'estado'::text, p.id) > (p_ts, p_kind, p_id)
       ORDER BY 1, 3 LIMIT v_lim + 1) y
    UNION ALL SELECT * FROM (
      SELECT w.lifecycle_changed_at, 'work_item_lifecycle'::text, w.id, w.id,
        md5(w.lifecycle_changed_at::text || '|' || w.lifecycle_state::text),
        jsonb_build_object('lifecycle_state', w.lifecycle_state, 'deleted_at', w.deleted_at, 'purge_after', w.purge_after)
        FROM public.work_items w JOIN vis ON vis.id = w.id
       WHERE (w.lifecycle_changed_at, 'work_item_lifecycle'::text, w.id) > (p_ts, p_kind, p_id)
       ORDER BY 1, 3 LIMIT v_lim + 1) z
  ), page AS (
    SELECT * FROM ev ORDER BY ts, kind, id LIMIT v_lim + 1
  )
  SELECT jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'work_item_id', work_item_id, 'change_ts', ts,
           'revision', rev, 'dedupe_key', kind || ':' || id || ':' || rev, 'data', data) ORDER BY ts, kind, id), count(*)
    INTO v_rows, v_n FROM page;
  v_more := COALESCE(v_n, 0) > v_lim;
  IF v_more THEN v_rows := v_rows - v_lim; END IF;
  v_last := v_rows -> (jsonb_array_length(COALESCE(v_rows, '[]'::jsonb)) - 1);
  v_next := encode(convert_to(jsonb_build_object('v', 2, 'u', v_uid, 'w', p_work_item_id, 'iat', now(),
    'ts', COALESCE(v_last->>'change_ts', p_ts::text),
    'k', COALESCE(v_last->>'kind', p_kind), 'id', COALESCE(v_last->>'id', p_id::text),
    'caught_up', NOT v_more)::text, 'UTF8'), 'base64');
  SELECT array_agg(DISTINCT (e->>'work_item_id')::uuid) INTO v_wis
    FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) e;
  IF p_work_item_id IS NOT NULL THEN v_wis := ARRAY[p_work_item_id]; END IF;

  RETURN jsonb_build_object('mode', p_mode, 'events', COALESCE(v_rows, '[]'::jsonb), 'has_more', v_more,
    'next_cursor', replace(v_next, E'\n', ''),
    'overlap_window_seconds', extract(epoch FROM v_overlap)::int,
    'freshness', (
      SELECT jsonb_agg(jsonb_build_object(
        'work_item_id', w.id,
        'cache_summary', jsonb_build_object('last_synced_at', w.last_synced_at, 'scrape_status', w.scrape_status),
        'sync_checks', (
          SELECT jsonb_agg(jsonb_build_object('provider', t.provider, 'operation', t.operation, 'status', t.status,
                   'successful_check', t.status = 'success', 'error_code', t.error_code,
                   'started_at', t.started_at, 'finished_at', t.finished_at,
                   'records_inserted', t.records_inserted, 'records_skipped', t.records_skipped) ORDER BY t.provider, t.operation)
            FROM (SELECT DISTINCT ON (t0.provider, t0.operation) t0.*
                    FROM public.work_item_sync_timeline t0
                   WHERE t0.work_item_id = w.id
                   ORDER BY t0.provider, t0.operation, COALESCE(t0.finished_at, t0.started_at, t0.created_at) DESC) t),
        'last_successful_check_at', (SELECT max(COALESCE(t1.finished_at, t1.started_at)) FROM public.work_item_sync_timeline t1
                                      WHERE t1.work_item_id = w.id AND t1.status = 'success')))
        FROM public.work_items w   -- RLS-scoped: timeline rows only for work items the caller may see
       WHERE w.id = ANY(COALESCE(v_wis, ARRAY[]::uuid[]))),
    'limitations', 'Cambios seleccionados por revisión (updated_at), no por detected_at: incluye correcciones y archivados de filas antiguas; detected_at se conserva solo para mostrar. Orden estable (change_ts, kind, id); deduplica por dedupe_key (kind:id:revision). updated_at se fija al inicio de la transacción: al ponerse al día se repasan 15 minutos y una transacción que confirme más tarde podría no aparecer; usa mcp_reconcile_updates (reconcile_since) para una reconciliación completa. Solo status=success cuenta como consulta exitosa; empty, error, skipped, rejected, pending_upstream y partial no. Los intentos diarios internos no son visibles para el usuario: su ausencia aquí no significa que no hubo intentos. Sin eventos no significa que los proveedores hayan respondido.');
END $$;
REVOKE ALL ON FUNCTION public._mcp_updates_page(timestamptz, text, uuid, int, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mcp_updates_page(timestamptz, text, uuid, int, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mcp_list_updates(p_cursor text, p_limit int DEFAULT 100,
  p_work_item_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cur jsonb; v_ts timestamptz; v_kind text := ''; v_id uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_cursor IS NOT NULL AND p_cursor <> '' THEN
    BEGIN v_cur := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'CURSOR_INVALID' USING ERRCODE = 'MCP22'; END;
    IF v_cur->>'u' IS DISTINCT FROM v_uid::text THEN RAISE EXCEPTION 'CURSOR_FOREIGN: el cursor pertenece a otra cuenta' USING ERRCODE = 'MCP22'; END IF;
    IF (v_cur->>'w') IS DISTINCT FROM (p_work_item_id::text) THEN RAISE EXCEPTION 'CURSOR_SCOPE_MISMATCH' USING ERRCODE = 'MCP22'; END IF;
    IF (v_cur->>'iat')::timestamptz < now() - interval '7 days' THEN RAISE EXCEPTION 'CURSOR_EXPIRED: pide un cursor nuevo o reconcilia' USING ERRCODE = 'MCP09'; END IF;
    v_ts := (v_cur->>'ts')::timestamptz; v_kind := v_cur->>'k'; v_id := (v_cur->>'id')::uuid;
    IF (v_cur->>'caught_up')::boolean THEN
      v_ts := v_ts - interval '15 minutes'; v_kind := ''; v_id := '00000000-0000-0000-0000-000000000000';
    END IF;
  ELSE
    v_ts := now() - interval '3 days';
  END IF;
  RETURN public._mcp_updates_page(v_ts, v_kind, v_id, p_limit, p_work_item_id, 'incremental');
END $$;

CREATE OR REPLACE FUNCTION public.mcp_reconcile_updates(p_since timestamptz, p_limit int DEFAULT 100,
  p_work_item_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_since IS NULL OR p_since < now() - interval '400 days' THEN
    RAISE EXCEPTION 'RECONCILE_RANGE: reconcile_since debe estar dentro de 400 días' USING ERRCODE = 'MCP22';
  END IF;
  RETURN public._mcp_updates_page(p_since, '', '00000000-0000-0000-0000-000000000000'::uuid, p_limit, p_work_item_id, 'reconcile');
END $$;
REVOKE ALL ON FUNCTION public.mcp_reconcile_updates(timestamptz, int, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_reconcile_updates(timestamptz, int, uuid) TO authenticated, service_role;