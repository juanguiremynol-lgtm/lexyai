-- Preserve empty-page source evidence even for unmonitored visible matters.
-- No user data writes, new grants, provider calls or cursor contract changes.
DO $repair$
DECLARE v_sql text; v_old text := 's.monitoring_enabled OR s.id = p_work_item_id OR s.id = ANY (COALESCE(p_page_items, ARRAY[]::uuid[]))';
BEGIN
  SELECT pg_get_functiondef('public._mcp_feed_freshness(uuid,uuid[])'::regprocedure) INTO v_sql;
  IF strpos(v_sql, v_old) = 0 THEN RAISE EXCEPTION 'freshness source anchor mismatch'; END IF;
  v_sql := replace(v_sql, v_old, v_old || ' OR EXISTS (SELECT 1 FROM public.work_item_sync_timeline evidence WHERE evidence.work_item_id = s.id AND evidence.created_at > now() - interval ''30 days'')');
  -- Truncation must describe the same eligible set, including explicit item.
  v_sql := replace(v_sql, 's.monitoring_enabled OR s.id = ANY (COALESCE(p_page_items, ARRAY[]::uuid[]))', v_old || ' OR EXISTS (SELECT 1 FROM public.work_item_sync_timeline evidence WHERE evidence.work_item_id = s.id AND evidence.created_at > now() - interval ''30 days'')');
  EXECUTE v_sql;
END $repair$;