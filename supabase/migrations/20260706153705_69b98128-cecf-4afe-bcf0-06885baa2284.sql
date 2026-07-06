CREATE OR REPLACE FUNCTION public.rpc_upsert_work_item_publicaciones(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rec jsonb;
  inserted_count int := 0;
  skipped_count int := 0;
  updated_count int := 0;
  changed_count int := 0;
  errors text[] := '{}';
  v_content_hash text;
  v_existing record;
  v_sources text[];
  v_records jsonb;
  v_is_samai boolean;
  v_fecha_fijacion timestamptz;
  v_fecha_providencia timestamptz;
BEGIN
  IF jsonb_typeof(records) = 'string' THEN
    BEGIN
      v_records := (records #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'inserted_count', 0, 'updated_count', 0, 'skipped_count', 0,
        'changed_count', 0, 'errors', jsonb_build_array('records parameter is a non-parseable string: ' || SQLERRM)
      );
    END;
  ELSIF jsonb_typeof(records) = 'object' THEN
    v_records := jsonb_build_array(records);
  ELSIF jsonb_typeof(records) = 'array' THEN
    v_records := records;
  ELSE
    RETURN jsonb_build_object(
      'inserted_count', 0, 'updated_count', 0, 'skipped_count', 0,
      'changed_count', 0, 'errors', jsonb_build_array('records parameter has unexpected type: ' || jsonb_typeof(records))
    );
  END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(v_records)
  LOOP
    BEGIN
      v_is_samai := (rec->>'source') = 'samai_estados';

      -- Date semantics:
      --   * Publicaciones → fecha_fijacion = fecha real de fijación en estado.
      --   * SAMAI         → fecha_providencia = fecha del auto; fecha_fijacion queda NULL
      --                     hasta que llegue Publicaciones y complete el enriquecimiento.
      v_fecha_providencia := NULLIF(rec->>'fecha_providencia','')::timestamptz;
      IF v_is_samai THEN
        v_fecha_fijacion := NULL;
        IF v_fecha_providencia IS NULL THEN
          v_fecha_providencia := NULLIF(rec->>'fecha_fijacion','')::timestamptz;
        END IF;
      ELSE
        v_fecha_fijacion := NULLIF(rec->>'fecha_fijacion','')::timestamptz;
      END IF;

      v_content_hash := encode(
        sha256(
          convert_to(
            COALESCE(rec->>'fecha_fijacion', '') || '|' ||
            COALESCE(rec->>'fecha_providencia', '') || '|' ||
            COALESCE(rec->>'title', '') || '|' ||
            COALESCE(rec->>'tipo_publicacion', '') || '|' ||
            COALESCE(rec->>'pdf_url', '') || '|' ||
            COALESCE(rec->>'annotation', ''),
            'UTF8'
          )
        ),
        'hex'
      );

      v_sources := safe_jsonb_to_text_array(rec->'sources');
      IF array_length(v_sources, 1) IS NULL AND rec->>'source' IS NOT NULL THEN
        v_sources := ARRAY[rec->>'source'];
      END IF;

      SELECT id, content_hash, pdf_url, fecha_fijacion, fecha_providencia
        INTO v_existing
        FROM work_item_publicaciones
        WHERE work_item_id = (rec->>'work_item_id')::uuid
          AND hash_fingerprint = rec->>'hash_fingerprint';

      IF v_existing.id IS NULL THEN
        INSERT INTO work_item_publicaciones (
          work_item_id, organization_id, source, title, annotation,
          pdf_url, entry_url, pdf_available, published_at, fecha_fijacion,
          fecha_providencia,
          tipo_publicacion, hash_fingerprint, raw_data, date_source,
          date_confidence, raw_schema_version, sources,
          detected_at, last_seen_at, content_hash
        ) VALUES (
          (rec->>'work_item_id')::uuid,
          (rec->>'organization_id')::uuid,
          rec->>'source',
          rec->>'title',
          rec->>'annotation',
          rec->>'pdf_url',
          rec->>'entry_url',
          COALESCE((rec->>'pdf_available')::boolean, false),
          NULLIF(rec->>'published_at','')::timestamptz,
          v_fecha_fijacion,
          v_fecha_providencia,
          rec->>'tipo_publicacion',
          rec->>'hash_fingerprint',
          rec->'raw_data',
          rec->>'date_source',
          rec->>'date_confidence',
          rec->>'raw_schema_version',
          v_sources,
          now(), now(), v_content_hash
        );
        inserted_count := inserted_count + 1;

      ELSE
        -- Cross-source enrichment: complete missing pdf_url, fecha_fijacion, fecha_providencia
        -- without touching immutable fields (title/hash blocked by trigger).
        UPDATE work_item_publicaciones SET
          pdf_url = COALESCE(pdf_url, rec->>'pdf_url'),
          entry_url = COALESCE(entry_url, rec->>'entry_url'),
          annotation = COALESCE(annotation, rec->>'annotation'),
          fecha_fijacion = COALESCE(fecha_fijacion, v_fecha_fijacion),
          fecha_providencia = COALESCE(fecha_providencia, v_fecha_providencia),
          raw_data = COALESCE(rec->'raw_data', raw_data),
          sources = (
            SELECT array_agg(DISTINCT s ORDER BY s)
            FROM unnest(
              COALESCE(work_item_publicaciones.sources, ARRAY[]::text[]) || v_sources
            ) AS s
          ),
          last_seen_at = now(),
          changed_at = CASE
            WHEN v_existing.content_hash IS DISTINCT FROM v_content_hash AND v_existing.content_hash <> ''
            THEN now() ELSE changed_at END,
          content_hash = CASE
            WHEN v_existing.content_hash = '' OR v_existing.content_hash IS NULL THEN v_content_hash
            ELSE content_hash END,
          updated_at = now()
        WHERE id = v_existing.id;

        IF v_existing.content_hash IS DISTINCT FROM v_content_hash AND v_existing.content_hash <> '' THEN
          changed_count := changed_count + 1;
          updated_count := updated_count + 1;
        ELSE
          skipped_count := skipped_count + 1;
        END IF;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      errors := errors || SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted_count', inserted_count,
    'updated_count', updated_count,
    'skipped_count', skipped_count,
    'changed_count', changed_count,
    'errors', to_jsonb(errors)
  );
END;
$function$;