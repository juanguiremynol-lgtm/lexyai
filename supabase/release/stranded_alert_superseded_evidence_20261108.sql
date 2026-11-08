-- Reclassify only the nine warnings created by the first watchdog run that
-- have independently verified later complete source observations. Preserve
-- each original message/status and the timeline evidence. No events deleted.
BEGIN;
DO $resolve$
DECLARE v_rows integer;
BEGIN
  WITH recovered AS (
    SELECT DISTINCT ON(e.id) e.id,t.id AS timeline_id,t.metadata->>'source_observed_at' AS observed_at
    FROM public.system_health_events e
    JOIN public.work_items w ON w.id=(e.metadata->>'work_item_id')::uuid
    JOIN public.work_item_sync_timeline t ON t.work_item_id=w.id
      AND t.operation='acts' AND t.status='success' AND t.error_code IS NULL
      AND lower(t.provider)=CASE WHEN w.workflow_type::text='CPACA' THEN 'samai' ELSE 'cpnu' END
      AND t.metadata->>'source_complete'='true'
      AND t.finished_at>(e.metadata->>'started_at')::timestamptz
      AND CASE WHEN pg_input_is_valid(t.metadata->>'source_observed_at','timestamp with time zone')
        THEN (t.metadata->>'source_observed_at')::timestamptz>(e.metadata->>'started_at')::timestamptz
        ELSE false END
    WHERE e.id=ANY(ARRAY[
      '6ae4e98d-3958-4e4d-9bba-932e7bb3f87e','191b0309-6757-4736-8da0-64b417a2c335',
      'cc27f111-e87b-4ff0-9808-ad6f560f5bed','8c66a9be-83ec-4837-951d-7131c2dfea58',
      '48c0adb2-0148-4761-922e-314157b8ac99','8ee1d5e8-67ca-4dd8-a432-202549ab4b82',
      '05151f31-0273-4344-9fd4-a6e205c99480','b9e5b216-ff66-49b0-b047-3c0cba20d04a',
      '56a74a5c-5857-4ca4-a01a-35733f760be8']::uuid[])
      AND e.service='DAILY_UPDATE_WATCHDOG' AND e.status='WARN'
      AND e.metadata->>'kind'='DAILY_UPDATE_WITHOUT_TERMINAL_RESULT'
      AND e.metadata->>'channel'='acts'
    ORDER BY e.id,t.finished_at DESC
  )
  UPDATE public.system_health_events e SET status='OK',
    message='El intento histórico no registró cierre; una observación posterior completa del proveedor acredita la lectura posterior.',
    metadata=e.metadata||jsonb_build_object('original_status',e.status,'original_message',e.message,
      'resolution','LATER_CERTIFIED_SOURCE_OBSERVATION','resolution_recorded_at',now(),
      'resolution_timeline_id',r.timeline_id,'resolution_source_observed_at',r.observed_at)
  FROM recovered r WHERE e.id=r.id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>9 THEN RAISE EXCEPTION 'expected 9 verified warnings, found %',v_rows; END IF;
END
$resolve$;
COMMIT;
