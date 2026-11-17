DO $$
DECLARE
  v_def text;
  v_n int;
  v_bad int;
BEGIN
  SELECT count(*), max(pg_get_constraintdef(oid)) INTO v_n, v_def
  FROM pg_constraint
  WHERE conrelid = 'public.work_item_email_links'::regclass AND conname = 'work_item_email_links_matched_by_chk';
  IF v_n = 1 AND v_def LIKE '%MENSAJE%CONVERSACION%IDENTIFICADOR_OFICIAL%' THEN
    RAISE NOTICE 'matched_by constraint already widened; no change';
    RETURN;
  END IF;
  IF v_n <> 1 OR v_def <> 'CHECK ((matched_by = ANY (ARRAY[''RADICADO''::text, ''RADICADO_PARCIAL''::text, ''RADICADO_SIN_CERO''::text, ''PARTE''::text, ''DESPACHO''::text, ''CLIENTE''::text, ''MANUAL''::text])))' THEN
    RAISE EXCEPTION 'ABORT: unexpected matched_by constraint state (count=%, def=%)', v_n, v_def;
  END IF;
  SELECT count(*) INTO v_bad FROM public.work_item_email_links
  WHERE matched_by IS NULL OR matched_by NOT IN ('RADICADO','RADICADO_PARCIAL','RADICADO_SIN_CERO','PARTE','DESPACHO','CLIENTE','MANUAL');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % rows with unexpected matched_by', v_bad;
  END IF;
  ALTER TABLE public.work_item_email_links DROP CONSTRAINT work_item_email_links_matched_by_chk;
  ALTER TABLE public.work_item_email_links ADD CONSTRAINT work_item_email_links_matched_by_chk
    CHECK (matched_by = ANY (ARRAY['RADICADO','RADICADO_PARCIAL','RADICADO_SIN_CERO','PARTE','DESPACHO','CLIENTE','MANUAL','MENSAJE','CONVERSACION','IDENTIFICADOR_OFICIAL']));
  RAISE NOTICE 'matched_by constraint widened';
END $$;