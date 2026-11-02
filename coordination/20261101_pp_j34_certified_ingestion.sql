-- Only resume ingestion of the independently verified complete public window.
-- Source: GET /historico/05001400303420260089800?backend_run_id=123e3c8e-31c1-40a6-9aeb-d4e9861c34ed
-- Complete + persistence confirmed, observed 2026-11-02T00:06:54.513309Z.
-- No source query, success assignment, counter reset or judicial data update.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $resume$
DECLARE item record;
 audit constant text := 'pp_ingestion_recovery:20261101:74e28c64-6457-44fc-a450-dda933c6ddec:123e3c8e-31c1-40a6-9aeb-d4e9861c34ed';
BEGIN
 IF EXISTS(SELECT 1 FROM cron_state WHERE key=audit) THEN RETURN; END IF;
 IF now() NOT BETWEEN '2026-11-02T00:06:54.513309Z'::timestamptz
   AND '2026-11-03T00:06:54.513309Z'::timestamptz THEN
   RAISE EXCEPTION 'Verified source certificate expired or clock invalid'; END IF;
 SELECT i.* INTO STRICT item FROM estados_monitor_run_items i JOIN work_items w ON w.id=i.work_item_id
 WHERE i.run_id='dbaa52fe-0216-405e-8d1b-a2b89736a1fb'
 AND i.work_item_id='74e28c64-6457-44fc-a450-dda933c6ddec'
 AND w.radicado='05001400303420260089800' AND w.lifecycle_state='ACTIVE' AND w.deleted_at IS NULL
 AND w.monitoring_enabled AND w.scraping_enabled FOR UPDATE OF i;
 IF item.status='SUCCESS' THEN RETURN; END IF;
 IF item.status<>'FAILED' OR item.attempts<>2 OR item.finished_at IS NULL
 OR (item.lease_token IS NOT NULL AND (item.claimed_at IS NULL OR item.claimed_at>now()-interval '3 minutes'))
 OR item.error_code<>'PROVIDER_UNAVAILABLE' THEN
  RAISE EXCEPTION 'Expected stale ingestion failure changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM cron_state WHERE key='pub_rescrape:74e28c64-6457-44fc-a450-dda933c6ddec'
   AND value->>'backend_run_id'='123e3c8e-31c1-40a6-9aeb-d4e9861c34ed') THEN
   RAISE EXCEPTION 'Private source binding changed'; END IF;
 INSERT INTO cron_state(key,value) VALUES(audit,jsonb_build_object(
  'before',to_jsonb(item),'backend_run_id','123e3c8e-31c1-40a6-9aeb-d4e9861c34ed',
  'source_observed_at','2026-11-02T00:06:54.513309Z','window_from','2026-10-18',
  'window_to','2026-11-01','recovered_at',clock_timestamp(),'repair','STORED_CERTIFICATE_INGESTION'));
 UPDATE estados_monitor_run_items SET status='PENDING',next_attempt_at=clock_timestamp(),
   finished_at=NULL,claimed_at=NULL,lease_token=NULL,error_code='CERTIFIED_BACKEND_INGESTION_PENDING'
 WHERE run_id=item.run_id AND work_item_id=item.work_item_id;
END $resume$;
COMMIT;
