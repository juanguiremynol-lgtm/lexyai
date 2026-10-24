-- 0070: (a) a connection that assumed the authenticated/anon API role is never trusted maintenance,
-- even without JWT claims (only true backend logins with no API role qualify);
-- (b) newly created work items surface in the feed (lifecycle revision falls back to created_at).
CREATE OR REPLACE FUNCTION public._mcp_is_trusted_backend()
 RETURNS boolean LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE v_role text; v_api_role text;
BEGIN
  v_role := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                     (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'));
  IF v_role IS NOT NULL THEN RETURN v_role = 'service_role'; END IF;
  -- No JWT: the SET ROLE value (unaffected by SECURITY DEFINER) must not be an API role.
  v_api_role := COALESCE(NULLIF(current_setting('role', true), ''), 'none');
  IF v_api_role IN ('authenticated', 'anon') THEN RETURN false; END IF;
  RETURN session_user::text IN ('postgres', 'supabase_admin', 'service_role');
END $function$;

CREATE OR REPLACE FUNCTION public._mcp_feed_page(p_ts timestamptz, p_kind text, p_id uuid, p_upper timestamptz, p_limit integer, p_work_item_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE v_lim int := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500); v_rows jsonb; v_n int; v_more boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  WITH vis AS (
    SELECT w.id FROM public.work_items w WHERE p_work_item_id IS NULL OR w.id = p_work_item_id
  ), ev AS (
    SELECT * FROM (
      SELECT COALESCE(a.updated_at, a.created_at) AS ts, 'actuacion'::text AS kind, a.id, a.work_item_id,
        md5(COALESCE(a.updated_at, a.created_at)::text || '|' || COALESCE(a.content_hash, '') || '|' || COALESCE(a.is_archived::text, '')) AS rev,
        jsonb_build_object('act_date', a.act_date, 'description', left(a.description, 400), 'source', a.source,
          'detected_at', a.detected_at, 'changed_at', a.changed_at, 'created_at', a.created_at,
          'updated_at', a.updated_at, 'is_archived', a.is_archived, 'content_hash', a.content_hash) AS data
        FROM public.work_item_acts a JOIN vis ON vis.id = a.work_item_id
       WHERE (COALESCE(a.updated_at, a.created_at), 'actuacion'::text, a.id) > (p_ts, p_kind, p_id)
         AND COALESCE(a.updated_at, a.created_at) <= p_upper
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
         AND COALESCE(p.updated_at, p.created_at) <= p_upper
       ORDER BY 1, 3 LIMIT v_lim + 1) y
    UNION ALL SELECT * FROM (
      SELECT COALESCE(w.lifecycle_changed_at, w.created_at), 'work_item_lifecycle'::text, w.id, w.id,
        md5(COALESCE(w.lifecycle_changed_at, w.created_at)::text || '|' || w.lifecycle_state::text),
        jsonb_build_object('lifecycle_state', w.lifecycle_state, 'created_at', w.created_at,
          'lifecycle_changed_at', w.lifecycle_changed_at, 'deleted_at', w.deleted_at, 'purge_after', w.purge_after)
        FROM public.work_items w JOIN vis ON vis.id = w.id
       WHERE (COALESCE(w.lifecycle_changed_at, w.created_at), 'work_item_lifecycle'::text, w.id) > (p_ts, p_kind, p_id)
         AND COALESCE(w.lifecycle_changed_at, w.created_at) <= p_upper
       ORDER BY 1, 3 LIMIT v_lim + 1) z
  ), page AS (SELECT * FROM ev ORDER BY ts, kind, id LIMIT v_lim + 1)
  SELECT jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'work_item_id', work_item_id, 'change_ts', ts,
           'revision', rev, 'dedupe_key', kind || ':' || id || ':' || rev, 'data', data) ORDER BY ts, kind, id), count(*)
    INTO v_rows, v_n FROM page;
  v_more := COALESCE(v_n, 0) > v_lim;
  IF v_more THEN v_rows := v_rows - v_lim; END IF;
  RETURN jsonb_build_object('events', COALESCE(v_rows, '[]'::jsonb), 'has_more', v_more);
END $function$;