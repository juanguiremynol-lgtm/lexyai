ALTER TABLE public.sync_retry_queue ADD COLUMN IF NOT EXISTS lease_token uuid;
CREATE TABLE public.sync_retry_outcomes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL UNIQUE, work_item_id uuid NOT NULL, kind text NOT NULL, attempt integer NOT NULL, outcome text NOT NULL CHECK(outcome IN ('SUCCESS','EXHAUSTED','INELIGIBLE')), error_code text, result jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.sync_retry_outcomes TO service_role;
ALTER TABLE public.sync_retry_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY retry_outcome_service ON public.sync_retry_outcomes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX sync_retry_outcomes_item ON public.sync_retry_outcomes(work_item_id,created_at DESC);
CREATE OR REPLACE FUNCTION public.claim_sync_retry(p_kind text,p_initial boolean) RETURNS SETOF public.sync_retry_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
RETURN QUERY WITH candidate AS (
 SELECT q.id FROM public.sync_retry_queue q WHERE q.kind=p_kind AND q.next_run_at<=now() AND (q.claimed_at IS NULL OR q.claimed_at<now()-interval '10 minutes') AND ((q.attempt=0)=p_initial)
 ORDER BY q.created_at,q.id FOR UPDATE SKIP LOCKED LIMIT 1
) UPDATE public.sync_retry_queue q SET claimed_at=now(),lease_token=gen_random_uuid() FROM candidate c WHERE q.id=c.id RETURNING q.*;
END $$;
CREATE OR REPLACE FUNCTION public.finish_sync_retry(p_id uuid,p_token uuid,p_outcome text,p_error text,p_result jsonb,p_delay_seconds integer DEFAULT 900) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE q public.sync_retry_queue%ROWTYPE; BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
IF p_outcome NOT IN ('SUCCESS','RETRY','EXHAUSTED','INELIGIBLE') OR p_delay_seconds<0 OR p_delay_seconds>86400 THEN RAISE EXCEPTION 'invalid outcome'; END IF;
SELECT * INTO q FROM public.sync_retry_queue WHERE id=p_id AND lease_token=p_token FOR UPDATE;
IF NOT FOUND THEN RETURN false; END IF;
IF p_outcome='RETRY' AND q.attempt+1<q.max_attempts THEN
 UPDATE public.sync_retry_queue SET attempt=attempt+1,claimed_at=NULL,lease_token=NULL,next_run_at=now()+make_interval(secs=>p_delay_seconds),last_error_code=p_error,last_error_message=left(p_result::text,1000) WHERE id=q.id;
ELSE
 INSERT INTO public.sync_retry_outcomes(task_id,work_item_id,kind,attempt,outcome,error_code,result) VALUES(q.id,q.work_item_id,q.kind,q.attempt+1,CASE WHEN p_outcome='RETRY' THEN 'EXHAUSTED' ELSE p_outcome END,p_error,COALESCE(p_result,'{}'::jsonb)) ON CONFLICT(task_id) DO NOTHING;
 DELETE FROM public.sync_retry_queue WHERE id=q.id AND lease_token=p_token;
END IF;
RETURN true; END $$;
REVOKE ALL ON FUNCTION public.claim_sync_retry(text,boolean),public.finish_sync_retry(uuid,uuid,text,text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sync_retry(text,boolean),public.finish_sync_retry(uuid,uuid,text,text,jsonb,integer) TO service_role;