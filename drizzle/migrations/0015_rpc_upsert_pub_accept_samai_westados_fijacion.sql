DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.rpc_upsert_work_item_publicaciones(jsonb)'::regprocedure);
  IF position('v_fecha_fijacion := NULL;' in d) = 0 THEN RAISE EXCEPTION 'anchor not found'; END IF;
  d := replace(d,
    'v_fecha_fijacion := NULL;',
    'v_fecha_fijacion := CASE WHEN (rec #>> ''{raw_data,fecha_estado_procedencia,fuente}'') = ''SAMAI_WESTADOS''
                                      OR (rec #>> ''{raw_data,raw_data,fecha_estado_procedencia,fuente}'') = ''SAMAI_WESTADOS''
                                 THEN NULLIF(rec->>''fecha_fijacion'','''')::timestamptz END;
        -- AUD7: a provenanced fijación is never a providencia fallback; the
        -- enforce_samai_estados_no_fijacion trigger still gates the value.');
  d := replace(d,
    'IF v_fecha_providencia IS NULL THEN
          v_fecha_providencia := NULLIF(rec->>''fecha_fijacion'','''')::timestamptz;',
    'IF v_fecha_providencia IS NULL AND v_fecha_fijacion IS NULL THEN
          v_fecha_providencia := NULLIF(rec->>''fecha_fijacion'','''')::timestamptz;');
  EXECUTE d;
END
$do$;