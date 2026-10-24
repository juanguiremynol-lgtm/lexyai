-- Andromeda MCP feed acceptance: synthetic fixtures, one connection, rollback only.
-- Prepared from the live schema and public RPC contracts on 2026-10-24.
-- NOT executed by this author. Run the entire batch as the database owner.
-- No existing user/work-item IDs, credentials, radicados, or provider URLs are used.
-- All fixture writes, trigger-produced queues and cursor state remain uncommitted.
-- No trigger is disabled. On an unexpected SQL error the transaction is aborted:
-- issue ROLLBACK / close that connection; NEVER COMMIT this test transaction.
-- Expected behavioral regressions are recorded as FAIL, not disguised as exceptions.
-- Response-shape assumptions are limited to the documented public JSON keys:
-- events/has_more/next_cursor and freshness.items[].sync_checks[]. If the final public
-- contract renames those keys, adapt extraction paths only; retain the assertions.
-- No assumptions are made about the bytes/schema inside an opaque cursor.

BEGIN;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '5s';

-- Do not inherit the SQL caller's PostgREST JWT context. Legacy scalar claim GUCs
-- can take precedence over request.jwt.claims in auth.uid()/backend checks.
RESET ROLE;
DO $clear_claims$
BEGIN
  PERFORM set_config('request.jwt.claims','{}',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claim.role','',true);
  PERFORM set_config('request.jwt.claim.email','',true);
END;
$clear_claims$;

CREATE TEMP TABLE feed_acceptance_results (
  test_name text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('PASS', 'FAIL', 'SKIP')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
) ON COMMIT DROP;

-- Calls the real RPC under authenticated RLS. Unexpected errors are rethrown.
CREATE FUNCTION pg_temp.feed_call(
  claims jsonb, cursor_value text, page_size integer, item_id uuid,
  reconcile_from timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', claims::text, true);
  SET LOCAL ROLE authenticated;
  IF reconcile_from IS NULL THEN
    result := public.mcp_list_updates(cursor_value, page_size, item_id);
  ELSE
    result := public.mcp_reconcile_updates(reconcile_from, page_size, item_id);
  END IF;
  RESET ROLE;
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RAISE; -- A schema/setup/runtime error is not a passing denial test.
END;
$fn$;

CREATE FUNCTION pg_temp.expect_feed_rejection(
  test_label text, claims jsonb, cursor_value text, item_id uuid
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE result jsonb; rejected boolean := false; errstate text; errmsg text;
BEGIN
  BEGIN
    result := pg_temp.feed_call(claims, cursor_value, 2, item_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS errstate = RETURNED_SQLSTATE, errmsg = MESSAGE_TEXT;
    -- Only documented cursor/auth denials qualify. Missing functions/columns,
    -- permissions on test helpers, timeouts, and arbitrary errors fail the run.
    IF errstate IN ('MCP22', 'MCP09', '42501')
       AND (errmsg ~* '^CURSOR_' OR errmsg ~* '^(not authenticated|not authorized|no autorizado)') THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  INSERT INTO feed_acceptance_results(test_name, status, detail)
  VALUES (test_label, CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
          jsonb_build_object('sqlstate', errstate, 'message', errmsg,
                             'unexpected_result', CASE WHEN NOT rejected THEN result END));
END;
$fn$;

DO $test$
DECLARE
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid();
  oa uuid := gen_random_uuid(); ob uuid := gen_random_uuid();
  wa uuid := gen_random_uuid(); wb uuid := gen_random_uuid();
  old_correct uuid := gen_random_uuid(); old_archive uuid := gen_random_uuid();
  quiet_sentinel uuid := gen_random_uuid(); fixture_id uuid;
  claim_a jsonb; claim_b jsonb;
  equal_stamp timestamptz := now() - interval '1 hour';
  old_stamp timestamptz := now() - interval '45 days';
  sentinel_stamp timestamptz := now() - interval '3 days 20 minutes';
  expected_ids uuid[] := ARRAY[]::uuid[];
  observed_ids uuid[] := ARRAY[]::uuid[];
  observed_keys text[] := ARRAY[]::text[];
  page jsonb; ev jsonb; fresh jsonb; qpage jsonb;
  cursor_value text; previous_cursor text; cursor_a text; quiet_cursor text;
  pages integer := 0; i integer; n integer; n_distinct integer;
  no_regression boolean := true; quiet_empty boolean;
  has_failure boolean; no_foreign_freshness boolean;
BEGIN
  -- Synthetic native sessions follow the existing auth acceptance-test pattern.
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES (ua,'authenticated','authenticated','feed-a-'||ua||'@example.invalid',now(),'{}','{}',now(),now()),
         (ub,'authenticated','authenticated','feed-b-'||ub||'@example.invalid',now(),'{}','{}',now(),now());
  INSERT INTO auth.sessions(id,user_id,oauth_client_id) VALUES (sa,ua,NULL),(sb,ub,NULL);
  INSERT INTO public.organizations(id,name,type)
  VALUES (oa,'MCP feed fixture A '||oa,'personal'),(ob,'MCP feed fixture B '||ob,'personal');
  INSERT INTO public.organization_memberships(organization_id,user_id,role)
  VALUES (oa,ua,'OWNER'),(ob,ub,'OWNER');
  claim_a := jsonb_build_object('sub',ua,'role','authenticated','session_id',sa);
  claim_b := jsonb_build_object('sub',ub,'role','authenticated','session_id',sb);

  -- DRAFTED, no radicado, no monitoring: no provider request is appropriate.
  -- Direct fixture insertion intentionally tests the feed, not the creation RPC.
  INSERT INTO public.work_items(id,owner_id,organization_id,workflow_type,stage,title,
                               monitoring_enabled,scraping_enabled,created_at,updated_at,lifecycle_changed_at)
  VALUES (wa,ua,oa,'CGP','DRAFTED','MCP feed fixture A',false,false,old_stamp,old_stamp,old_stamp),
         (wb,ub,ob,'CGP','DRAFTED','MCP feed quiet fixture B',false,false,old_stamp,old_stamp,old_stamp);
  -- Verified insert triggers preserve this explicit lifecycle timestamp and do
  -- not enroll a provider when radicado is NULL. Fail setup clearly if that
  -- contract changes, rather than blaming an unexpected fixture event on the feed.
  IF EXISTS(SELECT 1 FROM public.work_items WHERE id IN (wa,wb)
      AND (lifecycle_changed_at IS DISTINCT FROM old_stamp OR monitoring_enabled IS DISTINCT FROM false)) THEN
    RAISE EXCEPTION 'Fixture setup changed: lifecycle timestamp/monitoring invariant differs from inspected schema';
  END IF;

  -- Six actuaciones and two estados share an exact revision timestamp.
  -- Distinct descriptions/titles avoid structural-deduplication collisions.
  FOR i IN 1..6 LOOP
    fixture_id := gen_random_uuid();
    expected_ids := array_append(expected_ids,fixture_id);
    INSERT INTO public.work_item_acts(id,owner_id,organization_id,work_item_id,description,hash_fingerprint,
      source,act_date,created_at,updated_at,detected_at,last_seen_at,content_hash,is_archived)
    VALUES (fixture_id,ua,oa,wa,'Nota sintética de prueba '||fixture_id,'feed-test-'||fixture_id,
      'manual',(old_stamp AT TIME ZONE 'America/Bogota')::date,old_stamp,equal_stamp,old_stamp,equal_stamp,'fixture-'||i,false);
  END LOOP;
  FOR i IN 1..2 LOOP
    fixture_id := gen_random_uuid();
    expected_ids := array_append(expected_ids,fixture_id);
    INSERT INTO public.work_item_publicaciones(id,organization_id,work_item_id,title,hash_fingerprint,
      source,published_at,fecha_fijacion,created_at,updated_at,detected_at,last_seen_at,content_hash,is_archived)
    VALUES (fixture_id,oa,wa,'Estado electrónico sintético '||fixture_id,'feed-test-'||fixture_id,
      'manual',old_stamp,old_stamp,old_stamp,equal_stamp,old_stamp,equal_stamp,'fixture-pub-'||i,false);
  END LOOP;

  INSERT INTO public.work_item_acts(id,owner_id,organization_id,work_item_id,description,hash_fingerprint,
    source,act_date,created_at,updated_at,detected_at,last_seen_at,content_hash,is_archived)
  VALUES (old_correct,ua,oa,wa,'Enriquecimiento sintético '||old_correct,'feed-test-'||old_correct,
      'manual',(old_stamp AT TIME ZONE 'America/Bogota')::date,old_stamp,old_stamp,old_stamp,old_stamp,'before-correction',false),
    (old_archive,ua,oa,wa,'Archivo sintético '||old_archive,'feed-test-'||old_archive,
      'manual',(old_stamp AT TIME ZONE 'America/Bogota')::date,old_stamp,old_stamp,old_stamp,old_stamp,'before-archive',false),
    (quiet_sentinel,ub,ob,wb,'Centinela sintético '||quiet_sentinel,'feed-test-'||quiet_sentinel,
      'manual',(old_stamp AT TIME ZONE 'America/Bogota')::date,old_stamp,sentinel_stamp,old_stamp,sentinel_stamp,'quiet-sentinel',false);

  -- Explicit source evidence for a matter with no events inside the default window.
  INSERT INTO public.work_item_sync_timeline(work_item_id,organization_id,provider,operation,status,
    error_code,started_at,finished_at)
  VALUES (wb,ob,'cpnu','acts','success',NULL,now()-interval '2 hours 1 minute',now()-interval '2 hours'),
         (wb,ob,'cpnu','acts','error','MCP_SYNTHETIC_PROVIDER_FAILURE',now()-interval '2 minutes',now()-interval '1 minute'),
         (wb,ob,'samai','acts','success',NULL,now()-interval '3 minutes',now()-interval '2 minutes');

  -- Page a fixed fixture set. No cursor internals are decoded or assumed.
  page := pg_temp.feed_call(claim_a,NULL,2,wa,now()-interval '2 days');
  LOOP
    pages := pages+1;
    IF jsonb_typeof(page->'events') IS DISTINCT FROM 'array'
       OR jsonb_typeof(page->'has_more') IS DISTINCT FROM 'boolean'
       OR NULLIF(page->>'next_cursor','') IS NULL THEN
      RAISE EXCEPTION 'Unexpected feed response shape: %',page;
    END IF;
    FOR ev IN SELECT value FROM jsonb_array_elements(page->'events') LOOP
      IF (ev->>'id')::uuid = ANY(expected_ids) THEN
        observed_ids := array_append(observed_ids,(ev->>'id')::uuid);
        observed_keys := array_append(observed_keys,ev->>'dedupe_key');
      END IF;
    END LOOP;
    cursor_value := page->>'next_cursor';
    EXIT WHEN NOT (page->>'has_more')::boolean;
    IF pages >= 20 OR cursor_value IS NOT DISTINCT FROM previous_cursor THEN
      INSERT INTO feed_acceptance_results VALUES ('pagination_terminates','FAIL',jsonb_build_object('pages',pages));
      EXIT;
    END IF;
    previous_cursor := cursor_value;
    page := pg_temp.feed_call(claim_a,cursor_value,2,wa);
  END LOOP;
  SELECT count(*),count(DISTINCT id) INTO n,n_distinct FROM unnest(observed_ids) id;
  INSERT INTO feed_acceptance_results VALUES ('equal_timestamp_multi_kind_pagination',
    CASE WHEN n=8 AND n_distinct=8 AND expected_ids <@ observed_ids THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('expected',8,'seen',n,'unique_seen',n_distinct,'pages',pages));
  INSERT INTO feed_acceptance_results VALUES ('stable_revision_dedupe_keys',
    CASE WHEN cardinality(observed_keys)=8 AND (SELECT count(DISTINCT k) FROM unnest(observed_keys) k)=8
              AND NOT EXISTS(SELECT 1 FROM unnest(observed_keys) k WHERE k IS NULL OR k='') THEN 'PASS' ELSE 'FAIL' END,'{}');
  cursor_a := cursor_value;

  -- Old detection timestamps must not suppress current enrichment/archive revisions.
  -- These are allowed mutable fields; immutable judicial facts remain unchanged.
  PERFORM set_config('request.jwt.claims',claim_a::text,true);
  UPDATE public.work_item_acts SET content_hash='after-correction',despacho='Despacho sintético corregido'
   WHERE id=old_correct;
  UPDATE public.work_item_acts SET is_archived=true,archived_reason='MCP_SYNTHETIC_TEST'
   WHERE id=old_archive;
  page := pg_temp.feed_call(claim_a,cursor_a,500,wa);
  INSERT INTO feed_acceptance_results VALUES ('old_detected_row_current_correction',
    CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(page->'events') e
      WHERE e->>'id'=old_correct::text AND e->'data'->>'content_hash'='after-correction'
        AND (e->'data'->>'detected_at')::timestamptz=old_stamp
        AND (e->>'change_ts')::timestamptz>old_stamp) THEN 'PASS' ELSE 'FAIL' END,'{}');
  INSERT INTO feed_acceptance_results VALUES ('old_detected_row_current_archive',
    CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(page->'events') e
      WHERE e->>'id'=old_archive::text AND (e->'data'->>'is_archived')::boolean IS TRUE
        AND (e->'data'->>'detected_at')::timestamptz=old_stamp) THEN 'PASS' ELSE 'FAIL' END,'{}');

  -- Public behavior detects backward-moving empty checkpoints without decoding them.
  -- The quiet sentinel predates the original 3-day window by 20 minutes.
  qpage := pg_temp.feed_call(claim_b,NULL,500,NULL);
  quiet_empty := jsonb_array_length(qpage->'events')=0;
  fresh := qpage->'freshness'->'items';
  has_failure := EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(NULLIF(fresh,'null'::jsonb),'[]'::jsonb)) f,
    LATERAL jsonb_array_elements(COALESCE(NULLIF(f->'sync_checks','null'::jsonb),'[]'::jsonb)) s
    WHERE f->>'work_item_id'=wb::text AND s->>'provider'='cpnu' AND s->>'operation'='acts'
      AND s->>'status'='error' AND s->>'error_code'='MCP_SYNTHETIC_PROVIDER_FAILURE'
      AND (s->>'successful_check')::boolean IS FALSE);
  no_foreign_freshness := NOT EXISTS(SELECT 1
    FROM jsonb_array_elements(COALESCE(NULLIF(fresh,'null'::jsonb),'[]'::jsonb)) f
    WHERE f->>'work_item_id' IS DISTINCT FROM wb::text);
  INSERT INTO feed_acceptance_results VALUES ('empty_portfolio_page_reports_provider_failure',
    CASE WHEN quiet_empty AND has_failure THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('empty_events',quiet_empty,'freshness',fresh));
  INSERT INTO feed_acceptance_results VALUES ('freshness_does_not_leak_foreign_matters',
    CASE WHEN no_foreign_freshness THEN 'PASS' ELSE 'FAIL' END,'{}');
  quiet_cursor := qpage->>'next_cursor';
  FOR i IN 1..5 LOOP
    qpage := pg_temp.feed_call(claim_b,quiet_cursor,500,NULL);
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(qpage->'events') e WHERE e->>'id'=quiet_sentinel::text)
      THEN no_regression:=false; END IF;
    quiet_cursor:=qpage->>'next_cursor';
  END LOOP;
  INSERT INTO feed_acceptance_results VALUES ('quiet_poll_does_not_walk_backward',
    CASE WHEN quiet_empty AND no_regression THEN 'PASS' ELSE 'FAIL' END,jsonb_build_object('polls',5));

  PERFORM pg_temp.expect_feed_rejection('foreign_user_cursor_rejected',claim_b,cursor_a,wa);
  PERFORM pg_temp.expect_feed_rejection('cursor_filter_change_rejected',claim_a,cursor_a,wb);
  PERFORM pg_temp.expect_feed_rejection('malformed_cursor_rejected',claim_a,'not-a-valid-feed-cursor',wa);
  PERFORM pg_temp.expect_feed_rejection('tampered_cursor_rejected',claim_a,cursor_a||'!',wa);

  INSERT INTO feed_acceptance_results VALUES
    ('cursor_version_and_expiry','SKIP',jsonb_build_object('reason',
      'Opaque format intentionally not decoded. Needs final cursor fixture API/table contract or clock-controlled test.')),
    ('late_commit_and_concurrent_pagination','SKIP',jsonb_build_object('reason',
      'A single rollback transaction cannot model independently committed sessions. Needs isolated multi-connection harness.')),
    ('hard_delete_tombstone_history','SKIP',jsonb_build_object('reason',
      'Current-state feed does not promise durable history; no purge is performed.'));
END;
$test$;

SELECT jsonb_build_object(
  'status',CASE WHEN count(*) FILTER(WHERE status='FAIL')=0 THEN 'PASS' ELSE 'FAIL' END,
  'passed',count(*) FILTER(WHERE status='PASS'),
  'failed',count(*) FILTER(WHERE status='FAIL'),
  'skipped',count(*) FILTER(WHERE status='SKIP'),
  'results',jsonb_agg(jsonb_build_object('test',test_name,'status',status,'detail',detail) ORDER BY test_name),
  'persistence','All fixture and cursor writes are rolled back by the next statement.'
) AS feed_acceptance
FROM feed_acceptance_results;

ROLLBACK;
