-- Run in one transaction on a temporary table with production's CHECKs.
-- Install the candidate (or installed) trigger and function on the temp table
-- first. Leave production rows and the existing check constraints untouched.
DO $test$
DECLARE
  original_status text;
  actual record;
BEGIN
  FOREACH original_status IN ARRAY ARRAY['ERROR','PARTIAL','TIMEOUT','OK','FAILED','SKIPPED','RUNNING'] LOOP
    INSERT INTO pg_temp.trace_test(job_name, scheduled_for, status, details)
    VALUES ('scheduled-daily-sync', clock_timestamp(), original_status, '{"run_mode":"CRON","total_errors":3}')
    RETURNING status, details INTO actual;
    IF original_status IN ('ERROR','PARTIAL','TIMEOUT') THEN
      IF actual.status IS DISTINCT FROM 'FAILED' OR actual.details->>'trace_outcome' IS DISTINCT FROM original_status
        OR actual.details->>'total_errors' IS DISTINCT FROM '3' THEN
        RAISE EXCEPTION 'Wrong outcome for %', original_status;
      END IF;
    ELSIF actual.status IS DISTINCT FROM original_status OR actual.details ? 'trace_outcome' THEN
      RAISE EXCEPTION 'Unexpected change to canonical status %', original_status;
    END IF;
  END LOOP;
  BEGIN
    INSERT INTO pg_temp.trace_test(job_name, scheduled_for, status, details)
    VALUES ('unrelated-job', clock_timestamp(), 'TIMEOUT', '{"run_mode":"CRON"}');
    RAISE EXCEPTION 'An unrelated caller passed the canonical status constraint';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO pg_temp.trace_test(job_name, scheduled_for, status, details)
    VALUES ('scheduled-daily-sync', clock_timestamp(), 'ERROR', '{}');
    RAISE EXCEPTION 'An unqualified trace passed the canonical status constraint';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$test$;
