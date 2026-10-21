-- Executed once after Lovable deployed SUCCESS_EMPTY verdict correction.
-- One fresh source read, never a SQL success override or unbounded retry reset.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('samai-empty-verdict-postfix-validation'));
DO $$ DECLARE n integer; BEGIN
 IF EXISTS(SELECT 1 FROM estados_monitor_runs WHERE id='ba5aab62-3e4d-4f06-82a8-562fb6efbbca' AND metadata ? 'empty_verdict_postfix_validation') THEN
  RAISE EXCEPTION 'Post-fix probe already executed';
 END IF;
 IF (SELECT count(*) FROM estados_monitor_run_items WHERE run_id='ba5aab62-3e4d-4f06-82a8-562fb6efbbca' AND status='FAILED' AND attempts=3 AND error_code='SUCCESS_EMPTY' AND result->>'result_code'='SUCCESS_EMPTY' AND result->>'ok'='true' AND result->'samai_estados_summary'->>'http_status'='200')<>4 THEN
  RAISE EXCEPTION 'Expected false failures changed';
 END IF;
 INSERT INTO public_monitor_activation_backups(reason,image)
 SELECT 'one bounded live validation after deployed SUCCESS_EMPTY verdict correction; previous3attempts preserved',
 jsonb_build_object('run',(SELECT to_jsonb(r) FROM estados_monitor_runs r WHERE id='ba5aab62-3e4d-4f06-82a8-562fb6efbbca'),
 'items',(SELECT jsonb_agg(to_jsonb(i)) FROM estados_monitor_run_items i WHERE run_id='ba5aab62-3e4d-4f06-82a8-562fb6efbbca' AND status='FAILED'));
 UPDATE estados_monitor_run_items SET status='PENDING',attempts=2,lease_token=NULL,next_attempt_at=now(),claimed_at=NULL,finished_at=NULL
 WHERE run_id='ba5aab62-3e4d-4f06-82a8-562fb6efbbca' AND status='FAILED' AND attempts=3 AND error_code='SUCCESS_EMPTY';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>4 THEN RAISE EXCEPTION 'Expected4probes'; END IF;
 UPDATE estados_monitor_runs SET lease_expires_at=now(),finished_at=NULL,depth_remaining=60,
 metadata=metadata||jsonb_build_object('empty_verdict_postfix_validation',jsonb_build_object('at',now(),'prior_attempts',3,'additional_attempt_budget',1,'deployed_source','f45ed39d'))
 WHERE id='ba5aab62-3e4d-4f06-82a8-562fb6efbbca';
END $$;
COMMIT;
-- Recovery then uses dispatch_public_monitors(false) and the normal leases.
