-- After the compatible stored-only caller is published. Retains the original
-- failed monitor before-image already in cron_state. No attempt counter reset.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $resume$
DECLARE item record; prior jsonb;
 slot constant text := 'pp_ingestion_credit:dbaa52fe-0216-405e-8d1b-a2b89736a1fb:d5d846a3-673e-4969-b7ea-9cfc49d613c4';
 audit constant text := 'pp_ingestion_recovery:20261101:d5d846a3-673e-4969-b7ea-9cfc49d613c4:480e06b5-07c9-44b5-a3dc-90608ceeb93d';
BEGIN
 IF EXISTS(SELECT 1 FROM cron_state WHERE key=slot) THEN RETURN; END IF;
 SELECT value INTO STRICT prior FROM cron_state WHERE key=audit;
 IF prior->>'backend_run_id'<>'480e06b5-07c9-44b5-a3dc-90608ceeb93d'
 OR (prior->>'source_observed_at')::timestamptz+interval '24 hours'<=now() THEN
  RAISE EXCEPTION 'Verified source certificate missing or expired';
 END IF;
 SELECT i.* INTO STRICT item FROM estados_monitor_run_items i JOIN work_items w ON w.id=i.work_item_id
 WHERE i.run_id='dbaa52fe-0216-405e-8d1b-a2b89736a1fb'
 AND i.work_item_id='d5d846a3-673e-4969-b7ea-9cfc49d613c4'
 AND w.radicado='05001400301120260144800' AND w.lifecycle_state='ACTIVE' AND w.deleted_at IS NULL
 AND w.monitoring_enabled AND w.scraping_enabled FOR UPDATE OF i;
 IF item.status='SUCCESS' THEN RETURN; END IF;
 IF item.status NOT IN ('PENDING','FAILED') OR item.attempts<>3 OR item.lease_token IS NOT NULL THEN
  RAISE EXCEPTION 'Monitor state changed; do not replace a live lease';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM cron_state WHERE key='pub_rescrape:d5d846a3-673e-4969-b7ea-9cfc49d613c4'
   AND value->>'backend_run_id'=prior->>'backend_run_id') THEN RAISE EXCEPTION 'Private source binding changed'; END IF;
 INSERT INTO cron_state(key,value) VALUES(slot,jsonb_build_object('authorized',true,
  'tracked_backend_run_id',prior->>'backend_run_id','source_observed_at',prior->>'source_observed_at',
  'expires_at',(prior->>'source_observed_at')::timestamptz+interval '24 hours',
  'original_audit_key',audit,'resumed_at',clock_timestamp(),'before_resume',to_jsonb(item)));
 UPDATE estados_monitor_run_items SET status='PENDING',next_attempt_at=clock_timestamp(),
   finished_at=NULL,claimed_at=NULL,lease_token=NULL,error_code='CERTIFIED_BACKEND_INGESTION_PENDING'
 WHERE run_id=item.run_id AND work_item_id=item.work_item_id;
END $resume$;
COMMIT;
