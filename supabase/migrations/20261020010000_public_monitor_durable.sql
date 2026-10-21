-- PREPARATION ONLY. Additive queue protocol; deploy together with estadosMonitor.
-- No historical act/alert/deadline writes. Existing run/item tables retain RLS.
ALTER TABLE public.estados_monitor_run_items
 ADD COLUMN attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN lease_token uuid,
 ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX estados_monitor_due ON public.estados_monitor_run_items(run_id,status,next_attempt_at);

CREATE FUNCTION public.start_public_monitor_run(_channel text,_run_date date,_workflows text[])
RETURNS TABLE(run_id uuid,acquired boolean,selected_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid; n integer;
BEGIN
 IF _channel NOT IN ('publicaciones','samai_estados') THEN RAISE EXCEPTION 'invalid channel'; END IF;
 -- Serialize seeding/recovery of each source; never mix tenants in row association.
 PERFORM pg_advisory_xact_lock(hashtext('public-monitor:'||_channel));
 -- Seed today's independent snapshot BEFORE choosing recovery work. An older
 -- backlog must never consume the only daily trigger and suppress today's run.
 INSERT INTO estados_monitor_runs(channel,run_date,depth_remaining,lease_expires_at)
 VALUES(_channel,_run_date,60,now()-interval '1 second')
 ON CONFLICT(channel,run_date) DO NOTHING RETURNING id INTO rid;
 IF rid IS NOT NULL THEN
   INSERT INTO estados_monitor_run_items(run_id,work_item_id,ordinal)
   SELECT rid,w.id,row_number() OVER(ORDER BY w.id)::integer FROM work_items w
   WHERE w.monitoring_enabled AND w.deleted_at IS NULL AND w.lifecycle_state='ACTIVE'
   AND w.workflow_type::text=ANY(_workflows)
   AND regexp_replace(coalesce(w.radicado,''),'[^0-9]','','g') ~ '^[0-9]{23}$';
   UPDATE estados_monitor_runs r SET selected_count=(SELECT count(*) FROM estados_monitor_run_items i WHERE i.run_id=rid) WHERE r.id=rid;
 END IF;
 -- New matters after a snapshot are selected by the next daily snapshot;
 -- redispatch recovers every seeded date, rather than recreating an old date.
 SELECT r.id INTO rid FROM estados_monitor_runs r
 WHERE r.channel=_channel AND r.status IN ('RUNNING','PARTIAL')
 AND r.lease_expires_at<=now()
 AND (r.run_date=_run_date OR EXISTS(SELECT 1 FROM estados_monitor_run_items i
      WHERE i.run_id=r.id AND i.status IN ('PENDING','CLAIMED')))
 ORDER BY r.run_date LIMIT 1 FOR UPDATE;
 IF rid IS NULL THEN RETURN; END IF;
 UPDATE estados_monitor_runs SET depth_remaining=60,
 lease_expires_at=now()+interval '3 minutes',finished_at=NULL WHERE id=rid;
 RETURN QUERY SELECT r.id,true,r.selected_count FROM estados_monitor_runs r WHERE r.id=rid;
END $$;


CREATE FUNCTION public.claim_public_monitor_items(_run_id uuid,_channel text,_limit integer DEFAULT 1)
RETURNS TABLE(work_item_id uuid,ordinal integer,lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF _limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid limit'; END IF;
 PERFORM 1 FROM estados_monitor_runs r WHERE r.id=_run_id AND r.channel=_channel FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'run/channel mismatch'; END IF;
 -- An orphan's final attempt must terminate rather than remain CLAIMED forever.
 UPDATE estados_monitor_run_items i SET status='FAILED',finished_at=now(),error_code='LEASE_ATTEMPTS_EXHAUSTED'
 WHERE i.run_id=_run_id AND i.status='CLAIMED' AND i.claimed_at<now()-interval '3 minutes' AND i.attempts>=3;
 RETURN QUERY WITH picked AS (
  SELECT i.run_id,i.work_item_id FROM estados_monitor_run_items i
  WHERE i.run_id=_run_id AND i.attempts<3 AND
   ((i.status='PENDING' AND i.next_attempt_at<=now()) OR (i.status='CLAIMED' AND i.claimed_at<now()-interval '3 minutes'))
  ORDER BY i.ordinal FOR UPDATE SKIP LOCKED LIMIT _limit
 ), claimed AS (
  UPDATE estados_monitor_run_items i SET status='CLAIMED',claimed_at=now(),attempts=i.attempts+1,lease_token=gen_random_uuid()
  FROM picked p WHERE i.run_id=p.run_id AND i.work_item_id=p.work_item_id RETURNING i.work_item_id,i.ordinal,i.lease_token
 ) SELECT c.work_item_id,c.ordinal,c.lease_token FROM claimed c;
END $$;

CREATE FUNCTION public.finish_public_monitor_item(_run_id uuid,_work_item_id uuid,_lease_token uuid,_success boolean,_retryable boolean,_error_code text,_result jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE affected integer;
BEGIN
 -- Fence late replies after lease reclamation. A repeated completion is a no-op.
 UPDATE estados_monitor_run_items i
 SET status=CASE WHEN _success THEN 'SUCCESS' WHEN _retryable AND i.attempts<3 THEN 'PENDING' ELSE 'FAILED' END,
 finished_at=CASE WHEN NOT _success AND _retryable AND i.attempts<3 THEN NULL ELSE now() END,
 next_attempt_at=now()+make_interval(secs=>30*i.attempts),error_code=_error_code,result=coalesce(_result,'{}'::jsonb)
 WHERE i.run_id=_run_id AND i.work_item_id=_work_item_id AND i.status='CLAIMED' AND i.lease_token=_lease_token;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected=1;
END $$;

CREATE FUNCTION public.finish_public_monitor_hop(_run_id uuid,_channel text)
RETURNS TABLE(status text,selected_count integer,attempted_count integer,remaining_count integer,depth_remaining integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s integer; f integer; rem integer; depth integer; selected integer;
BEGIN
 PERFORM 1 FROM estados_monitor_runs r WHERE r.id=_run_id AND r.channel=_channel FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'run/channel mismatch'; END IF;
 SELECT count(*) FILTER(WHERE i.status='SUCCESS'),count(*) FILTER(WHERE i.status='FAILED'),
 count(*) FILTER(WHERE i.status IN ('PENDING','CLAIMED')),count(*)
 INTO s,f,rem,selected FROM estados_monitor_run_items i WHERE i.run_id=_run_id;
 UPDATE estados_monitor_runs r SET attempted_count=s+f,succeeded_count=s,failed_count=f,
 depth_remaining=greatest(r.depth_remaining-1,0),
 status=CASE WHEN rem=0 AND f=0 THEN 'OK' ELSE 'PARTIAL' END,
 finished_at=CASE WHEN rem=0 THEN now() ELSE NULL END,
 lease_expires_at=CASE WHEN rem>0 AND r.depth_remaining>1 THEN now()+interval '3 minutes' ELSE now() END
 WHERE r.id=_run_id RETURNING r.depth_remaining INTO depth;
 RETURN QUERY SELECT CASE WHEN rem=0 AND f=0 THEN 'OK' ELSE 'PARTIAL' END,selected,s+f,rem,depth;
END $$;

REVOKE ALL ON FUNCTION public.start_public_monitor_run(text,date,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_public_monitor_items(uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_public_monitor_item(uuid,uuid,uuid,boolean,boolean,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_public_monitor_hop(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_public_monitor_run(text,date,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_public_monitor_items(uuid,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_public_monitor_item(uuid,uuid,uuid,boolean,boolean,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_public_monitor_hop(uuid,text) TO service_role;
