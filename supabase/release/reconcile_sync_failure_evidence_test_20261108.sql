-- Isolated pg_temp fixtures; the test runner substitutes the exact production
-- function into __FUNCTION_UNDER_TEST__ with public. changed to pg_temp.
BEGIN;
CREATE TEMP TABLE sync_item_failure_tracker (
  work_item_id uuid PRIMARY KEY, organization_id uuid NOT NULL, consecutive_failures integer NOT NULL,
  last_failure_at timestamptz, last_failure_reason text, dead_lettered boolean NOT NULL,
  dead_lettered_at timestamptz, dead_lettered_run_id text, reset_at timestamptz
);
CREATE TEMP TABLE work_items (
  id uuid PRIMARY KEY, organization_id uuid, workflow_type text, stage text, radicado text,
  deleted_at timestamptz, lifecycle_state text, monitoring_enabled boolean
);
CREATE TEMP TABLE work_item_sync_timeline (
  id uuid PRIMARY KEY,work_item_id uuid,organization_id uuid,sync_run_id uuid,provider text,status text,
  error_code text,started_at timestamptz,finished_at timestamptz,metadata jsonb,operation text,
  created_at timestamptz DEFAULT now()
);
CREATE TEMP TABLE external_sync_runs (
  id uuid PRIMARY KEY,work_item_id uuid,organization_id uuid,status text,finished_at timestamptz
);
CREATE TEMP TABLE external_sync_run_attempts (
  id uuid PRIMARY KEY,sync_run_id uuid,data_kind text,provider text,status text,error_code text,
  http_code integer,recorded_at timestamptz
);
CREATE TEMP TABLE sync_failure_evidence_recovery_audit_20261108 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_item_id uuid,organization_id uuid,timeline_id uuid,
  sync_run_id uuid,source_observed_at timestamptz,prior_tracker jsonb,recovered_at timestamptz DEFAULT now(),
  UNIQUE(work_item_id,timeline_id)
);
__FUNCTION_UNDER_TEST__

INSERT INTO pg_temp.work_items
SELECT md5('wi'||i)::uuid,md5('org')::uuid,
  CASE WHEN i IN (2,11) THEN 'CPACA' WHEN i IN (3,12) THEN 'TUTELA' ELSE 'CGP' END,
  CASE WHEN i=20 THEN 'FINALIZADO' END,'05001333301020230019900',
  NULL,CASE WHEN i=16 THEN 'ARCHIVED' ELSE 'ACTIVE' END,i<>17
FROM generate_series(1,26) i;
INSERT INTO pg_temp.sync_item_failure_tracker
SELECT md5('wi'||i)::uuid,md5('org')::uuid,4,
  now()-(CASE WHEN i=6 THEN interval '10 minutes' ELSE interval '3 hours' END),
  'PROVIDER_ERROR',true,now()-interval '3 hours','old-run',NULL
FROM generate_series(1,26) i;
INSERT INTO pg_temp.external_sync_runs
SELECT md5('run'||i)::uuid,md5('wi'||i)::uuid,
  CASE WHEN i=21 THEN md5('other-org')::uuid ELSE md5('org')::uuid END,
  CASE WHEN i=9 THEN 'FAILED' ELSE 'SUCCESS' END,now()-interval '20 minutes'
FROM generate_series(1,26) i;
INSERT INTO pg_temp.work_item_sync_timeline
  (id,work_item_id,organization_id,sync_run_id,provider,status,error_code,started_at,finished_at,metadata,operation)
SELECT md5('timeline'||i)::uuid,md5('wi'||i)::uuid,
  CASE WHEN i=1 THEN NULL WHEN i=26 THEN md5('other-org')::uuid ELSE md5('org')::uuid END,
  CASE WHEN i=22 THEN NULL ELSE md5('run'||i)::uuid END,
  CASE WHEN i=4 THEN 'unknown' WHEN i=11 THEN 'cpnu' WHEN i=2 THEN 'samai'
       WHEN i IN (3,12) THEN 'cpnu+samai' ELSE 'cpnu' END,
  'success',CASE WHEN i=8 THEN 'PROVIDER_UNRESOLVED' END,
  now()-interval '1 hour',now()-interval '20 minutes',
  jsonb_build_object('source_complete', CASE WHEN i=7 THEN false WHEN i=19 THEN NULL ELSE true END,
    'source_observed_at',CASE WHEN i=15 THEN 'not-a-timestamp' WHEN i=24 THEN NULL
       WHEN i=5 THEN to_char((now()-interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
       WHEN i=14 THEN to_char((now()-interval '4 hours') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
       ELSE to_char((now()-interval '30 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') END),
  'acts'
FROM generate_series(1,26) i;
INSERT INTO pg_temp.external_sync_run_attempts
SELECT md5('attempt'||i)::uuid,md5('run'||i)::uuid,CASE WHEN i=25 THEN 'ESTADOS' ELSE 'ACTUACIONES' END,
  CASE WHEN i=2 THEN 'SAMAI' ELSE 'CPNU' END,'success',NULL,
  CASE WHEN i=18 THEN 500 ELSE 200 END,now()-interval '25 minutes'
FROM generate_series(1,26) i WHERE i<>10;
-- A tutela needs both of its actual providers; fixture 12 lacks SAMAI.
INSERT INTO pg_temp.external_sync_run_attempts
VALUES (md5('attempt-samai-3')::uuid,md5('run3')::uuid,'ACTUACIONES','SAMAI','success',NULL,200,now()-interval '25 minutes');
-- A later failure defeats a prior successful timeline or provider attempt.
INSERT INTO pg_temp.work_item_sync_timeline
  (id,work_item_id,organization_id,sync_run_id,provider,status,error_code,started_at,finished_at,metadata,operation)
VALUES (md5('later-13')::uuid,md5('wi13')::uuid,md5('org')::uuid,md5('run13')::uuid,'cpnu','error',
  'PROVIDER_ERROR',now()-interval '10 minutes',now()-interval '5 minutes','{}','acts');
INSERT INTO pg_temp.external_sync_run_attempts
VALUES (md5('later-attempt-23')::uuid,md5('run23')::uuid,'ACTUACIONES','CPNU','error',
  'PROVIDER_ERROR',500,now()-interval '1 minute');

DO $test$
DECLARE p jsonb; n integer;
BEGIN
  p := pg_temp.reconcile_sync_failure_evidence_20261108(true,20);
  IF (p->>'candidates')::int <> 3 OR (p->>'recovered')::int <> 0 THEN
    RAISE EXCEPTION 'dry run expected 3 candidates, got %',p;
  END IF;
  SELECT count(*) INTO n FROM pg_temp.sync_item_failure_tracker WHERE NOT dead_lettered;
  IF n<>0 THEN RAISE EXCEPTION 'dry run mutated tracker'; END IF;
  p := pg_temp.reconcile_sync_failure_evidence_20261108(false,20);
  IF (p->>'recovered')::int <> 3 THEN RAISE EXCEPTION 'expected 3 recoveries, got %',p; END IF;
  SELECT count(*) INTO n FROM pg_temp.sync_failure_evidence_recovery_audit_20261108;
  IF n<>3 THEN RAISE EXCEPTION 'expected three audited recoveries, got %',n; END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.sync_item_failure_tracker WHERE NOT dead_lettered
    AND work_item_id NOT IN (md5('wi1')::uuid,md5('wi2')::uuid,md5('wi3')::uuid)) THEN
    RAISE EXCEPTION 'unsafe fixture was recovered';
  END IF;
  p := pg_temp.reconcile_sync_failure_evidence_20261108(false,20);
  IF (p->>'recovered')::int <> 0 THEN RAISE EXCEPTION 'replay was not idempotent'; END IF;
  BEGIN
    PERFORM pg_temp.reconcile_sync_failure_evidence_20261108(false,21);
    RAISE EXCEPTION 'batch limit accepted an invalid value';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid reconciliation options' THEN RAISE; END IF;
  END;
END
$test$;
-- A newer failure must never be overwritten by the rollback of an older reset.
UPDATE pg_temp.sync_item_failure_tracker SET consecutive_failures=1,last_failure_at=now()
WHERE work_item_id=md5('wi2')::uuid;
__ROLLBACK_UPDATE__
DO $rollback_test$
BEGIN
  IF (SELECT count(*) FROM pg_temp.sync_item_failure_tracker WHERE dead_lettered AND
      work_item_id IN (md5('wi1')::uuid,md5('wi3')::uuid))<>2 THEN
    RAISE EXCEPTION 'rollback did not restore unchanged trackers';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.sync_item_failure_tracker WHERE work_item_id=md5('wi2')::uuid
    AND NOT dead_lettered AND consecutive_failures=1 AND last_failure_at=now()) THEN
    RAISE EXCEPTION 'rollback overwrote a newer failure';
  END IF;
END
$rollback_test$;
SELECT 'pass: 26 fixtures, audit, replay, batch limit and fenced rollback' AS result;
ROLLBACK;
