-- Test-only helpers: operate exclusively on isolated far-future days (>= 2099)
-- so they can never consume or reveal a real daily admission.
CREATE OR REPLACE FUNCTION public._daily_gate_probe_admit(_d date, _work_item_id uuid, _channel text, _hold_ms integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; t0 timestamptz := clock_timestamp();
BEGIN
  IF _d < DATE '2099-01-01' THEN RAISE EXCEPTION 'PROBE_DATE_NOT_ISOLATED' USING ERRCODE='22023'; END IF;
  r := public._admit_daily_update_at(_d, _work_item_id, _channel, 'concurrency-probe', NULL, NULL);
  IF _hold_ms > 0 THEN PERFORM pg_sleep(_hold_ms / 1000.0); END IF;
  RETURN (r - 'token') || jsonb_build_object('pid', pg_backend_pid(), 'txid', txid_current(),
    'called_at', t0, 'returned_at', clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public._daily_gate_probe_admit(date,uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._daily_gate_probe_admit(date,uuid,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public._daily_gate_probe_cleanup()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM daily_update_cycles WHERE run_date >= DATE '2099-01-01';
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public._daily_gate_probe_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._daily_gate_probe_cleanup() TO service_role;