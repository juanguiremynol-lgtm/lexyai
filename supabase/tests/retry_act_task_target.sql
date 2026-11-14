-- Isolated disposable database only. No production work item or queue row is used.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role',true) $$;
CREATE TABLE public.sync_retry_queue(
  id uuid primary key, work_item_id uuid, kind text, attempt int, max_attempts int,
  lease_token uuid, claimed_at timestamptz, next_run_at timestamptz,
  last_error_code text, last_error_message text, created_at timestamptz DEFAULT now()
);
\ir ../../drizzle/migrations/0104_retry_act_task_target.sql

SELECT set_config('test.role','service_role',false);
INSERT INTO public.sync_retry_queue(id,work_item_id,kind,attempt,max_attempts,claimed_at,next_run_at) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ACT_SCRAPE_RETRY',2,3,NULL,now()-interval '1 minute'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc','ACT_SCRAPE_RETRY',1,3,NULL,now()+interval '1 hour'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbd','ACT_SCRAPE_RETRY',1,3,now(),now()-interval '1 minute'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbe','ACT_SCRAPE_RETRY',1,3,now()-interval '11 minutes',now()-interval '1 minute'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbf','PUB_RETRY',1,3,NULL,now()-interval '1 minute');

DO $$ BEGIN
  IF (SELECT count(*) FROM public.claim_sync_retry_act_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> 1 THEN
    RAISE EXCEPTION 'due ACT task was not claimed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sync_retry_queue WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    AND lease_token IS NOT NULL AND claimed_at IS NOT NULL AND attempt=2 AND max_attempts=3) THEN
    RAISE EXCEPTION 'claim changed attempts or omitted fencing';
  END IF;
  IF (SELECT count(*) FROM public.claim_sync_retry_act_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) <> 0 THEN
    RAISE EXCEPTION 'fresh claim was claimed twice';
  END IF;
  IF (SELECT count(*) FROM public.claim_sync_retry_act_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad')) <> 1 THEN
    RAISE EXCEPTION 'expired claim was not recoverable';
  END IF;
  IF (SELECT count(*) FROM public.claim_sync_retry_act_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab')) <> 0 THEN
    RAISE EXCEPTION 'future task was claimed';
  END IF;
  IF (SELECT count(*) FROM public.claim_sync_retry_act_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac')) <> 0 THEN
    RAISE EXCEPTION 'active lease was claimed';
  END IF;
  IF (SELECT count(*) FROM public.claim_sync_retry_act_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaae')) <> 0 THEN
    RAISE EXCEPTION 'PUB task leaked into ACT claim';
  END IF;
END $$;

SELECT set_config('test.role','anon',false);
DO $$ BEGIN
  BEGIN
    PERFORM public.claim_sync_retry_act_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'anonymous caller accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('test.role','service_role',false);
DO $$ BEGIN
  IF has_function_privilege('anon','public.claim_sync_retry_act_task(uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.claim_sync_retry_act_task(uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.claim_sync_retry_act_task(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'incorrect RPC privileges';
  END IF;
END $$;
