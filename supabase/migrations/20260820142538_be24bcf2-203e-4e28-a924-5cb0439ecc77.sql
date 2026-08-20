CREATE OR REPLACE FUNCTION public.trg_probe_p0b()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_state text; v_msg text; v_out jsonb := '{}'::jsonb; t text;
BEGIN
  SELECT id INTO v_id FROM public.work_items WHERE deleted_at IS NOT NULL LIMIT 1;
  FOREACH t IN ARRAY ARRAY['external_sync_runs','sync_traces','provider_sync_traces'] LOOP
    BEGIN
      EXECUTE format('INSERT INTO public.%I (work_item_id) VALUES ($1)', t) USING v_id;
      v_out := v_out || jsonb_build_object(t, 'NO_EXCEPTION_RAISED');
      RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'P0001';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      IF v_state <> 'P0001' THEN
        v_out := v_out || jsonb_build_object(t, jsonb_build_object('sqlstate', v_state, 'message', v_msg));
      END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('probe_work_item_id', v_id, 'results', v_out, 'rolled_back', true);
END $$;