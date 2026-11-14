SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';

CREATE OR REPLACE FUNCTION public._admit_daily_update_at(
  _d date,
  _work_item_id uuid,
  _channel text,
  _invoker text,
  _trace_id text,
  _retry_task_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  w record;
  c public.daily_update_cycles;
  prior jsonb;
  tok uuid := gen_random_uuid();
BEGIN
  IF _channel NOT IN ('acts','pubs') THEN
    RAISE EXCEPTION 'INVALID_CHANNEL' USING ERRCODE='22023';
  END IF;

  SELECT id, owner_id, organization_id, scrape_status::text AS scrape_status, scrape_job_id
    INTO w FROM public.work_items WHERE id=_work_item_id;
  IF w.id IS NULL OR w.owner_id IS NULL THEN
    RETURN jsonb_build_object('admitted',false,'reason','WORK_ITEM_UNRESOLVED');
  END IF;

  INSERT INTO public.daily_update_cycles(run_date, work_item_id, owner_id, organization_id)
    VALUES (_d, _work_item_id, w.owner_id, w.organization_id)
    ON CONFLICT DO NOTHING;
  SELECT * INTO c FROM public.daily_update_cycles
    WHERE run_date=_d AND work_item_id=_work_item_id FOR UPDATE;

  IF c.channels ? _channel THEN
    IF _channel = 'acts'
       AND c.channels->_channel->>'status' = 'STARTED'
       AND (c.channels->_channel->>'started_at')::timestamptz < now() - interval '15 minutes'
       AND NOT (
         w.scrape_status = 'IN_PROGRESS'
         AND w.scrape_job_id IS NOT NULL
         AND w.scrape_job_id = c.channels->_channel->>'cpnu_job_id'
       ) THEN
      UPDATE public.daily_update_cycles
        SET duplicate_requests=duplicate_requests+1,
            updated_at=now(),
            last_duplicate=jsonb_build_object(
              'channel',_channel,'invoker',_invoker,'trace_id',_trace_id,
              'retry_task_id',_retry_task_id,'at',now()),
            channels=jsonb_set(
              channels,
              ARRAY[_channel],
              (c.channels->_channel) - 'token' || jsonb_build_object(
                'status','FAILED',
                'error_code','DAILY_ADMISSION_STALE_RECOVERED',
                'finished_at',now(),
                'stale_recovery',jsonb_build_object(
                  'at',now(),'trace_id',_trace_id,
                  'previous_trace_id',c.channels->_channel->>'trace_id')))
        WHERE run_date=_d AND work_item_id=_work_item_id
      RETURNING channels->_channel INTO prior;

      RETURN jsonb_build_object(
        'admitted',false,
        'reason','DAILY_UPDATE_ALREADY_STARTED',
        'run_date',_d,
        'channel',_channel,
        'existing',prior - 'token',
        'next_eligible_at',public.bogota_next_midnight(_d));
    END IF;

    UPDATE public.daily_update_cycles
      SET duplicate_requests=duplicate_requests+1,
          updated_at=now(),
          last_duplicate=jsonb_build_object(
            'channel',_channel,'invoker',_invoker,'trace_id',_trace_id,
            'retry_task_id',_retry_task_id,'at',now())
      WHERE run_date=_d AND work_item_id=_work_item_id;
    RETURN jsonb_build_object(
      'admitted',false,
      'reason','DAILY_UPDATE_ALREADY_STARTED',
      'run_date',_d,
      'channel',_channel,
      'existing',(c.channels->_channel) - 'token',
      'next_eligible_at',public.bogota_next_midnight(_d));
  END IF;

  UPDATE public.daily_update_cycles
    SET updated_at=now(),
        channels=channels || jsonb_build_object(
          _channel,
          jsonb_build_object(
            'status','STARTED','token',tok,'started_at',now(),
            'invoker',_invoker,'trace_id',_trace_id,
            'retry_task_id',_retry_task_id))
    WHERE run_date=_d AND work_item_id=_work_item_id;
  RETURN jsonb_build_object(
    'admitted',true,'mode','new','run_date',_d,
    'channel',_channel,'token',tok);
END
$function$;