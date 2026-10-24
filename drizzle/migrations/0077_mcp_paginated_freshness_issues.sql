-- Independent bounded keyset issue page; invoker preserves matter AND source RLS.
CREATE FUNCTION public.mcp_list_freshness_issues(p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50,p_work_item_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $fn$
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
 WHERE t.status='success' AND t.created_at>now()-interval '90 days' GROUP BY 1,2,3
 ), candidates AS (
 SELECT s.* FROM scope s WHERE (p_after IS NULL OR s.id>p_after) AND (
 (s.monitoring_enabled AND NOT EXISTS(SELECT 1 FROM latest l WHERE l.work_item_id=s.id)) OR EXISTS(SELECT 1 FROM latest l WHERE l.work_item_id=s.id AND l.status IS DISTINCT FROM 'success'))
 ORDER BY s.id LIMIT lim+1
 ), page AS (SELECT * FROM candidates ORDER BY id LIMIT lim)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('work_item_id',p.id,'title',p.title,'radicado',p.radicado,'monitoring_enabled',p.monitoring_enabled,
 'no_recent_check',NOT EXISTS(SELECT 1 FROM latest l WHERE l.work_item_id=p.id),
 'sync_checks',COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',l.provider,'operation',l.operation,'status',l.status,'error_code',l.error_code,'successful_check',l.status='success','started_at',l.started_at,'finished_at',l.finished_at,'records_inserted',l.records_inserted,'records_skipped',l.records_skipped,'last_success_at',o.at) ORDER BY l.provider,l.operation) FROM latest l LEFT JOIN ok o USING(work_item_id,provider,operation) WHERE l.work_item_id=p.id),'[]'::jsonb)) ORDER BY p.id),'[]'::jsonb),
 (SELECT count(*)>lim FROM candidates) INTO rows_json,more FROM page p;
 last_id:=((rows_json->(jsonb_array_length(rows_json)-1))->>'work_item_id')::uuid;
 RETURN jsonb_build_object('items',rows_json,'has_more',more,'next_after',CASE WHEN more THEN last_id END,'window','Latest 30 days; last success 90 days; current RLS-visible rows only');
END $fn$;
REVOKE ALL ON FUNCTION public.mcp_list_freshness_issues(uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mcp_list_freshness_issues(uuid,integer,uuid) TO authenticated,service_role;
DO $attach$ DECLARE s text; BEGIN
 SELECT pg_get_functiondef('public._mcp_feed_freshness(uuid,uuid[])'::regprocedure) INTO s;
 s:=replace(s,'''window'', jsonb_build_object(','''issues'', public.mcp_list_freshness_issues(NULL,50,p_work_item_id), ''window'', jsonb_build_object(');
 EXECUTE s;
END $attach$;