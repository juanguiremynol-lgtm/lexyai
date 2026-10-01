CREATE OR REPLACE FUNCTION public.claim_estados_monitor_run(_channel text, _run_date date, _work_item_ids uuid[], _depth_budget integer DEFAULT 12, _lease_seconds integer DEFAULT 180)
 RETURNS TABLE(run_id uuid, acquired boolean, selected_count integer, attempted_count integer, depth_remaining integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rid uuid;
  got boolean := false;
BEGIN
  IF _channel NOT IN ('publicaciones','samai_estados') THEN
    RAISE EXCEPTION 'unsupported estados channel';
  END IF;
  -- 01/10/2026: the monitor runs one case per hop (MAX_DEPTH 60); the former
  -- ceiling of 32 rejected every daily claim on 30/09 and 01/10.
  IF _depth_budget < 1 OR _depth_budget > 64 THEN
    RAISE EXCEPTION 'invalid depth budget';
  END IF;

  INSERT INTO public.estados_monitor_runs(channel, run_date, selected_count, depth_remaining, lease_expires_at)
  VALUES (_channel, _run_date, cardinality(_work_item_ids), _depth_budget, now() + make_interval(secs => _lease_seconds))
  ON CONFLICT (channel, run_date) DO NOTHING
  RETURNING id INTO rid;

  IF rid IS NOT NULL THEN
    got := true;
    INSERT INTO public.estados_monitor_run_items(run_id, work_item_id, ordinal)
    SELECT rid, x.work_item_id, x.ordinality::integer
    FROM unnest(_work_item_ids) WITH ORDINALITY AS x(work_item_id, ordinality)
    ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.estados_monitor_runs r
       SET lease_expires_at = now() + make_interval(secs => _lease_seconds)
     WHERE r.channel = _channel
       AND r.run_date = _run_date
       AND r.status IN ('RUNNING','PARTIAL')
       AND r.lease_expires_at < now()
    RETURNING r.id INTO rid;
    got := rid IS NOT NULL;
  END IF;

  RETURN QUERY
  SELECT r.id, got, r.selected_count, r.attempted_count, r.depth_remaining
  FROM public.estados_monitor_runs r
  WHERE r.id = rid;
END;
$function$;