DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role',true) $$;
CREATE TABLE public.sync_retry_queue(id uuid primary key, work_item_id uuid, kind text, attempt int, max_attempts int, lease_token uuid, claimed_at timestamptz, next_run_at timestamptz, last_error_code text, last_error_message text);
CREATE TABLE public.sync_retry_outcomes(task_id uuid UNIQUE, work_item_id uuid, kind text, attempt int, outcome text, error_code text, result jsonb);
\ir ../migrations/20261028030000_retry_provider_deferral.sql
SELECT set_config('test.role','service_role',false);
INSERT INTO sync_retry_queue VALUES('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','PUB_RETRY',2,4,'cccccccc-cccc-cccc-cccc-cccccccccccc',now(),now(),'old','history');
DO $$ BEGIN
 IF public.finish_sync_retry('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','dddddddd-dddd-dddd-dddd-dddddddddddd','DEFERRED','PROVIDER_BREAKER_OPEN','{}',900) THEN RAISE EXCEPTION 'stale lease succeeded'; END IF;
 IF NOT public.finish_sync_retry('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc','DEFERRED','PROVIDER_BREAKER_OPEN','{}',900) THEN RAISE EXCEPTION 'deferral rejected'; END IF;
 IF NOT EXISTS (SELECT 1 FROM sync_retry_queue WHERE attempt=2 AND lease_token IS NULL AND claimed_at IS NULL AND next_run_at > now()+interval '899 seconds' AND last_error_code='PROVIDER_BREAKER_OPEN') THEN RAISE EXCEPTION 'deferral lost budget or claim'; END IF;
 IF public.finish_sync_retry('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc','DEFERRED','PROVIDER_BREAKER_OPEN','{}',900) THEN RAISE EXCEPTION 'repeat succeeded'; END IF;
END $$;
UPDATE sync_retry_queue SET lease_token='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',claimed_at=now();
DO $$ BEGIN
 IF NOT public.finish_sync_retry('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','RETRY','HTTP_502','{}',900) THEN RAISE EXCEPTION 'retry rejected'; END IF;
 IF NOT EXISTS (SELECT 1 FROM sync_retry_queue WHERE attempt=3 AND lease_token IS NULL) THEN RAISE EXCEPTION 'real retry not charged'; END IF;
END $$;
SELECT set_config('test.role','anon',false);
DO $$ BEGIN
 BEGIN PERFORM public.finish_sync_retry('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','DEFERRED','PROVIDER_BREAKER_OPEN','{}',900); RAISE EXCEPTION 'anonymous accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
