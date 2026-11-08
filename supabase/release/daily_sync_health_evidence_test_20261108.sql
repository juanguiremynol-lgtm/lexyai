-- Temporary ledger fixtures and exact live-reader patch; always rolled back.
BEGIN;
CREATE TEMP TABLE auto_sync_daily_ledger (
  id uuid PRIMARY KEY,organization_id uuid,run_date date,chain_id text,started_at timestamptz,
  finished_at timestamptz,created_at timestamptz,status text,failure_reason text,
  expected_total_items integer,is_continuation boolean,items_succeeded integer,items_failed integer,
  items_skipped integer,dead_letter_count integer,timeout_count integer,metadata jsonb
);
-- Copy the real production reader into pg_temp, pointed at the temporary ledger.
DO $copy$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.daily_sync_health_snapshot(integer,date)'::regprocedure) INTO d;
  d:=replace(d,'FUNCTION public.daily_sync_health_snapshot(', 'FUNCTION pg_temp.daily_sync_health_snapshot(');
  d:=replace(d,'SET search_path TO ''public''','SET search_path TO ''pg_temp'', ''public''');
  EXECUTE d;
END
$copy$;
__HEALTH_RELEASE__

INSERT INTO pg_temp.auto_sync_daily_ledger
SELECT md5('ledger'||i)::uuid,md5('org'||org)::uuid,(now() AT TIME ZONE 'America/Bogota')::date,
  CASE WHEN i=7 THEN NULL ELSE 'chain-'||chain END,
  ((now() AT TIME ZONE 'America/Bogota')::date::timestamp AT TIME ZONE 'America/Bogota')+interval '7 hours',
  now()-interval '1 hour',now()-interval '2 hours'+i*interval '1 second',
  CASE WHEN i IN (1,5) THEN 'PARTIAL' ELSE 'SUCCESS' END,NULL,
  CASE WHEN i=1 THEN 17 WHEN i=2 THEN 0 ELSE 2 END,i=2,
  CASE WHEN i=1 THEN 3 WHEN i=2 THEN 0 ELSE 2 END,
  CASE WHEN i IN (1,5) THEN 3 ELSE 0 END,0,0,0,
  CASE WHEN i=3 THEN '{}'::jsonb WHEN i=1 THEN '{"items_dispatched":11,"dead_lettered_excluded":71}'::jsonb
       ELSE '{"items_dispatched":0,"dead_lettered_excluded":0}'::jsonb END
FROM (VALUES (1,1,1),(2,1,1),(3,3,3),(4,2,2),(5,4,4),(6,4,6),(7,5,7)) f(i,org,chain);

DO $test$
DECLARE out jsonb; p jsonb; chain jsonb;
BEGIN
  out:=pg_temp.daily_sync_health_snapshot(0,(now() AT TIME ZONE 'America/Bogota')::date);
  p:=out->'platform_summary'->0;
  IF (p->>'orgs_seen')::int<>5 OR (p->>'orgs_fully_synced')::int<>1 OR
     (p->>'pct_fully_synced')::numeric<>20 OR p->>'evidence_scope'<>'SELECTED_ACTUACIONES_ONLY' THEN
    RAISE EXCEPTION 'unexpected platform verdict %',p;
  END IF;
  IF (p->>'p95_first_sync_min_after_midnight')::numeric<>420 THEN
    RAISE EXCEPTION 'first sync time did not use Bogota: %',p;
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(out->'problem_orgs_today'))<>4 THEN
    RAISE EXCEPTION 'missing partial, unknown, mixed-chain or null-chain issue: %',out;
  END IF;
  SELECT value INTO chain FROM jsonb_array_elements(out->'problem_orgs_today')
    WHERE value->>'chain_id'='chain-1';
  IF chain IS NULL OR (chain->>'fully_synced')::boolean OR
     (chain#>>'{chain_evidence,failed}')::int<>3 OR
     (chain#>>'{chain_evidence,dispatched_attempts}')::int<>11 OR
     (chain#>>'{chain_evidence,excluded_tracker_entries}')::int<>71 OR
     chain->'convergence_minutes'<>'null'::jsonb THEN
    RAISE EXCEPTION 'partial chain was falsely certified: %',chain;
  END IF;
  IF (SELECT (pg_temp.daily_sync_chain_evidence_20261108(md5('org2')::uuid,'chain-2')->>'fully_synced')::boolean) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'valid complete selection was not accepted';
  END IF;
  IF (pg_temp.daily_sync_chain_evidence_20261108(md5('org3')::uuid,'chain-3')->>'fully_synced')::boolean THEN
    RAISE EXCEPTION 'missing evidence counted as success';
  END IF;
END
$test$;
__HEALTH_ROLLBACK__
DO $rollback_test$
DECLARE original text; restored text;
BEGIN
  SELECT definition INTO original FROM pg_temp.daily_sync_health_definition_backup_20261108
  WHERE signature='pg_temp.daily_sync_health_snapshot(integer,date)';
  restored:=pg_get_functiondef('pg_temp.daily_sync_health_snapshot(integer,date)'::regprocedure);
  IF original IS NULL OR restored IS DISTINCT FROM original THEN
    RAISE EXCEPTION 'reader definition was not restored exactly';
  END IF;
END
$rollback_test$;
SELECT 'pass: reader verdicts, Bogota time, scope and exact rollback' AS result;
ROLLBACK;
