-- Fixture-only dispatcher integration test. Inject the production dispatcher
-- with table/function names redirected to pg_temp and local time fixed at 10.
CREATE TEMP TABLE digest_dispatch_fixture_candidates(recipient_user_id uuid);
CREATE TEMP TABLE digest_dispatch_fixture_settings(id text, email_enabled boolean);
CREATE TEMP TABLE digest_dispatch_fixture_heartbeats(job_name text,status text,started_at timestamptz,metadata jsonb);
CREATE TEMP TABLE digest_dispatch_fixture_state(key text primary key,value jsonb,updated_at timestamptz);
CREATE TEMP TABLE digest_dispatch_fixture_secrets(name text,decrypted_secret text);
CREATE TEMP TABLE digest_dispatch_fixture_requests(id bigint generated always as identity,body jsonb);
INSERT INTO digest_dispatch_fixture_candidates VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003');
INSERT INTO digest_dispatch_fixture_settings VALUES ('singleton',true);
INSERT INTO digest_dispatch_fixture_secrets VALUES ('CRON_SERVICE_KEY','fake-key'),('SUPABASE_URL','https://example.invalid');
INSERT INTO digest_dispatch_fixture_state
  SELECT 'digest-eligible-recovery-v2:'||(now() AT TIME ZONE 'America/Bogota')::date::text||':'||recipient_user_id::text,
    jsonb_build_object('attempts',CASE WHEN right(recipient_user_id::text,1)='2' THEN 3 ELSE 1 END),now()
  FROM digest_dispatch_fixture_candidates WHERE right(recipient_user_id::text,1) IN ('2','3');
CREATE FUNCTION pg_temp.digest_fixture_eligible() RETURNS TABLE(recipient_user_id uuid)
  LANGUAGE sql AS $$ SELECT c.recipient_user_id FROM pg_temp.digest_dispatch_fixture_candidates c $$;
CREATE FUNCTION pg_temp.digest_fixture_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
  RETURNS bigint LANGUAGE plpgsql AS $$
  DECLARE n bigint; BEGIN
    INSERT INTO pg_temp.digest_dispatch_fixture_requests(body) VALUES($3) RETURNING id INTO n;
    RETURN n;
  END $$;

/* DISPATCH_FUNCTION_INJECT_HERE */

CREATE TEMP TABLE digest_dispatch_fixture_results(label text, result jsonb);
INSERT INTO digest_dispatch_fixture_results VALUES ('preview',pg_temp.digest_dispatch_fixture(true));
INSERT INTO digest_dispatch_fixture_results VALUES ('first',pg_temp.digest_dispatch_fixture(false));
INSERT INTO digest_dispatch_fixture_results VALUES ('second',pg_temp.digest_dispatch_fixture(false));
UPDATE digest_dispatch_fixture_settings SET email_enabled=false WHERE id='singleton';
INSERT INTO digest_dispatch_fixture_results VALUES ('disabled',pg_temp.digest_dispatch_fixture(false));
SELECT
  (SELECT result->>'state'='ready' AND (result->>'ready')::int=1 AND (result->>'requested')::int=0
    FROM digest_dispatch_fixture_results WHERE label='preview') AS preview_passed,
  (SELECT result->>'state'='requested' AND (result->>'requested')::int=1
    FROM digest_dispatch_fixture_results WHERE label='first') AS dispatch_passed,
  (SELECT result->>'state'='cooldown_or_limit' AND (result->>'requested')::int=0
    FROM digest_dispatch_fixture_results WHERE label='second') AS repeat_blocked,
  (SELECT result->>'state'='global_email_disabled_or_unknown' FROM digest_dispatch_fixture_results WHERE label='disabled') AS global_pause_respected,
  (SELECT count(*)=1 AND bool_and(body->>'user_id'='00000000-0000-4000-8000-000000000001')
    FROM digest_dispatch_fixture_requests) AS one_targeted_request;
