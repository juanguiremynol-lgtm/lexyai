
-- Update acquire_daily_sync_lock to work with partial unique index
-- The function now uses a SELECT check instead of ON CONFLICT
CREATE OR REPLACE FUNCTION public.acquire_daily_sync_lock(
  p_organization_id UUID,
  p_run_id TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today DATE;
  v_scheduled_for TIMESTAMPTZ;
  v_ledger_id UUID;
  v_current_status public.daily_sync_status;
BEGIN
  -- Get today in America/Bogota timezone
  v_today := (now() AT TIME ZONE 'America/Bogota')::DATE;
  v_scheduled_for := (v_today || ' 07:00:00')::TIMESTAMP AT TIME ZONE 'America/Bogota';
  
  -- Check if an initial (non-continuation) ledger entry exists for today
  SELECT id, status INTO v_ledger_id, v_current_status
  FROM public.auto_sync_daily_ledger
  WHERE organization_id = p_organization_id 
    AND run_date = v_today
    AND (is_continuation IS NOT TRUE)
  FOR UPDATE;
  
  -- If no entry exists, create one
  IF v_ledger_id IS NULL THEN
    INSERT INTO public.auto_sync_daily_ledger (
      organization_id, run_date, scheduled_for, status, run_id, is_continuation
    )
    VALUES (
      p_organization_id, v_today, v_scheduled_for, 'PENDING', p_run_id, false
    )
    RETURNING id, status INTO v_ledger_id, v_current_status;
  END IF;
  
  -- If already SUCCESS, don't run again
  IF v_current_status = 'SUCCESS' THEN
    RETURN jsonb_build_object(
      'acquired', false,
      'ledger_id', v_ledger_id,
      'status', v_current_status::TEXT,
      'reason', 'Already completed successfully today'
    );
  END IF;
  
  -- If RUNNING, check for stale lock (> 5 minutes without heartbeat)
  IF v_current_status = 'RUNNING' THEN
    IF EXISTS (
      SELECT 1 FROM public.auto_sync_daily_ledger
      WHERE id = v_ledger_id 
        AND last_heartbeat_at > now() - INTERVAL '5 minutes'
    ) THEN
      RETURN jsonb_build_object(
        'acquired', false,
        'ledger_id', v_ledger_id,
        'status', v_current_status::TEXT,
        'reason', 'Another run is in progress'
      );
    END IF;
    -- Stale lock, can take over
  END IF;
  
  -- Acquire lock by setting to RUNNING
  UPDATE public.auto_sync_daily_ledger
  SET status = 'RUNNING',
      started_at = COALESCE(started_at, now()),
      run_id = COALESCE(p_run_id, run_id, gen_random_uuid()::TEXT),
      last_heartbeat_at = now(),
      retry_count = retry_count + CASE WHEN v_current_status IN ('FAILED', 'PARTIAL') THEN 1 ELSE 0 END,
      updated_at = now()
  WHERE id = v_ledger_id
  RETURNING id INTO v_ledger_id;
  
  RETURN jsonb_build_object(
    'acquired', true,
    'ledger_id', v_ledger_id,
    'status', 'RUNNING',
    'previous_status', v_current_status::TEXT
  );
END;
$function$;
