-- REVIEW ONLY — not applied. Root applies after independent acceptance.
-- Freshness readers count a check as successful only when it is VERIFIED:
-- status='success' AND error_code IS NULL AND provider fully attributable
-- (non-blank; no 'unknown'/'none'/blank component). Signatures, invoker
-- semantics, owners, grants, pagination and time windows are unchanged.
-- No history is rewritten. Fails closed if the live bodies changed.
BEGIN;
DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public._mcp_feed_freshness(uuid,uuid[])'::regprocedure)
       IS DISTINCT FROM '67709a4322f00ad24568c0bd579db26a'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.mcp_list_freshness_issues(uuid,integer,uuid)'::regprocedure)
       IS DISTINCT FROM '4be7fd84dbf3cc5752bb95fa02cb0d4c' THEN
    RAISE EXCEPTION 'freshness reader pre-image changed; refusing to replace' USING ERRCODE = 'P0001';
  END IF;
END $guard$;



COMMIT;
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
     WHERE s.monitoring_enabled OR s.id = p_work_item_id OR s.id = ANY (COALESCE(p_page_items, ARRAY[]::uuid[])) OR EXISTS (SELECT 1 FROM public.work_item_sync_timeline evidence WHERE evidence.work_item_id = s.id AND evidence.created_at > now() - interval '30 days')
     ORDER BY (s.id = ANY (COALESCE(p_page_items, ARRAY[]::uuid[]))) DESC, s.id LIMIT 200
  ), latest AS (
    SELECT DISTINCT ON (t.work_item_id, t.provider, t.operation) t.work_item_id, t.provider, t.operation, t.status,
           t.error_code, t.started_at, t.finished_at, t.records_inserted, t.records_skipped
      FROM public.work_item_sync_timeline t JOIN scope s ON s.id = t.work_item_id
     WHERE t.created_at > now() - interval '30 days'
     ORDER BY t.work_item_id, t.provider, t.operation, COALESCE(t.finished_at, t.started_at, t.created_at) DESC, t.id DESC
  ), last_ok AS (
    SELECT t.work_item_id, t.provider, t.operation, max(COALESCE(t.finished_at, t.started_at)) AS at
      FROM public.work_item_sync_timeline t JOIN scope s ON s.id = t.work_item_id
     WHERE (t.status = 'success' AND t.error_code IS NULL AND btrim(COALESCE(t.provider,'')) <> '' AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(lower(t.provider), '[+,/|]') tok WHERE btrim(tok) IN ('','unknown','none'))) AND t.created_at > now() - interval '90 days'
     GROUP BY 1, 2, 3
  )
  SELECT jsonb_build_object(
    'issues', public.mcp_list_freshness_issues(NULL,50,p_work_item_id), 'window', jsonb_build_object('latest_check', '30 days', 'last_success', '90 days'),
    'scope', CASE WHEN p_work_item_id IS NULL THEN 'portfolio' ELSE 'work_item' END,
    'monitored_items', (SELECT count(*) FROM scope WHERE monitoring_enabled),
    'monitored_items_without_check', (SELECT count(*) FROM scope s WHERE s.monitoring_enabled
                                      AND NOT EXISTS (SELECT 1 FROM latest l WHERE l.work_item_id = s.id)),
    'items_listed', (SELECT count(*) FROM shown),
    'items_truncated', (SELECT count(*) FROM scope s WHERE s.monitoring_enabled OR s.id = p_work_item_id OR s.id = ANY (COALESCE(p_page_items, ARRAY[]::uuid[])) OR EXISTS (SELECT 1 FROM public.work_item_sync_timeline evidence WHERE evidence.work_item_id = s.id AND evidence.created_at > now() - interval '30 days')) > 200,
    'by_provider', COALESCE((SELECT jsonb_agg(jsonb_build_object('provider', provider, 'operation', operation,
        'items_checked', n, 'items_latest_success', n_ok, 'items_latest_not_success', n - n_ok,
        'oldest_last_success_at', oldest_ok, 'newest_last_success_at', newest_ok) ORDER BY provider, operation)
      FROM (SELECT l.provider, l.operation, count(*) n, count(*) FILTER (WHERE (l.status = 'success' AND l.error_code IS NULL AND btrim(COALESCE(l.provider,'')) <> '' AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(lower(l.provider), '[+,/|]') tok WHERE btrim(tok) IN ('','unknown','none')))) n_ok,
                   min(o.at) oldest_ok, max(o.at) newest_ok
              FROM latest l LEFT JOIN last_ok o USING (work_item_id, provider, operation)
             GROUP BY 1, 2) g), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('work_item_id', s.id, 'monitoring_enabled', s.monitoring_enabled,
        'cache_summary', jsonb_build_object('last_synced_at', s.last_synced_at, 'scrape_status', s.scrape_status),
        'sync_checks', COALESCE((SELECT jsonb_agg(jsonb_build_object('provider', l.provider, 'operation', l.operation,
             'status', l.status, 'successful_check', (l.status = 'success' AND l.error_code IS NULL AND btrim(COALESCE(l.provider,'')) <> '' AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(lower(l.provider), '[+,/|]') tok WHERE btrim(tok) IN ('','unknown','none'))), 'error_code', l.error_code,
             'started_at', l.started_at, 'finished_at', l.finished_at, 'records_inserted', l.records_inserted,
             'records_skipped', l.records_skipped, 'last_success_at', o.at) ORDER BY l.provider, l.operation)
           FROM latest l LEFT JOIN last_ok o USING (work_item_id, provider, operation) WHERE l.work_item_id = s.id), '[]'::jsonb))
        ORDER BY s.id)
      FROM shown s), '[]'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION public.mcp_list_freshness_issues(p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_work_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE lim integer:=LEAST(GREATEST(COALESCE(p_limit,50),1),200); rows_json jsonb; more boolean; last_id uuid;
BEGIN
 IF NOT COALESCE((public.mcp_caller_context()->>'authenticated')::boolean,false) THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
 WITH scope AS (
 SELECT w.id,w.monitoring_enabled,w.title,w.radicado FROM public.work_items w
 WHERE w.deleted_at IS NULL AND (p_work_item_id IS NULL OR w.id=p_work_item_id)
 ), latest AS (
 SELECT DISTINCT ON(t.work_item_id,t.provider,t.operation) t.* FROM public.work_item_sync_timeline t JOIN scope s ON s.id=t.work_item_id
 WHERE t.created_at>now()-interval '30 days'
 ORDER BY t.work_item_id,t.provider,t.operation,COALESCE(t.finished_at,t.started_at,t.created_at) DESC,t.id DESC
 ), ok AS (
 SELECT t.work_item_id,t.provider,t.operation,max(COALESCE(t.finished_at,t.started_at)) at FROM public.work_item_sync_timeline t JOIN scope s ON s.id=t.work_item_id
 WHERE (t.status = 'success' AND t.error_code IS NULL AND btrim(COALESCE(t.provider,'')) <> '' AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(lower(t.provider), '[+,/|]') tok WHERE btrim(tok) IN ('','unknown','none'))) AND t.created_at>now()-interval '90 days' GROUP BY 1,2,3
 ), candidates AS (
 SELECT s.* FROM scope s WHERE (p_after IS NULL OR s.id>p_after) AND (
 (s.monitoring_enabled AND NOT EXISTS(SELECT 1 FROM latest l WHERE l.work_item_id=s.id)) OR EXISTS(SELECT 1 FROM latest l WHERE l.work_item_id=s.id AND NOT (l.status = 'success' AND l.error_code IS NULL AND btrim(COALESCE(l.provider,'')) <> '' AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(lower(l.provider), '[+,/|]') tok WHERE btrim(tok) IN ('','unknown','none')))))
 ORDER BY s.id LIMIT lim+1
 ), page AS (SELECT * FROM candidates ORDER BY id LIMIT lim)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('work_item_id',p.id,'title',p.title,'radicado',p.radicado,'monitoring_enabled',p.monitoring_enabled,
 'no_recent_check',NOT EXISTS(SELECT 1 FROM latest l WHERE l.work_item_id=p.id),
 'sync_checks',COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',l.provider,'operation',l.operation,'status',l.status,'error_code',l.error_code,'successful_check',(l.status = 'success' AND l.error_code IS NULL AND btrim(COALESCE(l.provider,'')) <> '' AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(lower(l.provider), '[+,/|]') tok WHERE btrim(tok) IN ('','unknown','none'))),'started_at',l.started_at,'finished_at',l.finished_at,'records_inserted',l.records_inserted,'records_skipped',l.records_skipped,'last_success_at',o.at) ORDER BY l.provider,l.operation) FROM latest l LEFT JOIN ok o USING(work_item_id,provider,operation) WHERE l.work_item_id=p.id),'[]'::jsonb)) ORDER BY p.id),'[]'::jsonb),
 (SELECT count(*)>lim FROM candidates) INTO rows_json,more FROM page p;
 last_id:=((rows_json->(jsonb_array_length(rows_json)-1))->>'work_item_id')::uuid;
 RETURN jsonb_build_object('items',rows_json,'has_more',more,'next_after',CASE WHEN more THEN last_id END,'window','Latest 30 days; last success 90 days; current RLS-visible rows only');
END $function$;

