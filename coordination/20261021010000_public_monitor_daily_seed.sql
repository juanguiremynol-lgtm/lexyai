-- HANDOFF TO LOVABLE: apply after 20261020010000, before dispatcher activation.
-- Prepared/tested only here; NOT applied to Supabase by backend release.
CREATE OR REPLACE FUNCTION public.start_public_monitor_run(_channel text,_run_date date,_workflows text[])
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

REVOKE ALL ON FUNCTION public.start_public_monitor_run(text,date,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_public_monitor_run(text,date,text[]) TO service_role;
