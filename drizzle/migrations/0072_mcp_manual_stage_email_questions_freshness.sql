-- 0072: manual stage parity, global email-question discovery, feed freshness coverage.

-- 1. Manual (user-authorized) stage moves mirror the app boards: any valid server-side target,
--    governed transitions honoured (including configured regressions); backward/cross-phase moves
--    require an explicit user reason. Caller-supplied stage orders are never consulted.
--    Suggestions keep the forward-only preclusion in _mcp_check_stage_move.
CREATE OR REPLACE FUNCTION public._mcp_check_manual_stage_move(p_wf text, p_from text, p_to text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_to record; v_from record; v_has_rules boolean; v_t record; v_regression boolean := false;
  v_reason_ok boolean := length(btrim(COALESCE(p_reason, ''))) >= 5;
BEGIN
  IF p_from = p_to THEN RAISE EXCEPTION 'SAME_STAGE: el asunto ya está en %', p_to USING ERRCODE = 'MCP09'; END IF;
  IF NOT public._mcp_is_catalog_governed(p_wf) THEN
    SELECT * INTO v_to FROM public._mcp_stage_vocab() s WHERE s.workflow_type = p_wf AND s.code = p_to;
    IF NOT FOUND OR NOT v_to.target_allowed THEN
      RAISE EXCEPTION 'INVALID_STAGE: % no es una etapa movible de % (consulta list_workflow_stages)', p_to, p_wf USING ERRCODE = 'MCP22'; END IF;
    SELECT * INTO v_from FROM public._mcp_stage_vocab() s WHERE s.workflow_type = p_wf AND s.code = p_from;
    v_regression := COALESCE(v_from.ord IS NOT NULL AND v_to.ord < v_from.ord, false)
                 OR COALESCE(v_from.phase = 'PROCESS' AND v_to.phase = 'FILING', false);
    IF v_regression AND NOT v_reason_ok THEN
      RAISE EXCEPTION 'REASON_REQUIRED: retroceder de % a % exige el motivo indicado por el usuario (reason)', p_from, p_to USING ERRCODE = 'MCP22'; END IF;
    RETURN jsonb_build_object('rule', 'application_vocabulary', 'is_regression', v_regression);
  END IF;
  SELECT * INTO v_to FROM public.workflow_stages_global WHERE workflow_type = p_wf AND code = p_to AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STAGE: % no es una etapa de %', p_to, p_wf USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_from FROM public.workflow_stages_global WHERE workflow_type = p_wf AND code = p_from AND active;
  SELECT EXISTS (SELECT 1 FROM public.workflow_stage_transitions WHERE workflow_type = p_wf AND active) INTO v_has_rules;
  IF v_has_rules AND v_from.code IS NOT NULL THEN
    SELECT * INTO v_t FROM public.workflow_stage_transitions
     WHERE workflow_type = p_wf AND active AND from_stage_code = p_from AND to_stage_code = p_to;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRANSITION_NOT_ALLOWED: el catálogo no contempla % -> %', p_from, p_to USING ERRCODE = 'MCP22'; END IF;
    v_regression := COALESCE(v_t.is_regression_allowed, false) OR COALESCE(v_to.display_order < v_from.display_order, false);
  ELSE
    v_regression := COALESCE(v_to.display_order < v_from.display_order, false);
  END IF;
  IF v_regression AND NOT v_reason_ok THEN
    RAISE EXCEPTION 'REASON_REQUIRED: retroceder de % a % exige el motivo indicado por el usuario (reason)', p_from, p_to USING ERRCODE = 'MCP22'; END IF;
  RETURN jsonb_build_object('rule', CASE WHEN v_has_rules AND v_from.code IS NOT NULL THEN 'catalog_transition' ELSE 'catalog_stage' END,
                            'is_regression', v_regression);
END $function$;
REVOKE ALL ON FUNCTION public._mcp_check_manual_stage_move(text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mcp_move_work_item_stage(p_work_item_id uuid, p_to_stage text, p_expected_updated_at timestamp with time zone, p_app_stage_order text[], p_idempotency_key text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- p_app_stage_order is accepted for signature compatibility and IGNORED: validation is server-side only.
DECLARE v_prior jsonb; v_w public.work_items%ROWTYPE; v_before jsonb; v_after jsonb; v_chk jsonb;
BEGIN
  v_prior := public._mcp_begin('move_stage', p_idempotency_key,
    jsonb_build_object('id', p_work_item_id, 'to', p_to_stage, 'exp', p_expected_updated_at, 'reason', p_reason));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'expected_updated_at es obligatorio' USING ERRCODE = 'MCP22'; END IF;
  SELECT * INTO v_w FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF NOT FOUND OR NOT public._mcp_can_manage_work_item(v_w.owner_id, v_w.organization_id) OR v_w.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: asunto no encontrado' USING ERRCODE = 'MCP04'; END IF;
  IF v_w.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_REVISION: el asunto cambió (updated_at actual %)', v_w.updated_at USING ERRCODE = 'MCP09'; END IF;
  IF v_w.lifecycle_state <> 'ACTIVE' THEN RAISE EXCEPTION 'el asunto no está activo' USING ERRCODE = 'MCP09'; END IF;
  v_chk := public._mcp_check_manual_stage_move(v_w.workflow_type::text, v_w.stage, p_to_stage, p_reason);
  v_before := public._mcp_wi_snapshot(p_work_item_id);
  PERFORM public._mcp_apply_stage(v_w, p_to_stage, 'MANUAL_USER', NULL,
    COALESCE(NULLIF(btrim(p_reason), ''), 'Cambio de etapa vía asistente IA'));
  v_after := public._mcp_wi_snapshot(p_work_item_id);
  RETURN public._mcp_finish('move_stage', p_idempotency_key,
    jsonb_build_object('ok', true, 'work_item', v_after, 'previous_stage', v_w.stage,
      'validated_by', v_chk->>'rule', 'is_regression', (v_chk->>'is_regression')::boolean, 'reason', p_reason),
    'work_item', p_work_item_id, v_before, v_after || jsonb_build_object('reason', p_reason, 'is_regression', v_chk->'is_regression'));
END $function$;
-- Review gate preserved: EXECUTE stays revoked from authenticated/anon (see supabase/release).
REVOKE ALL ON FUNCTION public.mcp_move_work_item_stage(uuid, text, timestamptz, text[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_move_work_item_stage(uuid, text, timestamptz, text[], text, text) TO service_role;

-- 2. Global pending email questions (read-only, RLS-scoped, grouped per message).
CREATE OR REPLACE FUNCTION public._mcp_email_group_key(p_imid text, p_mid text, p_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$ SELECT COALESCE('imid:' || NULLIF(p_imid, ''), 'mid:' || NULLIF(p_mid, ''), 'id:' || p_id::text) $$;

CREATE INDEX IF NOT EXISTS work_item_email_links_suggested_group_idx
  ON public.work_item_email_links (public._mcp_email_group_key(internet_message_id, message_id, id))
  WHERE link_status = 'SUGGESTED';
CREATE INDEX IF NOT EXISTS work_item_email_links_group_idx
  ON public.work_item_email_links (public._mcp_email_group_key(internet_message_id, message_id, id));

CREATE OR REPLACE FUNCTION public.mcp_list_email_questions(p_cursor text DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE v_uid uuid := auth.uid(); v_lim int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_ts timestamptz; v_key text; v_write boolean := public.mcp_write_allowed(); v_groups jsonb; v_n int; v_last jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_cursor IS NOT NULL AND p_cursor <> '' THEN
    BEGIN
      v_ts := (convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 't')::timestamptz;
      v_key := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'k';
    EXCEPTION WHEN others THEN v_ts := NULL; END;
    IF v_ts IS NULL OR v_key IS NULL THEN RAISE EXCEPTION 'CURSOR_INVALID' USING ERRCODE = 'MCP22'; END IF;
  END IF;
  WITH pending AS (   -- RLS limits rows to what the caller may see
    SELECT DISTINCT public._mcp_email_group_key(l.internet_message_id, l.message_id, l.id) AS gk
      FROM public.work_item_email_links l WHERE l.link_status = 'SUGGESTED'
  ), g AS (
    SELECT p.gk, max(COALESCE(l.received_at, l.created_at)) AS ts
      FROM pending p JOIN public.work_item_email_links l
        ON public._mcp_email_group_key(l.internet_message_id, l.message_id, l.id) = p.gk
     GROUP BY p.gk
  ), page AS (
    SELECT * FROM g WHERE v_ts IS NULL OR (g.ts, g.gk) < (v_ts, v_key)
     ORDER BY g.ts DESC, g.gk DESC LIMIT v_lim + 1
  ), links AS (
    SELECT p.gk, p.ts, l.*, w.title AS wi_title, w.radicado AS wi_radicado, w.owner_id AS wi_owner,
           w.deleted_at AS wi_deleted, w.lifecycle_state::text AS wi_state,
           left(regexp_replace(COALESCE(w.radicado, ''), '[^0-9]', '', 'g'), 21) AS wi_base,
           public._mcp_subject_radicado_bases(l.subject) AS subj_bases,
           public._mcp_message_radicado_bases(l.evidence_meta) AS meta_bases
      FROM page p JOIN public.work_item_email_links l
        ON public._mcp_email_group_key(l.internet_message_id, l.message_id, l.id) = p.gk
      LEFT JOIN public.work_items w ON w.id = l.work_item_id
  ), grp AS (
    SELECT gk, ts,
      (array_agg(jsonb_build_object('subject', subject, 'sender', sender, 'received_at', received_at,
         'direction', direction, 'has_attachments', has_attachments, 'attachment_names', attachment_names,
         'web_link', web_link, 'internet_message_id', internet_message_id, 'message_id', message_id)
         ORDER BY created_at, id))[1] AS source,
      bool_or(COALESCE(conflict_flag, false)) AS any_flag,
      jsonb_agg(jsonb_build_object(
        'link_id', id, 'work_item_id', work_item_id, 'work_item_title', wi_title, 'radicado', wi_radicado,
        'work_item_state', wi_state, 'link_status', link_status, 'confidence', confidence,
        'confidence_ceiling', confidence_ceiling, 'candidate_rank', candidate_rank, 'matched_by', matched_by,
        'matched_value', matched_value, 'signal_class', signal_class, 'evidence_type', evidence_type,
        'evidence_subtype', evidence_subtype, 'match_outcome', match_outcome, 'conflict_flag', conflict_flag,
        'stored_meta_radicado_bases', meta_bases,
        'scope', CASE WHEN user_id = v_uid AND wi_owner = v_uid AND wi_deleted IS NULL THEN 'writable' ELSE 'organization_view_only' END,
        'allowed_actions', CASE WHEN user_id = v_uid AND wi_owner = v_uid AND wi_deleted IS NULL AND v_write AND link_status = 'SUGGESTED'
                                THEN '["confirm","dismiss_all_suggestions"]'::jsonb ELSE '[]'::jsonb END)
        ORDER BY candidate_rank NULLS LAST, confidence DESC NULLS LAST, id) AS candidates,
      array_agg(DISTINCT wi_base) FILTER (WHERE wi_base <> '') AS cand_bases
    FROM links GROUP BY gk, ts
  ), sb AS (
    SELECT gk, array_agg(DISTINCT b) AS subj FROM links, unnest(subj_bases) b GROUP BY gk
  ), mb AS (
    SELECT gk, array_agg(DISTINCT b) AS meta FROM links, unnest(meta_bases) b GROUP BY gk
  ), fin AS (
    SELECT grp.*, COALESCE(sb.subj, ARRAY[]::text[]) AS subj, COALESCE(mb.meta, ARRAY[]::text[]) AS meta
      FROM grp LEFT JOIN sb USING (gk) LEFT JOIN mb USING (gk)
  )
  SELECT jsonb_agg(jsonb_build_object(
      'group_key', gk, 'latest_at', ts, 'source', source,
      'raw_subject_radicado_bases', subj, 'stored_meta_radicado_bases', meta,
      'conflict', any_flag
                  OR (SELECT count(DISTINCT b) FROM unnest(subj || meta) b) > 1
                  OR (cardinality(subj || meta) > 0 AND NOT COALESCE(cand_bases && (subj || meta), false)),
      'candidates', candidates) ORDER BY ts DESC, gk DESC), count(*)
    INTO v_groups, v_n FROM fin;
  v_groups := COALESCE(v_groups, '[]'::jsonb);
  IF v_n > v_lim THEN v_groups := v_groups - v_lim; END IF;
  v_last := v_groups -> (jsonb_array_length(v_groups) - 1);
  RETURN jsonb_build_object('questions', v_groups, 'has_more', COALESCE(v_n, 0) > v_lim,
    'next_cursor', CASE WHEN COALESCE(v_n, 0) > v_lim THEN
       replace(encode(convert_to(jsonb_build_object('t', v_last->>'latest_at', 'k', v_last->>'group_key')::text, 'UTF8'), 'base64'), E'\n', '') END,
    'can_write', v_write,
    'notes', 'Solo metadatos del correo (nunca cuerpos ni envíos). Agrupado por internet_message_id (o message_id). Una pregunta aparece mientras tenga al menos una sugerencia pendiente; se listan todos los candidatos del mensaje. scope=writable solo para vínculos propios en asuntos propios; organization_view_only nunca es gestionable. confirm (resolve_email_question) descarta las demás sugerencias del mensaje; si conflict=true usa add_email_association solo por decisión explícita del usuario. Confirmar un correo nunca cambia etapas ni da por cumplido un término. El cursor es solo posición de lectura (filas filtradas por RLS).');
END $function$;
REVOKE ALL ON FUNCTION public.mcp_list_email_questions(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_list_email_questions(text, integer) TO authenticated, service_role;

-- 3. Feed freshness: per provider/operation last SUCCESS for every visible monitored matter in the
--    filter (bounded to 200), even when the event page is empty.
CREATE OR REPLACE FUNCTION public._mcp_feed_freshness(p_work_item_id uuid, p_page_items uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH scope AS (
    SELECT w.id, w.last_synced_at, w.scrape_status, w.monitoring_enabled FROM public.work_items w
     WHERE w.deleted_at IS NULL AND (p_work_item_id IS NULL OR w.id = p_work_item_id)
  ), shown AS (
    SELECT s.* FROM scope s
     WHERE s.monitoring_enabled OR s.id = p_work_item_id OR s.id = ANY (COALESCE(p_page_items, ARRAY[]::uuid[]))
     ORDER BY (s.id = ANY (COALESCE(p_page_items, ARRAY[]::uuid[]))) DESC, s.id LIMIT 200
  ), latest AS (
    SELECT DISTINCT ON (t.work_item_id, t.provider, t.operation) t.work_item_id, t.provider, t.operation, t.status,
           t.error_code, t.started_at, t.finished_at, t.records_inserted, t.records_skipped
      FROM public.work_item_sync_timeline t JOIN scope s ON s.id = t.work_item_id
     WHERE t.created_at > now() - interval '30 days'
     ORDER BY t.work_item_id, t.provider, t.operation, COALESCE(t.finished_at, t.started_at, t.created_at) DESC
  ), last_ok AS (
    SELECT t.work_item_id, t.provider, t.operation, max(COALESCE(t.finished_at, t.started_at)) AS at
      FROM public.work_item_sync_timeline t JOIN scope s ON s.id = t.work_item_id
     WHERE t.status = 'success' AND t.created_at > now() - interval '90 days'
     GROUP BY 1, 2, 3
  )
  SELECT jsonb_build_object(
    'window', jsonb_build_object('latest_check', '30 days', 'last_success', '90 days'),
    'scope', CASE WHEN p_work_item_id IS NULL THEN 'portfolio' ELSE 'work_item' END,
    'monitored_items', (SELECT count(*) FROM scope WHERE monitoring_enabled),
    'monitored_items_without_check', (SELECT count(*) FROM scope s WHERE s.monitoring_enabled
                                      AND NOT EXISTS (SELECT 1 FROM latest l WHERE l.work_item_id = s.id)),
    'items_listed', (SELECT count(*) FROM shown),
    'items_truncated', (SELECT count(*) FROM scope s WHERE s.monitoring_enabled OR s.id = ANY (COALESCE(p_page_items, ARRAY[]::uuid[]))) > 200,
    'by_provider', COALESCE((SELECT jsonb_agg(jsonb_build_object('provider', provider, 'operation', operation,
        'items_checked', n, 'items_latest_success', n_ok, 'items_latest_not_success', n - n_ok,
        'oldest_last_success_at', oldest_ok, 'newest_last_success_at', newest_ok) ORDER BY provider, operation)
      FROM (SELECT l.provider, l.operation, count(*) n, count(*) FILTER (WHERE l.status = 'success') n_ok,
                   min(o.at) oldest_ok, max(o.at) newest_ok
              FROM latest l LEFT JOIN last_ok o USING (work_item_id, provider, operation)
             GROUP BY 1, 2) g), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('work_item_id', s.id, 'monitoring_enabled', s.monitoring_enabled,
        'cache_summary', jsonb_build_object('last_synced_at', s.last_synced_at, 'scrape_status', s.scrape_status),
        'sync_checks', COALESCE((SELECT jsonb_agg(jsonb_build_object('provider', l.provider, 'operation', l.operation,
             'status', l.status, 'successful_check', l.status = 'success', 'error_code', l.error_code,
             'started_at', l.started_at, 'finished_at', l.finished_at, 'records_inserted', l.records_inserted,
             'records_skipped', l.records_skipped, 'last_success_at', o.at) ORDER BY l.provider, l.operation)
           FROM latest l LEFT JOIN last_ok o USING (work_item_id, provider, operation) WHERE l.work_item_id = s.id), '[]'::jsonb))
        ORDER BY s.id)
      FROM shown s), '[]'::jsonb))
$function$;

-- 4. Reconcile is a current-row rescan with a 400-day bound, not a history/snapshot.
CREATE OR REPLACE FUNCTION public.mcp_reconcile_updates(p_since timestamp with time zone, p_limit integer DEFAULT 100, p_work_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_since IS NULL OR p_since < now() - interval '400 days' OR p_since > now() THEN
    RAISE EXCEPTION 'RECONCILE_RANGE: reconcile_since debe estar dentro de 400 días' USING ERRCODE = 'MCP22'; END IF;
  RETURN public._mcp_feed_step(public._mcp_client_key(), p_work_item_id, 'reconcile', p_since, '',
    '00000000-0000-0000-0000-000000000000'::uuid, NULL, NULL, p_limit)
    || jsonb_build_object('reconcile_scope', 'Relee el estado ACTUAL de filas cuya revisión (updated_at) es posterior a reconcile_since (máximo 400 días). No es un historial ni una instantánea completa: revisiones intermedias, purgas definitivas y filas más antiguas que el límite no aparecen.');
END $function$;

COMMENT ON FUNCTION public._mcp_updates_page(timestamptz, text, uuid, integer, uuid, text) IS
  'DEPRECATED: replaced by _mcp_feed_page/_mcp_feed_step (server-stored cursors). Not called.';