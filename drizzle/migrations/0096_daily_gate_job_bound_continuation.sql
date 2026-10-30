-- Core admission on an explicit day; the public wrapper always passes the
-- server-computed Bogotá day. Isolated far-future days are used only by tests.
CREATE OR REPLACE FUNCTION public._admit_daily_update_at(_d date, _work_item_id uuid, _channel text, _invoker text,
  _trace_id text, _retry_task_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w record; c public.daily_update_cycles; tok uuid := gen_random_uuid();
BEGIN
  IF _channel NOT IN ('acts','pubs') THEN RAISE EXCEPTION 'INVALID_CHANNEL' USING ERRCODE='22023'; END IF;
  SELECT id, owner_id, organization_id INTO w FROM work_items WHERE id=_work_item_id;
  IF w.id IS NULL OR w.owner_id IS NULL THEN RETURN jsonb_build_object('admitted',false,'reason','WORK_ITEM_UNRESOLVED'); END IF;
  INSERT INTO daily_update_cycles(run_date, work_item_id, owner_id, organization_id) VALUES (_d, _work_item_id, w.owner_id, w.organization_id) ON CONFLICT DO NOTHING;
  SELECT * INTO c FROM daily_update_cycles WHERE run_date=_d AND work_item_id=_work_item_id FOR UPDATE;
  IF c.channels ? _channel THEN
    UPDATE daily_update_cycles SET duplicate_requests=duplicate_requests+1, updated_at=now(),
      last_duplicate=jsonb_build_object('channel',_channel,'invoker',_invoker,'trace_id',_trace_id,'retry_task_id',_retry_task_id,'at',now())
      WHERE run_date=_d AND work_item_id=_work_item_id;
    RETURN jsonb_build_object('admitted',false,'reason','DAILY_UPDATE_ALREADY_STARTED','run_date',_d,'channel',_channel,
      'existing',((c.channels->_channel) - 'token'),'next_eligible_at',bogota_next_midnight(_d));
  END IF;
  UPDATE daily_update_cycles SET updated_at=now(), channels = channels || jsonb_build_object(_channel, jsonb_build_object(
    'status','STARTED','token',tok,'started_at',now(),'invoker',_invoker,'trace_id',_trace_id,'retry_task_id',_retry_task_id))
    WHERE run_date=_d AND work_item_id=_work_item_id;
  RETURN jsonb_build_object('admitted',true,'mode','new','run_date',_d,'channel',_channel,'token',tok);
END $$;
REVOKE ALL ON FUNCTION public._admit_daily_update_at(date,uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._admit_daily_update_at(date,uuid,text,text,text,text) TO service_role;

-- Age-based continuations are retired: a continuation must name its durable job.
CREATE OR REPLACE FUNCTION public.admit_daily_update(_work_item_id uuid, _channel text, _invoker text DEFAULT NULL,
  _trace_id text DEFAULT NULL, _retry_task_id text DEFAULT NULL, _continuation boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _continuation THEN
    RETURN jsonb_build_object('admitted',false,'reason','CONTINUATION_REQUIRES_JOB');
  END IF;
  RETURN public._admit_daily_update_at((now() AT TIME ZONE 'America/Bogota')::date, _work_item_id, _channel, _invoker, _trace_id, _retry_task_id);
END $$;
REVOKE ALL ON FUNCTION public.admit_daily_update(uuid,text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_daily_update(uuid,text,text,text,text,boolean) TO service_role;

-- Bind every newly stored durable scrape job to the acts admission that started it.
CREATE OR REPLACE FUNCTION public.bind_scrape_job_to_daily_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  SELECT run_date INTO c FROM daily_update_cycles
   WHERE work_item_id = NEW.id AND channels ? 'acts'
     AND channels->'acts'->>'cpnu_job_id' IS NULL
     AND (channels->'acts'->>'started_at')::timestamptz >= now() - interval '30 minutes'
   ORDER BY run_date DESC LIMIT 1 FOR UPDATE;
  IF c.run_date IS NOT NULL THEN
    UPDATE daily_update_cycles SET updated_at = now(),
      channels = jsonb_set(channels, '{acts,cpnu_job_id}', to_jsonb(NEW.scrape_job_id))
             || jsonb_build_object('acts', (channels->'acts') || jsonb_build_object('cpnu_job_id', NEW.scrape_job_id, 'cpnu_job_bound_at', now()))
     WHERE run_date = c.run_date AND work_item_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bind_scrape_job_to_daily_cycle() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_bind_scrape_job_to_daily_cycle ON public.work_items;
CREATE TRIGGER trg_bind_scrape_job_to_daily_cycle AFTER UPDATE OF scrape_job_id ON public.work_items
  FOR EACH ROW WHEN (NEW.scrape_job_id IS NOT NULL AND NEW.scrape_job_id IS DISTINCT FROM OLD.scrape_job_id)
  EXECUTE FUNCTION public.bind_scrape_job_to_daily_cycle();

-- Ingestion of an existing durable job result: identity, not age.
CREATE OR REPLACE FUNCTION public.admit_cpnu_continuation(_work_item_id uuid, _job_id text, _trace_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w record; c public.daily_update_cycles;
BEGIN
  IF _job_id IS NULL OR length(_job_id) = 0 THEN RETURN jsonb_build_object('admitted',false,'reason','JOB_ID_REQUIRED'); END IF;
  SELECT id, scrape_job_id, scrape_status::text AS st INTO w FROM work_items WHERE id=_work_item_id FOR SHARE;
  IF w.id IS NULL OR w.scrape_job_id IS DISTINCT FROM _job_id OR w.st <> 'IN_PROGRESS' THEN
    RETURN jsonb_build_object('admitted',false,'reason','JOB_NOT_CURRENT');
  END IF;
  SELECT * INTO c FROM daily_update_cycles WHERE work_item_id=_work_item_id AND channels->'acts'->>'cpnu_job_id' = _job_id
   ORDER BY run_date DESC LIMIT 1 FOR UPDATE;
  IF c.run_date IS NULL THEN RETURN jsonb_build_object('admitted',false,'reason','JOB_NOT_BOUND_TO_CYCLE'); END IF;
  UPDATE daily_update_cycles SET continuations=continuations+1, updated_at=now(),
    channels = channels || jsonb_build_object('acts', (channels->'acts') || jsonb_build_object('last_continuation',
      jsonb_build_object('job_id',_job_id,'trace_id',_trace_id,'at',now())))
   WHERE run_date=c.run_date AND work_item_id=_work_item_id;
  RETURN jsonb_build_object('admitted',true,'mode','continuation','channel','acts','origin_run_date',c.run_date,
    'run_date',c.run_date,'job_id',_job_id,'origin_trace_id',c.channels->'acts'->>'trace_id');
END $$;
REVOKE ALL ON FUNCTION public.admit_cpnu_continuation(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_cpnu_continuation(uuid,text,text) TO service_role;

-- One GET /runs per admitted PP run per interval, for every caller.
CREATE OR REPLACE FUNCTION public.claim_pp_followup_poll(_work_item_id uuid, _run_id text, _min_interval_seconds integer DEFAULT 600)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  UPDATE cron_state SET updated_at = now(),
    value = value || jsonb_build_object('next_poll_at', now() + make_interval(secs => GREATEST(_min_interval_seconds, 60)), 'poll_claimed_at', now())
   WHERE key = 'pub_rescrape:' || _work_item_id::text
     AND value->>'backend_run_id' = _run_id
     AND COALESCE((value->>'followup_closed')::boolean, false) = false
     AND COALESCE((value->>'next_poll_at')::timestamptz, '-infinity'::timestamptz) <= now()
  RETURNING value INTO v;
  IF v IS NOT NULL THEN RETURN jsonb_build_object('claimed', true); END IF;
  SELECT value INTO v FROM cron_state WHERE key = 'pub_rescrape:' || _work_item_id::text;
  RETURN jsonb_build_object('claimed', false, 'next_poll_at', v->>'next_poll_at', 'last_poll_estado', v->>'last_poll_estado',
    'last_polled_at', v->>'last_polled_at', 'last_poll_error', v->>'last_poll_error');
END $$;
REVOKE ALL ON FUNCTION public.claim_pp_followup_poll(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pp_followup_poll(uuid,text,integer) TO service_role;