-- One-time technical recovery for the two runs started after the transport fix.
-- Apply only after the compatible monitor functions have been deployed.
-- Preserve all prior attempts; credit only an exhausted third claim that did
-- not read a source. No judicial rows, success clocks or documents change.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE TABLE IF NOT EXISTS public.monitor_gate_item_backup_20261031(
 run_id uuid NOT NULL,work_item_id uuid NOT NULL,before_record jsonb NOT NULL,
 recovered_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(run_id,work_item_id));
CREATE TABLE IF NOT EXISTS public.monitor_gate_run_backup_20261031(
 run_id uuid PRIMARY KEY,before_record jsonb NOT NULL,recovered_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.monitor_gate_item_backup_20261031 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_gate_run_backup_20261031 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monitor_gate_item_backup_20261031,public.monitor_gate_run_backup_20261031
 FROM PUBLIC,anon,authenticated,service_role;
SELECT id FROM public.estados_monitor_runs WHERE id IN
 ('0b335105-c300-4c18-83e2-47c1721e6ff2','68f2c917-02ca-4bcd-931c-b912f88f4891') FOR UPDATE;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.estados_monitor_run_items WHERE run_id IN
   ('0b335105-c300-4c18-83e2-47c1721e6ff2','68f2c917-02ca-4bcd-931c-b912f88f4891') AND status='CLAIMED')
 THEN RAISE EXCEPTION 'Drain monitor claims before recovery'; END IF;
END $guard$;
INSERT INTO public.monitor_gate_run_backup_20261031(run_id,before_record)
 SELECT id,to_jsonb(r) FROM public.estados_monitor_runs r WHERE id IN
 ('0b335105-c300-4c18-83e2-47c1721e6ff2','68f2c917-02ca-4bcd-931c-b912f88f4891')
 ON CONFLICT(run_id) DO NOTHING;
WITH eligible AS (
 SELECT i.* FROM public.estados_monitor_run_items i JOIN public.estados_monitor_runs r ON r.id=i.run_id
 WHERE r.id IN ('0b335105-c300-4c18-83e2-47c1721e6ff2','68f2c917-02ca-4bcd-931c-b912f88f4891')
   AND r.run_date='2026-10-31' AND r.status='PARTIAL'
   AND i.status='FAILED' AND i.attempts BETWEEN 1 AND 3
   AND i.error_code='DAILY_UPDATE_ALREADY_STARTED'
   AND i.result->>'deduplicated'='true' AND i.result#>>'{daily_update,admitted}'='false'
   AND i.result#>>'{daily_update,next_eligible_at}' IS NOT NULL
 FOR UPDATE OF i
), audited AS (
 INSERT INTO public.monitor_gate_item_backup_20261031(run_id,work_item_id,before_record)
 SELECT run_id,work_item_id,to_jsonb(e) FROM eligible e
 ON CONFLICT(run_id,work_item_id) DO NOTHING RETURNING *
), requeued AS (
 UPDATE public.estados_monitor_run_items i SET status='PENDING',attempts=least(i.attempts,2),
   claimed_at=NULL,lease_token=NULL,finished_at=NULL,
   next_attempt_at=greatest(now()+interval '1 minute',least((i.result#>>'{daily_update,next_eligible_at}')::timestamptz,now()+interval '48 hours')),
   result=i.result||jsonb_build_object('monitor_gate_failure_recovered_at',now())
 FROM audited a WHERE i.run_id=a.run_id AND i.work_item_id=a.work_item_id AND to_jsonb(i)=a.before_record
 RETURNING i.run_id,i.work_item_id,i.attempts
), refreshed AS (
 UPDATE public.estados_monitor_runs r SET status='PARTIAL',finished_at=NULL,lease_expires_at=now(),depth_remaining=60,
   attempted_count=greatest(0,r.attempted_count-g.n),failed_count=greatest(0,r.failed_count-g.n)
 FROM (SELECT run_id,count(*)::integer AS n FROM requeued GROUP BY run_id) g WHERE r.id=g.run_id
 RETURNING r.id
)
SELECT count(*) AS recovered_items,(SELECT count(*) FROM refreshed) AS recovered_runs FROM requeued;
COMMIT;
