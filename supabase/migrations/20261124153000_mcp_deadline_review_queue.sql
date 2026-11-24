-- Personal review of a proposed deadline is separate from changing the deadline.
CREATE OR REPLACE FUNCTION public.list_pending_deadline_reviews(
  p_cursor text DEFAULT NULL, p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO pg_catalog
AS $function$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.mcp_access_level()::text, 'none') = 'none' THEN
    RAISE EXCEPTION 'Sesión no verificada' USING ERRCODE = '42501';
  END IF;
  IF p_cursor IS NOT NULL AND p_cursor !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Cursor inválido' USING ERRCODE = '22023';
  END IF;

  RETURN (
    WITH visible AS (
      SELECT d.id, d.work_item_id, w.radicado, w.title, d.label, d.deadline_type,
        d.trigger_date, d.trigger_event, d.bound_party_role, d.source_event_id,
        e.event_key, (w.owner_id = auth.uid() AND d.owner_id = auth.uid()) IS TRUE AS owned
      FROM public.work_item_deadlines d
      JOIN public.work_items w ON w.id = d.work_item_id
      CROSS JOIN LATERAL (
        SELECT public.deadline_event_key(d.work_item_id, d.deadline_type, d.trigger_event,
          d.bound_party_role, d.trigger_date, d.source_event_id) AS event_key
      ) e
      WHERE d.status = 'REQUIERE_REVISION_MANUAL'
        AND w.lifecycle_state = 'ACTIVE' AND w.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.deadline_review_user_state s
          WHERE s.user_id = auth.uid()
            AND (s.event_key = e.event_key OR (s.event_key IS NULL AND s.deadline_id = d.id))
            AND (s.acknowledged_at IS NOT NULL OR s.snoozed_until > now())
        )
    ),
    events AS (
      SELECT encode(sha256(convert_to(event_key, 'UTF8')), 'hex') AS event_id,
        work_item_id, radicado, title, max(label) AS label, max(deadline_type) AS deadline_type,
        max(trigger_date) AS trigger_date, max(trigger_event) AS trigger_event,
        max(nullif(bound_party_role, '')) AS bound_party_role, min(source_event_id::text)::uuid AS source_event_id,
        array_agg(id ORDER BY id) AS row_ids, count(*)::integer AS row_count, bool_and(owned) AS owned
      FROM visible
      GROUP BY event_key, work_item_id, radicado, title
    ),
    candidates AS (
      SELECT e.*,
        CASE WHEN e.owned AND public.mcp_write_allowed()
          THEN jsonb_build_array('acknowledge', 'snooze') ELSE '[]'::jsonb END AS allowed_actions
      FROM events e
      WHERE p_cursor IS NULL OR e.event_id > p_cursor
      ORDER BY e.event_id LIMIT v_limit + 1
    ),
    page AS (
      SELECT * FROM candidates ORDER BY event_id LIMIT v_limit
    )
    SELECT jsonb_build_object(
      'events', coalesce((SELECT jsonb_agg(to_jsonb(p) - 'owned' ORDER BY event_id) FROM page p), '[]'::jsonb),
      'has_more', (SELECT count(*) > v_limit FROM candidates),
      'next_cursor', CASE WHEN (SELECT count(*) > v_limit FROM candidates)
        THEN (SELECT max(event_id) FROM page) END
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mcp_resolve_deadline_reviews(
  p_event_ids text[], p_action text, p_until timestamptz, p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_ids text[];
  v_prior jsonb;
  v_rows uuid[];
  v_events integer;
  v_updated integer;
BEGIN
  IF coalesce(cardinality(p_event_ids), 0) NOT BETWEEN 1 AND 25
    OR EXISTS (SELECT 1 FROM unnest(p_event_ids) AS e(id) WHERE id IS NULL OR id !~ '^[a-f0-9]{64}$')
    OR coalesce(p_action, '') NOT IN ('acknowledge', 'snooze')
    OR (p_action = 'acknowledge' AND p_until IS NOT NULL)
    OR (p_action = 'snooze' AND p_until IS NULL) THEN
    RAISE EXCEPTION 'Acción de revisión inválida' USING ERRCODE = 'MCP22';
  END IF;

  SELECT array_agg(DISTINCT id ORDER BY id) INTO v_ids FROM unnest(p_event_ids) AS e(id);
  v_prior := public._mcp_begin('resolve_deadline_reviews', p_idempotency_key,
    jsonb_build_object('events', v_ids, 'action', p_action, 'until', p_until));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;
  IF p_action = 'snooze' AND p_until <= now() THEN
    RAISE EXCEPTION 'El aplazamiento debe quedar en el futuro' USING ERRCODE = 'MCP22';
  END IF;

  SELECT array_agg(q.id ORDER BY q.id), count(DISTINCT q.event_id)
  INTO v_rows, v_events
  FROM (
    SELECT d.id, e.event_id
    FROM public.work_item_deadlines d
    JOIN public.work_items w ON w.id = d.work_item_id
    CROSS JOIN LATERAL (
      SELECT encode(sha256(convert_to(public.deadline_event_key(d.work_item_id, d.deadline_type,
        d.trigger_event, d.bound_party_role, d.trigger_date, d.source_event_id), 'UTF8')), 'hex') AS event_id
    ) e
    WHERE w.owner_id = v_user AND d.owner_id = v_user
      AND w.lifecycle_state = 'ACTIVE' AND w.deleted_at IS NULL
      AND d.status = 'REQUIERE_REVISION_MANUAL' AND e.event_id = ANY(v_ids)
    ORDER BY d.id
    FOR UPDATE OF d FOR SHARE OF w
  ) q;
  IF v_events <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'La revisión cambió o ya no es gestionable. Consulta la bandeja de nuevo.' USING ERRCODE = 'MCP09';
  END IF;
  IF cardinality(v_rows) > 500 THEN
    RAISE EXCEPTION 'Demasiadas filas de revisión. Reduce el lote.' USING ERRCODE = 'MCP22';
  END IF;

  SELECT count(*) INTO v_updated FROM public.acknowledge_deadline_reviews(v_rows, p_action, p_until);
  IF v_updated <> cardinality(v_rows) THEN
    RAISE EXCEPTION 'La operación no confirmó todas las filas de revisión' USING ERRCODE = 'MCP09';
  END IF;

  RETURN public._mcp_finish('resolve_deadline_reviews', p_idempotency_key,
    jsonb_build_object('ok', true, 'action', p_action, 'event_ids', v_ids, 'rows', v_updated),
    'deadline_review_user_state', NULL, NULL, jsonb_build_object('events', v_ids, 'until', p_until));
END;
$function$;

REVOKE ALL ON FUNCTION public.list_pending_deadline_reviews(text, integer),
  public.mcp_resolve_deadline_reviews(text[], text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_deadline_reviews(text, integer),
  public.mcp_resolve_deadline_reviews(text[], text, timestamptz, text) TO authenticated;

-- A read-only OAuth client must not be able to bypass the audit endpoint by
-- calling the native operation or writing to the table directly.
DROP POLICY IF EXISTS mcp_manage_gate_ins ON public.deadline_review_user_state;
CREATE POLICY mcp_manage_gate_ins ON public.deadline_review_user_state
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.mcp_write_allowed()));
DROP POLICY IF EXISTS mcp_manage_gate_upd ON public.deadline_review_user_state;
CREATE POLICY mcp_manage_gate_upd ON public.deadline_review_user_state
  AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT public.mcp_write_allowed()))
  WITH CHECK ((SELECT public.mcp_write_allowed()));
DROP POLICY IF EXISTS mcp_manage_gate_del ON public.deadline_review_user_state;
CREATE POLICY mcp_manage_gate_del ON public.deadline_review_user_state
  AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.mcp_write_allowed()));

CREATE INDEX IF NOT EXISTS deadline_review_state_user_event_idx
ON public.deadline_review_user_state (user_id, event_key)
WHERE event_key IS NOT NULL;

DO $capability$
DECLARE
  definition text := pg_get_functiondef('public.mcp_mutation_availability()'::regprocedure);
  anchor text := '(''resolve_email_question'',''public.mcp_resolve_email_question(uuid,text,text)'')';
  entry text := '(''resolve_deadline_reviews'',''public.mcp_resolve_deadline_reviews(text[],text,timestamptz,text)'')';
BEGIN
  IF strpos(definition, entry) = 0 THEN
    IF length(definition) - length(replace(definition, anchor, '')) <> length(anchor) THEN
      RAISE EXCEPTION 'Unexpected definition of mcp_mutation_availability';
    END IF;
    EXECUTE replace(definition, anchor, anchor || ', ' || entry);
  END IF;
END;
$capability$;
