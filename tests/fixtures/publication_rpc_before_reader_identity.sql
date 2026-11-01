CREATE OR REPLACE FUNCTION public.rpc_upsert_work_item_publicaciones(records jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec jsonb;
  parsed_count int := 0;
  inserted_count int := 0;
  skipped_count int := 0;
  updated_count int := 0;
  changed_count int := 0;
  structural_count int := 0;
  rejected_count int := 0;
  error_count int := 0;
  unique_violation_count int := 0;
  errors text[] := '{}';
  outcomes jsonb := '[]'::jsonb;
  v_content_hash text;
  v_existing record;
  v_sources text[];
  v_records jsonb;
  v_is_samai boolean;
  v_fecha_fijacion timestamptz;
  v_fecha_providencia timestamptz;
  v_published_at timestamptz;
  v_structural_date date;
  v_reason text;
  v_structural_hit boolean;
  v_enriched boolean;
BEGIN
  IF jsonb_typeof(records) = 'string' THEN
    BEGIN
      v_records := (records #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'parsed_count', 0, 'inserted_count', 0, 'updated_count', 0, 'skipped_count', 0,
        'structural_count', 0, 'rejected_count', 0, 'error_count', 1, 'unique_violation_count', 0,
        'changed_count', 0, 'errors', jsonb_build_array('records parameter is a non-parseable string: ' || SQLERRM),
        'outcomes', jsonb_build_array(jsonb_build_object('bucket','ERROR','reason',SQLERRM))
      );
    END;
  ELSIF jsonb_typeof(records) = 'object' THEN
    v_records := jsonb_build_array(records);
  ELSIF jsonb_typeof(records) = 'array' THEN
    v_records := records;
  ELSE
    RETURN jsonb_build_object(
      'parsed_count', 0, 'inserted_count', 0, 'updated_count', 0, 'skipped_count', 0,
      'structural_count', 0, 'rejected_count', 0, 'error_count', 1, 'unique_violation_count', 0,
      'changed_count', 0, 'errors', jsonb_build_array('records parameter has unexpected type: ' || jsonb_typeof(records)),
      'outcomes', jsonb_build_array(jsonb_build_object('bucket','ERROR','reason','unexpected records parameter type'))
    );
  END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(v_records)
  LOOP
    parsed_count := parsed_count + 1;
    v_structural_hit := false;
    v_enriched := false;
    BEGIN
      v_is_samai := (rec->>'source') = 'samai_estados';
      v_fecha_providencia := NULLIF(rec->>'fecha_providencia','')::timestamptz;
      IF v_is_samai THEN
        v_fecha_fijacion := CASE WHEN (rec #>> '{raw_data,fecha_estado_procedencia,fuente}') = 'SAMAI_WESTADOS'
                                      OR (rec #>> '{raw_data,raw_data,fecha_estado_procedencia,fuente}') = 'SAMAI_WESTADOS'
                                 THEN NULLIF(rec->>'fecha_fijacion','')::timestamptz END;
        -- AUD7: a provenanced fijación is never a providencia fallback; the
        -- enforce_samai_estados_no_fijacion trigger still gates the value.
        IF v_fecha_providencia IS NULL AND v_fecha_fijacion IS NULL THEN
          v_fecha_providencia := NULLIF(rec->>'fecha_fijacion','')::timestamptz;
        END IF;
      ELSE
        v_fecha_fijacion := NULLIF(rec->>'fecha_fijacion','')::timestamptz;
      END IF;
      v_published_at := NULLIF(rec->>'published_at','')::timestamptz;
      v_structural_date := COALESCE((v_published_at AT TIME ZONE 'UTC')::date, DATE '1900-01-01');

      v_content_hash := encode(sha256(convert_to(
        COALESCE(rec->>'fecha_fijacion', '') || '|' ||
        COALESCE(rec->>'fecha_providencia', '') || '|' ||
        COALESCE(rec->>'title', '') || '|' ||
        COALESCE(rec->>'tipo_publicacion', '') || '|' ||
        COALESCE(rec->>'pdf_url', '') || '|' ||
        COALESCE(rec->>'annotation', ''), 'UTF8')), 'hex');

      v_sources := safe_jsonb_to_text_array(rec->'sources');
      IF array_length(v_sources, 1) IS NULL AND rec->>'source' IS NOT NULL THEN
        v_sources := ARRAY[rec->>'source'];
      END IF;

      SELECT id, content_hash, pdf_url, fecha_fijacion, fecha_providencia, source, sources
      INTO v_existing
      FROM work_item_publicaciones
      WHERE work_item_id = (rec->>'work_item_id')::uuid
        AND hash_fingerprint = rec->>'hash_fingerprint';

      IF v_existing.id IS NULL THEN
        SELECT id, content_hash, pdf_url, fecha_fijacion, fecha_providencia, source, sources
        INTO v_existing
        FROM work_item_publicaciones
        WHERE work_item_id = (rec->>'work_item_id')::uuid
          AND is_archived = false
          AND canon_normalize_title(canon_strip_title_noise(title)) = canon_normalize_title(canon_strip_title_noise(rec->>'title'))
          AND COALESCE((published_at AT TIME ZONE 'UTC')::date, DATE '1900-01-01') = v_structural_date
          AND canon_normalize_title(COALESCE(tipo_publicacion, '')) = canon_normalize_title(COALESCE(rec->>'tipo_publicacion', ''))
          AND COALESCE(recurso_consecutivo,'00') = COALESCE(NULLIF(rec->>'recurso_consecutivo',''),'00')
        LIMIT 1;
        v_structural_hit := v_existing.id IS NOT NULL;
      END IF;

      IF v_existing.id IS NULL THEN
        INSERT INTO work_item_publicaciones (
          work_item_id, organization_id, source, title, annotation,
          pdf_url, entry_url, pdf_available, published_at, fecha_fijacion,
          fecha_providencia, tipo_publicacion, hash_fingerprint, raw_data, date_source,
          date_confidence, raw_schema_version, sources, detected_at, last_seen_at, content_hash, source_radicado, recurso_consecutivo, instancia_grado
        ) VALUES (
          (rec->>'work_item_id')::uuid, (rec->>'organization_id')::uuid,
          rec->>'source', rec->>'title', rec->>'annotation', rec->>'pdf_url', rec->>'entry_url',
          COALESCE((rec->>'pdf_available')::boolean, false), v_published_at, v_fecha_fijacion,
          v_fecha_providencia, rec->>'tipo_publicacion', rec->>'hash_fingerprint', rec->'raw_data',
          rec->>'date_source', rec->>'date_confidence', rec->>'raw_schema_version', v_sources,
          now(), now(), v_content_hash,
          NULLIF(rec->>'source_radicado',''),
          COALESCE(NULLIF(rec->>'recurso_consecutivo',''),'00'),
          COALESCE(NULLIF(rec->>'instancia_grado',''),'PRIMERA')
        );
        inserted_count := inserted_count + 1;
        outcomes := outcomes || jsonb_build_array(jsonb_build_object(
          'bucket','INSERTED','title',rec->>'title','fingerprint',rec->>'hash_fingerprint'));
      ELSE
        UPDATE work_item_publicaciones SET
          pdf_url = COALESCE(pdf_url, rec->>'pdf_url'),
          entry_url = COALESCE(entry_url, rec->>'entry_url'),
          annotation = COALESCE(annotation, rec->>'annotation'),
          fecha_fijacion = COALESCE(fecha_fijacion, v_fecha_fijacion),
          fecha_providencia = COALESCE(fecha_providencia, v_fecha_providencia),
          raw_data = CASE WHEN work_item_publicaciones.source = 'samai_estados' AND rec->>'source' = 'samai_estados' THEN public.samai_publication_merge_evidence(work_item_publicaciones.raw_data, rec->'raw_data') ELSE COALESCE(rec->'raw_data', raw_data) END,
          sources = (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(
            COALESCE(work_item_publicaciones.sources, ARRAY[]::text[]) || v_sources) AS s),
          last_seen_at = now(), updated_at = now()
        WHERE id = v_existing.id;

        v_enriched := (v_existing.pdf_url IS NULL AND NULLIF(rec->>'pdf_url','') IS NOT NULL)
                   OR (v_existing.fecha_fijacion IS NULL AND v_fecha_fijacion IS NOT NULL)
                   OR (v_existing.fecha_providencia IS NULL AND v_fecha_providencia IS NOT NULL);

        IF COALESCE(v_existing.source,'') <> COALESCE(rec->>'source','')
           OR NOT (COALESCE(v_existing.sources, ARRAY[]::text[]) @> v_sources) THEN
          updated_count := updated_count + 1;
          v_reason := 'matched existing row from source ' || COALESCE(v_existing.source, 'unknown');
          outcomes := outcomes || jsonb_build_array(jsonb_build_object(
            'bucket','SKIPPED_CROSS_SOURCE','title',rec->>'title','fingerprint',rec->>'hash_fingerprint','reason',v_reason));
        ELSIF v_enriched THEN
          updated_count := updated_count + 1;
          outcomes := outcomes || jsonb_build_array(jsonb_build_object(
            'bucket','ENRICHED','title',rec->>'title','fingerprint',rec->>'hash_fingerprint',
            'reason','existing row completed with newly available fields'));
        ELSE
          skipped_count := skipped_count + 1;
          IF v_structural_hit THEN
            structural_count := structural_count + 1;
          END IF;
          outcomes := outcomes || jsonb_build_array(jsonb_build_object(
            'bucket', CASE WHEN v_structural_hit THEN 'SKIPPED_DUPLICATE_STRUCTURAL' ELSE 'SKIPPED_DUPLICATE' END,
            'title',rec->>'title','fingerprint',rec->>'hash_fingerprint',
            'reason','fingerprint or structural key already present'));
        END IF;
      END IF;

    EXCEPTION
      WHEN unique_violation THEN
        -- The row exists: a concurrent writer won the race. Not a loss.
        unique_violation_count := unique_violation_count + 1;
        skipped_count := skipped_count + 1;
        structural_count := structural_count + 1;
        outcomes := outcomes || jsonb_build_array(jsonb_build_object(
          'bucket','SKIPPED_DUPLICATE_STRUCTURAL','title',rec->>'title',
          'fingerprint',rec->>'hash_fingerprint','reason','unique_violation: ' || SQLERRM,
          'sqlstate',SQLSTATE));
      WHEN raise_exception THEN
        -- Explicit guard trigger rejection.
        rejected_count := rejected_count + 1;
        errors := errors || SQLERRM;
        outcomes := outcomes || jsonb_build_array(jsonb_build_object(
          'bucket','REJECTED_TRIGGER','title',rec->>'title','fingerprint',rec->>'hash_fingerprint',
          'reason',SQLERRM,'sqlstate',SQLSTATE));
      WHEN OTHERS THEN
        error_count := error_count + 1;
        errors := errors || SQLERRM;
        outcomes := outcomes || jsonb_build_array(jsonb_build_object(
          'bucket','ERROR','title',rec->>'title','fingerprint',rec->>'hash_fingerprint',
          'reason',SQLERRM,'sqlstate',SQLSTATE));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'parsed_count', parsed_count,
    'inserted_count', inserted_count,
    'updated_count', updated_count,
    'skipped_count', skipped_count,
    'structural_count', structural_count,
    'rejected_count', rejected_count,
    'error_count', error_count,
    'unique_violation_count', unique_violation_count,
    'changed_count', changed_count,
    'errors', to_jsonb(errors),
    'outcomes', outcomes
  );
END;
$function$

