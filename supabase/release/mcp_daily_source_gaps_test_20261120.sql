-- Run after installation; checks the live classifier using read-only synthetic rows.
DO $test$
DECLARE
  fn regprocedure := 'public.mcp_list_freshness_issues(uuid,integer,uuid)'::regprocedure;
  definition text := pg_get_functiondef(fn);
  classifier text;
  violations int;
BEGIN
  IF md5(definition) <> 'f0a71fdfe649cfbfe9096b32a9e1f459' THEN RAISE EXCEPTION 'Unexpected function revision'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid=fn) OR has_function_privilege('anon',fn,'EXECUTE')
     OR NOT has_function_privilege('authenticated',fn,'EXECUTE') THEN
    RAISE EXCEPTION 'MCP privilege regression';
  END IF;
  classifier := 'daily_gaps AS (' || split_part(split_part(definition, '), daily_gaps AS (',2), '), candidates AS (',1) || ')';
  classifier := replace(classifier,'now()', $$timestamptz '2030-11-20 15:00:00+00'$$);
  EXECUTE $fixture$
    WITH cases(n,provider,stamp,complete,ok_plan,fin,verdict,expected) AS (VALUES
     (1,'cpnu','2030-11-20T05:00:00Z',true,true,'2030-11-20T06:00:00Z','success',null::text),
     (2,'samai','2030-11-20T04:59:59Z',true,true,'2030-11-20T06:00:00Z','success','DAILY_SOURCE_OBSERVATION_OUTSIDE_TODAY'),
     (3,'samai','2030-11-20T15:30:00Z',true,true,'2030-11-20T15:31:00Z','success','DAILY_SOURCE_OBSERVATION_OUTSIDE_TODAY'),
     (4,'samai',null,true,true,'2030-11-20T06:00:00Z','success','DAILY_SOURCE_OBSERVATION_UNVERIFIED'),
     (5,'samai','2030-11-39T00:00:00Z',true,true,'2030-11-20T06:00:00Z','success','DAILY_SOURCE_OBSERVATION_UNVERIFIED'),
     (6,'samai','2030-11-20T05:01:00',true,true,'2030-11-20T06:00:00Z','success','DAILY_SOURCE_OBSERVATION_UNVERIFIED'),
     (7,'publicaciones','2030-11-20T06:00:00Z',true,false,'2030-11-20T06:00:00Z','success','DAILY_SOURCE_PLAN_INCOMPLETE'),
     (8,'samai_estados','2030-11-20T06:00:00Z',false,true,'2030-11-20T06:00:00Z','success','DAILY_SOURCE_INCOMPLETE'),
     (9,'samai','2030-11-20T06:00:00Z',true,true,null,'success','DAILY_SOURCE_COMPLETION_UNVERIFIED'),
     (10,'samai','2030-11-20T06:00:00Z',true,true,'2030-11-20T06:00:00Z','partial','DAILY_SOURCE_CHECK_UNVERIFIED'),
     (11,'samai','2030-11-20T06:00:00Z',true,true,'2030-11-20T06:00:00Z','missing','DAILY_SOURCE_WITHOUT_INDIVIDUAL_TRACE'),
     (12,'publicaciones','2030-11-20T01:10:00-05:00',true,true,'2030-11-20T06:11:00Z','success',null)),
    expected_sources AS (SELECT n AS work_item_id, provider, public.provider_scope(provider) AS operation FROM cases),
    latest AS (SELECT n AS work_item_id,n AS id,provider, public.provider_scope(provider) AS operation,
               fin::timestamptz AS finished_at,verdict AS status,null::text AS error_code,
               jsonb_build_object('source_observed_at',stamp,'source_complete',complete,'pp_window',jsonb_build_object('daily_plan_complete',ok_plan)) AS metadata
               FROM cases WHERE verdict <> 'missing'),
  $fixture$ || classifier || $assert$
    SELECT count(*) FROM cases c LEFT JOIN daily_gaps g ON c.n=g.work_item_id
    WHERE g.work_item_id IS NULL OR g.reason IS DISTINCT FROM c.expected
  $assert$ INTO violations;
  IF violations <> 0 THEN RAISE EXCEPTION 'Daily classifier failed % cases',violations; END IF;
END;
$test$;
