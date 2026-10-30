CREATE TABLE public.daily_update_cycles (
  run_date date NOT NULL,
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  organization_id uuid,
  channels jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_requests integer NOT NULL DEFAULT 0,
  continuations integer NOT NULL DEFAULT 0,
  last_duplicate jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_date, work_item_id)
);
COMMENT ON TABLE public.daily_update_cycles IS 'One logical update per owner+work_item per Bogota calendar day; channels (acts, pubs) are sub-jobs admitted at most once each.';
CREATE INDEX idx_duc_owner_date ON public.daily_update_cycles(owner_id, run_date DESC);
GRANT ALL ON public.daily_update_cycles TO service_role;
GRANT SELECT ON public.daily_update_cycles TO authenticated;
ALTER TABLE public.daily_update_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their daily update cycles" ON public.daily_update_cycles FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE FUNCTION public.bogota_next_midnight(_d date) RETURNS timestamptz LANGUAGE sql IMMUTABLE
AS $$ SELECT ((_d + 1)::timestamp AT TIME ZONE 'America/Bogota') $$;

-- Atomic, idempotent admission. Day and owner are derived server-side.
CREATE FUNCTION public.admit_daily_update(_work_item_id uuid, _channel text, _invoker text DEFAULT NULL,
  _trace_id text DEFAULT NULL, _retry_task_id text DEFAULT NULL, _continuation boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d date := (now() AT TIME ZONE 'America/Bogota')::date; w record; c public.daily_update_cycles; tok uuid := gen_random_uuid();
BEGIN
  IF _channel NOT IN ('acts','pubs') THEN RAISE EXCEPTION 'INVALID_CHANNEL' USING ERRCODE='22023'; END IF;
  SELECT id, owner_id, organization_id INTO w FROM work_items WHERE id=_work_item_id;
  IF w.id IS NULL OR w.owner_id IS NULL THEN RETURN jsonb_build_object('admitted',false,'reason','WORK_ITEM_UNRESOLVED'); END IF;
  IF _continuation THEN
    -- Continuation of an already admitted channel (same or previous day); never opens a new update.
    SELECT * INTO c FROM daily_update_cycles WHERE work_item_id=_work_item_id AND run_date IN (d, d-1)
      AND channels ? _channel AND channels->_channel->>'status' IN ('STARTED','PARTIAL','PENDING_UPSTREAM')
      ORDER BY run_date DESC LIMIT 1 FOR UPDATE;
    IF c.run_date IS NULL THEN RETURN jsonb_build_object('admitted',false,'reason','NO_OPEN_CYCLE','run_date',d,'next_eligible_at',bogota_next_midnight(d)); END IF;
    UPDATE daily_update_cycles SET continuations=continuations+1, updated_at=now() WHERE run_date=c.run_date AND work_item_id=_work_item_id;
    RETURN jsonb_build_object('admitted',true,'mode','continuation','run_date',c.run_date,'channel',_channel,'token',c.channels->_channel->>'token');
  END IF;
  INSERT INTO daily_update_cycles(run_date, work_item_id, owner_id, organization_id) VALUES (d, _work_item_id, w.owner_id, w.organization_id) ON CONFLICT DO NOTHING;
  SELECT * INTO c FROM daily_update_cycles WHERE run_date=d AND work_item_id=_work_item_id FOR UPDATE;
  IF c.channels ? _channel THEN
    UPDATE daily_update_cycles SET duplicate_requests=duplicate_requests+1, updated_at=now(),
      last_duplicate=jsonb_build_object('channel',_channel,'invoker',_invoker,'trace_id',_trace_id,'retry_task_id',_retry_task_id,'at',now())
      WHERE run_date=d AND work_item_id=_work_item_id;
    RETURN jsonb_build_object('admitted',false,'reason','DAILY_UPDATE_ALREADY_STARTED','run_date',d,'channel',_channel,
      'existing',c.channels->_channel - 'token','next_eligible_at',bogota_next_midnight(d));
  END IF;
  UPDATE daily_update_cycles SET updated_at=now(), channels = channels || jsonb_build_object(_channel, jsonb_build_object(
    'status','STARTED','token',tok,'started_at',now(),'invoker',_invoker,'trace_id',_trace_id,'retry_task_id',_retry_task_id))
    WHERE run_date=d AND work_item_id=_work_item_id;
  RETURN jsonb_build_object('admitted',true,'mode','new','run_date',d,'channel',_channel,'token',tok);
END $$;

-- Read-only pre-check so dispatchers avoid invoking functions that would be deduplicated.
CREATE FUNCTION public.peek_daily_update(_work_item_id uuid, _channel text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('started', coalesce((SELECT channels ? _channel FROM daily_update_cycles
    WHERE run_date=(now() AT TIME ZONE 'America/Bogota')::date AND work_item_id=_work_item_id), false),
    'next_eligible_at', bogota_next_midnight((now() AT TIME ZONE 'America/Bogota')::date))
$$;

-- Fenced by the admission token; terminal status is evidence only, never re-admission.
CREATE FUNCTION public.finish_daily_update(_run_date date, _work_item_id uuid, _channel text, _token uuid, _status text, _error_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE daily_update_cycles SET updated_at=now(), channels = jsonb_set(channels, ARRAY[_channel],
    (channels->_channel) || jsonb_build_object('status', upper(_status), 'error_code', _error_code, 'finished_at', now()))
  WHERE run_date=_run_date AND work_item_id=_work_item_id AND channels->_channel->>'token' = _token::text;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n = 1;
END $$;

REVOKE ALL ON FUNCTION public.admit_daily_update(uuid,text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.peek_daily_update(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_daily_update(date,uuid,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_daily_update(uuid,text,text,text,text,boolean), public.peek_daily_update(uuid,text),
  public.finish_daily_update(date,uuid,text,uuid,text,text) TO service_role;