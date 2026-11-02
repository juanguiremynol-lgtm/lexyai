-- SQL-only compatible claim repair. One fourth ingestion attempt, without
-- resetting history. Entitlement survives deferred responses and expires with
-- its source certificate. Existing owner, signature, grants and RLS are retained.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
DECLARE current_definition text; current_sha text;
BEGIN
 SELECT pg_get_functiondef('public.claim_public_monitor_items(uuid,text,integer)'::regprocedure) INTO current_definition;
 current_sha=encode(extensions.digest(convert_to(current_definition,'UTF8'),'sha256'),'hex');
 IF current_sha='95d3984dababe34a0834d1ca99727e4b7954f743fe680e32b17fd8cfb109985f' THEN RETURN; END IF;
 IF current_sha NOT IN ('14635d0fc2a2f3c60804e812ddf5e01f7fac72caf277f3013586d1f80ffa4fc4',
  '00deab4577d0afc08c54b3f53697b72ce857d36e665bcf0ff6011bfaf69445b1') THEN
  RAISE EXCEPTION 'Monitor claim definition changed; preserve concurrent work';
 END IF;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION public.claim_public_monitor_items(_run_id uuid, _channel text, _limit integer DEFAULT 1)
 RETURNS TABLE(work_item_id uuid, ordinal integer, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF _limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid limit'; END IF;
 PERFORM 1 FROM estados_monitor_runs r WHERE r.id=_run_id AND r.channel=_channel FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'run/channel mismatch'; END IF;
 -- An orphan's final attempt must terminate rather than remain CLAIMED forever.
 UPDATE estados_monitor_run_items i SET status='FAILED',finished_at=now(),error_code='LEASE_ATTEMPTS_EXHAUSTED'
 WHERE i.run_id=_run_id AND i.status='CLAIMED' AND i.claimed_at<now()-interval '3 minutes' AND i.attempts>=3;
 UPDATE estados_monitor_run_items i SET status='FAILED',finished_at=now(),error_code='INGESTION_RECOVERY_CREDIT_EXPIRED'
 WHERE i.run_id=_run_id AND i.status='PENDING' AND i.attempts=3 AND EXISTS(
  SELECT 1 FROM cron_state credit WHERE credit.key='pp_ingestion_credit:'||i.run_id::text||':'||i.work_item_id::text
   AND (credit.value->>'expires_at')::timestamptz<=now());
 RETURN QUERY WITH picked AS (
  SELECT i.run_id,i.work_item_id FROM estados_monitor_run_items i
  WHERE i.run_id=_run_id AND (i.attempts<3 OR (i.attempts=3 AND _channel='publicaciones' AND EXISTS(
   SELECT 1 FROM cron_state credit WHERE credit.key='pp_ingestion_credit:'||i.run_id::text||':'||i.work_item_id::text
    AND credit.value->>'authorized'='true' AND (credit.value->>'expires_at')::timestamptz>now()
    AND credit.value->>'tracked_backend_run_id'=(SELECT ledger.value->>'backend_run_id' FROM cron_state ledger
      WHERE ledger.key='pub_rescrape:'||i.work_item_id::text)))) AND
   ((i.status='PENDING' AND i.next_attempt_at<=now()) OR (i.status='CLAIMED' AND i.claimed_at<now()-interval '3 minutes'))
  ORDER BY i.next_attempt_at,i.ordinal FOR UPDATE SKIP LOCKED LIMIT _limit
 ), claimed AS (
  UPDATE estados_monitor_run_items i SET status='CLAIMED',claimed_at=now(),attempts=i.attempts+1,lease_token=gen_random_uuid()
  FROM picked p WHERE i.run_id=p.run_id AND i.work_item_id=p.work_item_id RETURNING i.work_item_id,i.ordinal,i.lease_token
 ) SELECT c.work_item_id,c.ordinal,c.lease_token FROM claimed c;
END $function$
$definition$;
END $guard$;
COMMIT;
