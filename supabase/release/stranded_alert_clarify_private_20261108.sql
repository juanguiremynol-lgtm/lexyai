-- Clarify the sole unresolved historical warning using the later CPNU result.
-- Preserve its previous text and keep the warning open.
BEGIN;
DO $clarify$
DECLARE v_timeline uuid; v_rows integer;
BEGIN
  SELECT id INTO v_timeline FROM public.work_item_sync_timeline
    WHERE work_item_id='c3912ba4-0f1b-434b-9d9c-e40c372cd1e8'
      AND operation='acts' AND lower(provider)='cpnu'
    ORDER BY started_at DESC LIMIT 1;
  IF NOT EXISTS(SELECT 1 FROM public.work_item_sync_timeline WHERE id=v_timeline
    AND status='error' AND error_code='PROCESO_PRIVADO'
    AND started_at>='2026-11-08 05:00:00+00'::timestamptz) THEN
    RAISE EXCEPTION 'latest CPNU evidence changed';
  END IF;
  UPDATE public.system_health_events SET
    message='La consulta de actuaciones del 2026-11-07 no registró resultado final. El intento posterior del 2026-11-08 reportó PROCESO_PRIVADO en CPNU; la actualización sigue sin acreditarse.',
    metadata=metadata||jsonb_build_object('prior_message',message,'latest_cpnu_timeline_id',v_timeline,
      'clarified_at',now())
  WHERE id='fe8366fc-8e70-4ff2-8e6c-3b39044b0d4c' AND status='WARN'
    AND service='DAILY_UPDATE_WATCHDOG'
    AND metadata->>'work_item_id'='c3912ba4-0f1b-434b-9d9c-e40c372cd1e8';
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN RAISE EXCEPTION 'warning changed'; END IF;
END
$clarify$;
COMMIT;
