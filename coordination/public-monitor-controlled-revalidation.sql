-- One controlled revalidation of today's pre-0046 completed queue.
-- Preserves original run/item images and does not alter judicial records.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('public-monitor-controlled-revalidation'));
DO $$ DECLARE image jsonb; v_run record; BEGIN
 IF EXISTS(SELECT 1 FROM estados_monitor_runs WHERE run_date=(now() AT TIME ZONE 'America/Bogota')::date AND (status<>'OK' OR metadata ? 'activation_revalidation'))
 OR EXISTS(SELECT 1 FROM estados_monitor_run_items i JOIN estados_monitor_runs r ON r.id=i.run_id WHERE r.run_date=(now() AT TIME ZONE 'America/Bogota')::date AND (i.status<>'SUCCESS' OR i.attempts<>0)) THEN
  RAISE EXCEPTION 'Queue is no longer the completed pre-protocol snapshot; no reset';
 END IF;
 SELECT jsonb_build_object('runs',(SELECT jsonb_agg(to_jsonb(r)) FROM estados_monitor_runs r WHERE run_date=(now() AT TIME ZONE 'America/Bogota')::date),
 'items',(SELECT jsonb_agg(to_jsonb(i)) FROM estados_monitor_run_items i JOIN estados_monitor_runs r ON r.id=i.run_id WHERE r.run_date=(now() AT TIME ZONE 'America/Bogota')::date)) INTO image;
 INSERT INTO public_monitor_activation_backups(reason,image) VALUES('controlled revalidation of completed pre-0046 queue; include new eligible matters',image);
 FOR v_run IN SELECT * FROM estados_monitor_runs WHERE run_date=(now() AT TIME ZONE 'America/Bogota')::date FOR UPDATE LOOP
  INSERT INTO estados_monitor_run_items(run_id,work_item_id,ordinal)
  SELECT v_run.id,w.id,(SELECT coalesce(max(i.ordinal),0) FROM estados_monitor_run_items i WHERE i.run_id=v_run.id)+row_number() OVER(ORDER BY w.id)::integer
  FROM work_items w WHERE w.monitoring_enabled AND w.deleted_at IS NULL AND w.lifecycle_state='ACTIVE'
  AND w.workflow_type::text=ANY(CASE v_run.channel WHEN 'samai_estados' THEN ARRAY['CPACA','TUTELA'] ELSE ARRAY['CGP','EJECUTIVO','LABORAL','PENAL_906','TUTELA'] END)
  AND regexp_replace(coalesce(w.radicado,''),'[^0-9]','','g') ~ '^[0-9]{23}$'
  AND NOT EXISTS(SELECT 1 FROM estados_monitor_run_items i WHERE i.run_id=v_run.id AND i.work_item_id=w.id);
  UPDATE estados_monitor_run_items SET status='PENDING',attempts=0,lease_token=NULL,next_attempt_at=now(),claimed_at=NULL,finished_at=NULL,error_code=NULL,result='{}' WHERE run_id=v_run.id;
  UPDATE estados_monitor_runs SET status='PARTIAL',attempted_count=0,succeeded_count=0,failed_count=0,
   selected_count=(SELECT count(*) FROM estados_monitor_run_items WHERE run_id=v_run.id),depth_remaining=60,finished_at=NULL,lease_expires_at=now(),
   metadata=metadata||jsonb_build_object('activation_revalidation',true,'revalidated_at',now()) WHERE id=v_run.id;
 END LOOP;
END $$;
COMMIT;
