-- Fix: rpc_upsert_work_item_publicaciones - handle records passed as jsonb string (scalar)
-- The "cannot extract elements from a scalar" error occurs when PostgREST receives
-- JSON.stringify([...]) and casts it as a jsonb string literal instead of a jsonb array.
-- Solution: detect and unwrap the string before iterating.

CREATE OR REPLACE FUNCTION public.rpc_upsert_work_item_publicaciones(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  -- ═══ DEFENSIVE: Handle records passed as a JSON string (double-encoded) ═══
  -- If PostgREST receives the parameter as a jsonb string instead of array,
  -- we need to parse it. E.g. '"[{...}]"' → '[{...}]'
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
    -- Single object passed instead of array — wrap it
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
      v_content_hash := encode(
        sha256(
          convert_to(
            COALESCE(rec->>'fecha_fijacion', '') || '|' ||
            COALESCE(rec->>'title', '') || '|' ||
            COALESCE(rec->>'tipo_publicacion', '') || '|' ||
            COALESCE(rec->>'pdf_url', '') || '|' ||
            COALESCE(rec->>'annotation', ''),
            'UTF8'
          )
        ),
        'hex'
      );

      -- Safely extract sources array
      v_sources := safe_jsonb_to_text_array(rec->'sources');
      -- Fallback to source field if sources is empty
      IF array_length(v_sources, 1) IS NULL AND rec->>'source' IS NOT NULL THEN
        v_sources := ARRAY[rec->>'source'];
      END IF;

      SELECT id, content_hash INTO v_existing
        FROM work_item_publicaciones
        WHERE work_item_id = (rec->>'work_item_id')::uuid
          AND hash_fingerprint = rec->>'hash_fingerprint';

      IF v_existing.id IS NULL THEN
        INSERT INTO work_item_publicaciones (
          work_item_id, organization_id, source, title, annotation,
          pdf_url, entry_url, pdf_available, published_at, fecha_fijacion,
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
          (rec->>'published_at')::timestamptz,
          (rec->>'fecha_fijacion')::timestamptz,
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
        IF v_existing.content_hash IS DISTINCT FROM v_content_hash AND v_existing.content_hash <> '' THEN
          UPDATE work_item_publicaciones SET
            title = COALESCE(rec->>'title', title),
            annotation = COALESCE(rec->>'annotation', annotation),
            pdf_url = COALESCE(rec->>'pdf_url', pdf_url),
            entry_url = COALESCE(rec->>'entry_url', entry_url),
            raw_data = COALESCE(rec->'raw_data', raw_data),
            content_hash = v_content_hash,
            changed_at = now(),
            last_seen_at = now(),
            sources = (
              SELECT array_agg(DISTINCT s ORDER BY s)
              FROM unnest(
                COALESCE(work_item_publicaciones.sources, ARRAY[]::text[]) || v_sources
              ) AS s
            ),
            updated_at = now()
          WHERE id = v_existing.id;
          changed_count := changed_count + 1;
          updated_count := updated_count + 1;

        ELSE
          UPDATE work_item_publicaciones SET
            last_seen_at = now(),
            sources = (
              SELECT array_agg(DISTINCT s ORDER BY s)
              FROM unnest(
                COALESCE(work_item_publicaciones.sources, ARRAY[]::text[]) || v_sources
              ) AS s
            ),
            updated_at = now()
          WHERE id = v_existing.id
            AND NOT (
              COALESCE(work_item_publicaciones.sources, ARRAY[]::text[]) @> v_sources
            );
          
          UPDATE work_item_publicaciones SET last_seen_at = now() WHERE id = v_existing.id;
          
          IF v_existing.content_hash = '' THEN
            UPDATE work_item_publicaciones SET content_hash = v_content_hash WHERE id = v_existing.id AND content_hash = '';
          END IF;
          
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
$$;

-- Apply the same defensive fix to rpc_upsert_work_item_acts
-- to prevent the same class of bug from appearing there
CREATE OR REPLACE FUNCTION public.rpc_upsert_work_item_acts(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_existing_sources text[];
BEGIN
  -- ═══ DEFENSIVE: Handle records passed as a JSON string (double-encoded) ═══
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
      v_content_hash := encode(
        sha256(
          convert_to(
            COALESCE(rec->>'act_date', '') || '|' ||
            COALESCE(rec->>'description', '') || '|' ||
            COALESCE(rec->>'act_type', '') || '|' ||
            COALESCE(rec->>'event_summary', ''),
            'UTF8'
          )
        ),
        'hex'
      );

      -- Safely extract sources array
      v_sources := safe_jsonb_to_text_array(rec->'sources');
      IF array_length(v_sources, 1) IS NULL AND rec->>'source' IS NOT NULL THEN
        v_sources := ARRAY[rec->>'source'];
      END IF;

      SELECT id, content_hash, sources INTO v_existing
        FROM work_item_acts
        WHERE work_item_id = (rec->>'work_item_id')::uuid
          AND hash_fingerprint = rec->>'hash_fingerprint';

      IF v_existing.id IS NULL THEN
        INSERT INTO work_item_acts (
          work_item_id, owner_id, organization_id, workflow_type,
          act_date, act_date_raw, description, act_type,
          source, source_reference, raw_data, hash_fingerprint,
          source_platform, source_url, event_date, event_summary,
          despacho, scrape_date, date_source, date_confidence,
          raw_schema_version, sources,
          detected_at, last_seen_at, content_hash
        ) VALUES (
          (rec->>'work_item_id')::uuid,
          (rec->>'owner_id')::uuid,
          (rec->>'organization_id')::uuid,
          rec->>'workflow_type',
          (rec->>'act_date')::date,
          rec->>'act_date_raw',
          rec->>'description',
          rec->>'act_type',
          rec->>'source',
          rec->>'source_reference',
          rec->'raw_data',
          rec->>'hash_fingerprint',
          rec->>'source_platform',
          rec->>'source_url',
          (rec->>'event_date')::date,
          rec->>'event_summary',
          rec->>'despacho',
          (rec->>'scrape_date')::timestamptz,
          rec->>'date_source',
          rec->>'date_confidence',
          rec->>'raw_schema_version',
          v_sources,
          now(), now(), v_content_hash
        );
        inserted_count := inserted_count + 1;

      ELSE
        v_existing_sources := COALESCE(v_existing.sources, ARRAY[]::text[]);
        
        IF v_existing.content_hash IS DISTINCT FROM v_content_hash AND COALESCE(v_existing.content_hash, '') <> '' THEN
          UPDATE work_item_acts SET
            description = COALESCE(rec->>'description', description),
            act_type = COALESCE(rec->>'act_type', act_type),
            raw_data = COALESCE(rec->'raw_data', raw_data),
            event_summary = COALESCE(rec->>'event_summary', event_summary),
            content_hash = v_content_hash,
            changed_at = now(),
            last_seen_at = now(),
            scrape_date = COALESCE((rec->>'scrape_date')::timestamptz, scrape_date),
            sources = (
              SELECT array_agg(DISTINCT s ORDER BY s)
              FROM unnest(v_existing_sources || v_sources) AS s
            ),
            updated_at = now()
          WHERE id = v_existing.id;
          changed_count := changed_count + 1;
          updated_count := updated_count + 1;

        ELSE
          -- Just merge sources and update last_seen_at
          UPDATE work_item_acts SET
            last_seen_at = now(),
            scrape_date = COALESCE((rec->>'scrape_date')::timestamptz, scrape_date),
            sources = (
              SELECT array_agg(DISTINCT s ORDER BY s)
              FROM unnest(v_existing_sources || v_sources) AS s
            ),
            updated_at = now()
          WHERE id = v_existing.id
            AND NOT (v_existing_sources @> v_sources);
          
          UPDATE work_item_acts SET last_seen_at = now() WHERE id = v_existing.id;
          
          IF COALESCE(v_existing.content_hash, '') = '' THEN
            UPDATE work_item_acts SET content_hash = v_content_hash WHERE id = v_existing.id AND COALESCE(content_hash, '') = '';
          END IF;
          
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
$$;

-- Ensure grants remain
GRANT EXECUTE ON FUNCTION public.rpc_upsert_work_item_acts(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_work_item_publicaciones(jsonb) TO service_role;