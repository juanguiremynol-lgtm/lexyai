-- Exercise the classifier extracted from the installed function without test data writes.
DO $test$
DECLARE
  fn regprocedure := 'public.mcp_list_freshness_issues(uuid,integer,uuid)'::regprocedure;
  definition text := pg_get_functiondef(fn);
  classifier text;
  failures integer;
BEGIN
  IF (SELECT prosecdef FROM pg_proc WHERE oid=fn) OR has_function_privilege('anon',fn,'EXECUTE')
     OR NOT has_function_privilege('authenticated',fn,'EXECUTE') THEN
    RAISE EXCEPTION 'MCP privilege regression';
  END IF;
  classifier := 'daily_gaps AS (' || split_part(split_part(definition,'), daily_gaps AS (',2),'), candidates AS (',1) || ')';
  classifier := replace(classifier,'now()', $$timestamptz '2030-11-20 15:00:00+00'$$);
  EXECUTE $fixture$
    WITH cases(n,provider,status,stamp,source_complete,plan_complete,error_code,expected) AS (VALUES
     (1,'cpnu','empty','2030-11-20T11:00:00Z',true,true,null::text,null::text),
     (2,'publicaciones','empty','2030-11-20T11:00:00Z',true,false,null,'DAILY_SOURCE_PLAN_INCOMPLETE'),
     (3,'publicaciones','empty','2030-11-20T11:00:00Z',true,true,null,null),
     (4,'samai','empty','2030-11-20T11:00:00Z',false,true,null,'DAILY_SOURCE_INCOMPLETE'),
     (5,'cpnu','empty','2030-11-20T04:59:59Z',true,true,null,'DAILY_SOURCE_OBSERVATION_OUTSIDE_TODAY'),
     (6,'cpnu','empty','2030-11-20T11:00:00Z',true,true,'TIMEOUT','DAILY_SOURCE_CHECK_UNVERIFIED'),
     (7,'cpnu','partial','2030-11-20T11:00:00Z',true,true,null,'DAILY_SOURCE_CHECK_UNVERIFIED'),
     (8,'samai_estados','success','2030-11-20T11:00:00Z',true,true,null,null)),
    expected_sources AS (SELECT n AS work_item_id,provider,public.provider_scope(provider) AS operation FROM cases),
    latest AS (SELECT n AS work_item_id,n AS id,provider, public.provider_scope(provider) AS operation,
      timestamptz '2030-11-20 12:00:00+00' AS finished_at,status,error_code,
      jsonb_build_object('source_observed_at',stamp,'source_complete',source_complete,
        'pp_window',jsonb_build_object('daily_plan_complete',plan_complete)) AS metadata FROM cases),
  $fixture$ || classifier || $assert$
    SELECT count(*) FROM cases c LEFT JOIN daily_gaps g ON c.n=g.work_item_id
    WHERE g.work_item_id IS NULL OR g.reason IS DISTINCT FROM c.expected
  $assert$ INTO failures;
  IF failures <> 0 THEN RAISE EXCEPTION 'Empty coverage classifier failed % cases', failures; END IF;
END;
$test$;
