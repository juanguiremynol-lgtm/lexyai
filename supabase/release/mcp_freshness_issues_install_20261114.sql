-- Install/verify final mcp_list_freshness_issues (md5 4bd7db655d8b4258749ed903cee3a391)
-- NOT APPLIED by its author. Live database already matches the target (verified 2026-11-14); running it is a verification no-op.
-- Source of truth: public.audit_logs (org a0000000-...0001) actions
-- TECHNICAL_MCP_FRESHNESS_DETAILS (46a6b04f), TECHNICAL_MCP_FRESHNESS_SCOPE (d656a132),
-- TECHNICAL_MCP_PP_DAILY_PLAN_GAP (813949eb). Hash chain:
-- 0fa53a1746f17f2bf5532fdb3510879a -> 6c98e7e8dcb895ed4d3aa303b04f5869 -> 140047e37f07f1c1cbdc322b5d558002 -> 4bd7db655d8b4258749ed903cee3a391
-- Idempotent: no-op when already at target; aborts on any unknown version.
-- CREATE OR REPLACE keeps the existing ACL; signature and SECURITY INVOKER unchanged.
BEGIN;
DO $guard$
DECLARE v_hash text; v_definer boolean;
BEGIN
  IF to_regprocedure('public.mcp_list_freshness_issues(uuid,integer,uuid)') IS NULL THEN RAISE EXCEPTION 'function missing'; END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public.mcp_list_freshness_issues(uuid,integer,uuid)')::oid)) INTO v_hash;
  IF v_hash = '4bd7db655d8b4258749ed903cee3a391' THEN RAISE NOTICE 'already at target %', v_hash; RETURN; END IF;
  IF v_hash NOT IN ('0fa53a1746f17f2bf5532fdb3510879a','6c98e7e8dcb895ed4d3aa303b04f5869','140047e37f07f1c1cbdc322b5d558002') THEN RAISE EXCEPTION 'unknown mcp_list_freshness_issues version %', v_hash; END IF;
  EXECUTE $body$CREATE OR REPLACE FUNCTION public.mcp_list_freshness_issues(p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_work_item_id uuid DEFAULT NULL::uuid)
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
 WHERE w.deleted_at IS NULL AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND (p_work_item_id IS NULL OR w.id=p_work_item_id)
 ), latest AS (
 SELECT DISTINCT ON(t.work_item_id,t.provider,t.operation) t.* FROM public.work_item_sync_timeline t JOIN scope s ON s.id=t.work_item_id
 WHERE t.created_at>now()-interval '30 days' AND lower(btrim(coalesce(t.provider,''))) NOT IN ('','unknown','none')
 ORDER BY t.work_item_id,t.provider,t.operation,COALESCE(t.finished_at,t.started_at,t.created_at) DESC,t.id DESC
 ), ok AS (
 SELECT t.work_item_id,t.provider,t.operation,max(COALESCE(t.finished_at,t.started_at)) at FROM public.work_item_sync_timeline t JOIN scope s ON s.id=t.work_item_id
 WHERE (t.status = 'success' AND t.error_code IS NULL AND btrim(COALESCE(t.provider,'')) <> '' AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(lower(t.provider), '[+,/|]') tok WHERE btrim(tok) IN ('','unknown','none'))) AND t.created_at>now()-interval '90 days' GROUP BY 1,2,3
 ), candidates AS (
 SELECT s.* FROM scope s WHERE (p_after IS NULL OR s.id>p_after) AND (
 (s.monitoring_enabled AND NOT EXISTS(SELECT 1 FROM latest l WHERE l.work_item_id=s.id)) OR EXISTS(SELECT 1 FROM latest l WHERE l.work_item_id=s.id AND l.provider='publicaciones' AND l.status='success' AND (l.metadata->'pp_window'->>'daily_plan_complete') IS DISTINCT FROM 'true')
 OR EXISTS(SELECT 1 FROM latest l WHERE l.work_item_id=s.id AND NOT (l.status = 'success' AND l.error_code IS NULL AND btrim(COALESCE(l.provider,'')) <> '' AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(lower(l.provider), '[+,/|]') tok WHERE btrim(tok) IN ('','unknown','none')))))
 ORDER BY s.id LIMIT lim+1
 ), page AS (SELECT * FROM candidates ORDER BY id LIMIT lim)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('work_item_id',p.id,'title',p.title,'radicado',p.radicado,'monitoring_enabled',p.monitoring_enabled,
 'no_recent_check',NOT EXISTS(SELECT 1 FROM latest l WHERE l.work_item_id=p.id),
 'sync_checks',COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',l.provider,'operation',l.operation,'status', CASE
    WHEN lower(btrim(coalesce(l.status, ''))) IN ('success', 'success_empty', 'empty')
      AND NOT (
        l.status = 'success'
        AND l.error_code IS NULL
        AND btrim(coalesce(l.provider, '')) <> ''
        AND NOT EXISTS (
          SELECT 1 FROM regexp_split_to_table(lower(coalesce(l.provider, '')), '[+,/|]') tok
          WHERE btrim(tok) IN ('', 'unknown', 'none')
        )
      )
    THEN 'unverified'
    ELSE l.status
  END,'error_code',l.error_code,'successful_check',(l.status = 'success' AND l.error_code IS NULL AND btrim(COALESCE(l.provider,'')) <> '' AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(lower(l.provider), '[+,/|]') tok WHERE btrim(tok) IN ('','unknown','none'))),'started_at',l.started_at,'finished_at',l.finished_at,'records_inserted',l.records_inserted,'records_skipped',l.records_skipped,'last_success_at',o.at,
 'source_complete',CASE WHEN l.metadata->>'source_complete' IN('true','false') THEN (l.metadata->>'source_complete')::boolean ELSE NULL END,
 'source_observed_at',left(l.metadata->>'source_observed_at',60),
 'source_query_attempted',CASE WHEN l.metadata->>'source_query_attempted' IN('true','false') THEN (l.metadata->>'source_query_attempted')::boolean ELSE NULL END,
 'daily_plan_complete', CASE WHEN jsonb_typeof(l.metadata->'pp_window'->'daily_plan_complete')='boolean' THEN (l.metadata->'pp_window'->>'daily_plan_complete')::boolean ELSE NULL END,
 'verified_source_complete', (l.status='success' AND l.error_code IS NULL AND l.metadata->>'source_complete'='true'),
 'verified_full_daily_plan', CASE WHEN l.provider='publicaciones' THEN (l.status='success' AND l.error_code IS NULL AND l.metadata->>'source_complete'='true' AND l.metadata->'pp_window'->>'daily_plan_complete'='true') ELSE NULL END,
 'publicaciones_blocker',CASE WHEN l.provider='publicaciones' AND l.status IS DISTINCT FROM 'success' THEN
 jsonb_build_object(
 'upstream_cause',CASE WHEN (l.metadata->'stored_result_read'->>'cause') ~ '^[A-Z][A-Z0-9_]{0,99}$' THEN l.metadata->'stored_result_read'->>'cause' ELSE NULL END,
 'upstream_status',left(l.metadata->'stored_result_read'->>'status',40),
 'backend_run_id',CASE WHEN (l.metadata->'stored_result_read'->>'backend_run_id') ~ '^[0-9a-f-]{36}$' THEN l.metadata->'stored_result_read'->>'backend_run_id' ELSE NULL END,
 'checkpoint_next',CASE WHEN (l.metadata->'stored_result_read'->'checkpoint'->>'next') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN l.metadata->'stored_result_read'->'checkpoint'->>'next' ELSE NULL END,
 'identity_match',CASE WHEN jsonb_typeof(l.metadata->'stored_result_read'->'identity_match')='boolean' THEN l.metadata->'stored_result_read'->'identity_match' ELSE NULL END,
 'persistence_complete',CASE WHEN jsonb_typeof(l.metadata->'stored_result_read'->'persistence_complete')='boolean' THEN l.metadata->'stored_result_read'->'persistence_complete' ELSE NULL END,
 'daily_plan_complete',CASE WHEN jsonb_typeof(l.metadata->'pp_window'->'daily_plan_complete')='boolean' THEN l.metadata->'pp_window'->'daily_plan_complete' ELSE NULL END
 ) ELSE NULL END) ORDER BY l.provider,l.operation) FROM latest l LEFT JOIN ok o USING(work_item_id,provider,operation) WHERE l.work_item_id=p.id),'[]'::jsonb)) ORDER BY p.id),'[]'::jsonb),
 (SELECT count(*)>lim FROM candidates) INTO rows_json,more FROM page p;
 last_id:=((rows_json->(jsonb_array_length(rows_json)-1))->>'work_item_id')::uuid;
 RETURN jsonb_build_object('items',rows_json,'has_more',more,'next_after',CASE WHEN more THEN last_id END,'window','Latest 30 days; last success 90 days; current RLS-visible rows only');
END $function$$body$;
END
$guard$;
DO $verify$
DECLARE v_hash text; v_definer boolean;
BEGIN
  SELECT md5(pg_get_functiondef(to_regprocedure('public.mcp_list_freshness_issues(uuid,integer,uuid)')::oid)) INTO v_hash;
  IF v_hash <> '4bd7db655d8b4258749ed903cee3a391' THEN RAISE EXCEPTION 'post-check hash mismatch %', v_hash; END IF;
  SELECT p.prosecdef INTO v_definer FROM pg_proc p WHERE p.oid = to_regprocedure('public.mcp_list_freshness_issues(uuid,integer,uuid)');
  IF v_definer THEN RAISE EXCEPTION 'mcp_list_freshness_issues must remain SECURITY INVOKER'; END IF;
  IF has_function_privilege('anon','public.mcp_list_freshness_issues(uuid,integer,uuid)','EXECUTE') THEN RAISE EXCEPTION 'anon must not execute mcp_list_freshness_issues'; END IF;
  IF NOT has_function_privilege('authenticated','public.mcp_list_freshness_issues(uuid,integer,uuid)','EXECUTE') THEN RAISE EXCEPTION 'authenticated must execute mcp_list_freshness_issues'; END IF;
END
$verify$;
COMMIT;
