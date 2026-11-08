-- Fixture-only integration test. Before execution, replace the marker with
-- the production candidate function renamed to pg_temp and with its seven
-- public table references redirected to the corresponding pg_temp tables.
CREATE TEMP TABLE digest_fixture_users AS
  SELECT i, ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid AS uid,
    ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid AS org
  FROM generate_series(1,13) i;
CREATE TEMP TABLE digest_fixture_monitored(owner_id uuid, organization_id uuid);
CREATE TEMP TABLE digest_fixture_profiles(id uuid, default_alert_email text, email text);
CREATE TEMP TABLE digest_fixture_preferences(user_id uuid, preferences jsonb);
CREATE TEMP TABLE digest_fixture_org_defaults(organization_id uuid, email_digest_enabled boolean);
CREATE TEMP TABLE digest_fixture_runs(id uuid, digest_date date, recipient_user_id uuid, status text, email_outbox_id uuid);
CREATE TEMP TABLE digest_fixture_outbox(id uuid, to_user_id uuid, status text, dedupe_key text);
CREATE TEMP TABLE digest_fixture_suppressions(organization_id uuid, email text);

INSERT INTO digest_fixture_monitored SELECT uid,org FROM digest_fixture_users;
-- A recipient in two organizations must be excluded if either one opted out.
INSERT INTO digest_fixture_monitored SELECT uid,'90000000-0000-4000-8000-000000000007'::uuid FROM digest_fixture_users WHERE i=7;
INSERT INTO digest_fixture_profiles SELECT uid, NULL, CASE WHEN i=8 THEN NULL ELSE 'recipient'||i||'@example.test' END FROM digest_fixture_users;
INSERT INTO digest_fixture_preferences SELECT uid,CASE WHEN i=2 THEN '{"email_enabled":false}'::jsonb
  WHEN i=13 THEN '{"email_enabled":"false"}'::jsonb ELSE '{"email_enabled":true}'::jsonb END
  FROM digest_fixture_users WHERE i<>11;
INSERT INTO digest_fixture_org_defaults SELECT org,i<>3 FROM digest_fixture_users WHERE i<>10;
INSERT INTO digest_fixture_org_defaults VALUES ('90000000-0000-4000-8000-000000000007',false);

-- All but case 4 have a historically delivered digest.
INSERT INTO digest_fixture_outbox
  SELECT ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,uid,'SENT','history-'||i
  FROM digest_fixture_users WHERE i<>4;
INSERT INTO digest_fixture_runs
  SELECT ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
    (now() AT TIME ZONE 'America/Bogota')::date-1,uid,'SENT',
    ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid
  FROM digest_fixture_users WHERE i<>4;
-- Case 5 already ran, case 6 has an outbox key, case 12 has a failed run.
INSERT INTO digest_fixture_runs
  SELECT ('40000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
    (now() AT TIME ZONE 'America/Bogota')::date,uid,CASE WHEN i=12 THEN 'FAILED' ELSE 'SENT' END,NULL
  FROM digest_fixture_users WHERE i IN (5,12);
INSERT INTO digest_fixture_outbox
  SELECT '50000000-0000-4000-8000-000000000006',uid,'PENDING',
    'daily-digest-'||uid::text||'-'||(now() AT TIME ZONE 'America/Bogota')::date::text
  FROM digest_fixture_users WHERE i=6;
INSERT INTO digest_fixture_suppressions SELECT org,'recipient9@example.test' FROM digest_fixture_users WHERE i=9;

/* CANDIDATE_FUNCTION_INJECT_HERE */

SELECT array_agg(u.i ORDER BY u.i) AS actual_eligible_cases,
  array_agg(u.i ORDER BY u.i)=ARRAY[1,11] AS passed
FROM pg_temp.digest_recovery_candidate_fixture() c
JOIN digest_fixture_users u ON u.uid=c.recipient_user_id;
