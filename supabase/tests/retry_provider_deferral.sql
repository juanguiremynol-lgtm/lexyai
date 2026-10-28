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
UPDATE sync_retry_queue SET lease_token='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',claimed_at=now();
DO $$ BEGIN
 IF NOT public.finish_sync_retry('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','DEFERRED','MONITORING_PAUSED','{}',86400) THEN RAISE EXCEPTION 'pause rejected'; END IF;
 IF NOT EXISTS (SELECT 1 FROM sync_retry_queue WHERE attempt=3 AND lease_token IS NULL AND next_run_at > now()+interval '23 hours') THEN RAISE EXCEPTION 'pause lost budget'; END IF;
END $$;
INSERT INTO sync_retry_queue VALUES
 ('11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','PUB_RETRY',0,4,'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',now(),now(),null,null),
 ('22222222-2222-2222-2222-222222222222','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','PUB_RETRY',0,4,'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',now(),now(),null,null),
 ('33333333-3333-3333-3333-333333333333','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','PUB_RETRY',0,4,'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',now(),now(),null,null);
DO $$ BEGIN
 PERFORM public.finish_sync_retry('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','SUCCESS',null,'{}',900);
 PERFORM public.finish_sync_retry('22222222-2222-2222-2222-222222222222','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','INELIGIBLE','ITEM_DELETED','{}',900);
 PERFORM public.finish_sync_retry('33333333-3333-3333-3333-333333333333','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','EXHAUSTED','RETRY_EXHAUSTED','{}',900);
 IF (SELECT count(*) FROM sync_retry_outcomes WHERE outcome IN ('SUCCESS','INELIGIBLE','EXHAUSTED'))<>3 THEN RAISE EXCEPTION 'terminal history not preserved'; END IF;
 IF (SELECT count(*) FROM sync_retry_queue WHERE id IN ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333'))<>0 THEN RAISE EXCEPTION 'terminal item retained'; END IF;
END $$;
SELECT set_config('test.role','anon',false);
DO $$ BEGIN
 BEGIN PERFORM public.finish_sync_retry('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','DEFERRED','PROVIDER_BREAKER_OPEN','{}',900); RAISE EXCEPTION 'anonymous accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
