BEGIN;

SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF strpos(pg_get_functiondef('public.defer_public_monitor_read(uuid,uuid,uuid,timestamptz,jsonb)'::regprocedure),
    'AND NOT (_result ? ''stored_result_read'')') = 0 THEN
    RAISE EXCEPTION 'Public monitor deferral differs from the verified deployed function';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.defer_public_monitor_read(
  _run_id uuid, _work_item_id uuid, _lease_token uuid, _retry_at timestamptz, _result jsonb
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public
AS $function$
DECLARE n integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service only' USING ERRCODE = '42501';
  END IF;
  IF _result->>'result_code' IS DISTINCT FROM 'DAILY_UPDATE_ALREADY_STARTED'
    OR _result->>'deduplicated' IS DISTINCT FROM 'true'
    OR _result#>>'{daily_update,admitted}' IS DISTINCT FROM 'false'
    OR _retry_at IS NULL THEN
    RAISE EXCEPTION 'not a deferred read';
  END IF;

  UPDATE public.estados_monitor_run_items i
  SET status = 'PENDING', attempts = greatest(i.attempts - 1, 0),
    claimed_at = NULL, lease_token = NULL, finished_at = NULL,
    next_attempt_at = greatest(now() + interval '30 seconds', least(_retry_at, now() + interval '48 hours')),
    error_code = 'DAILY_UPDATE_ALREADY_STARTED',
    result = CASE
      WHEN r.channel = 'publicaciones'
        AND i.result#>>'{monitor_evidence,recent_window_verified}' = 'true'
        AND i.result#>>'{pp_window,to}' = r.run_date::text
        AND _result->>'source_query_attempted' IS DISTINCT FROM 'true'
        AND (
          NOT (_result ? 'stored_result_read')
          OR (
            -- A separate run ending before this one cannot invalidate its certificate.
            _result#>>'{stored_result_read,identity_match}' = 'true'
            AND _result#>>'{stored_result_read,backend_run_id}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
            AND i.result#>>'{backend_trace,backend_run_id}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
            AND lower(_result#>>'{stored_result_read,backend_run_id}') <> lower(i.result#>>'{backend_trace,backend_run_id}')
            AND CASE WHEN pg_input_is_valid(_result#>>'{stored_result_read,checkpoint,until}', 'date')
              THEN (_result#>>'{stored_result_read,checkpoint,until}')::date < r.run_date
              ELSE false END
          )
        )
      THEN i.result || jsonb_build_object('monitor_deferred_without_read', true, 'monitor_last_read_deferral', _result)
      ELSE _result || '{"monitor_deferred_without_read":true}'::jsonb
    END
  FROM public.estados_monitor_runs r
  WHERE r.id = i.run_id AND r.status IN ('RUNNING', 'PARTIAL')
    AND i.run_id = _run_id AND i.work_item_id = _work_item_id AND i.status = 'CLAIMED'
    AND i.lease_token = _lease_token AND i.claimed_at > now() - interval '3 minutes';

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$function$;

COMMIT;
