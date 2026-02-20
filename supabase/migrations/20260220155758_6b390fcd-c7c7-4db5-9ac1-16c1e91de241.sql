
-- ============================================================
-- Phase 3.12b: Update RPCs to compute content_hash and detect changes
-- ============================================================

-- A) Updated RPC for actuaciones: content_hash computation + change detection
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
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(records)
  LOOP
    BEGIN
      -- Compute content_hash from canonical mutable fields
      v_content_hash := encode(
        sha256(
          convert_to(
            COALESCE(rec->>'act_date', '') || '|' ||
            COALESCE(rec->>'description', '') || '|' ||
            COALESCE(rec->>'event_summary', '') || '|' ||
            COALESCE(rec->>'despacho', ''),
            'UTF8'
          )
        ),
        'hex'
      );

      -- Check if record exists
      SELECT id, content_hash INTO v_existing
        FROM work_item_acts
        WHERE work_item_id = (rec->>'work_item_id')::uuid
          AND hash_fingerprint = rec->>'hash_fingerprint';

      IF v_existing.id IS NULL THEN
        -- INSERT new record
        INSERT INTO work_item_acts (
          owner_id, organization_id, work_item_id, workflow_type,
          description, act_date, act_date_raw, event_date, event_summary,
          source, source_platform, sources, hash_fingerprint, scrape_date,
          despacho, date_source, date_confidence, raw_schema_version, raw_data,
          detected_at, last_seen_at, content_hash
        ) VALUES (
          (rec->>'owner_id')::uuid,
          (rec->>'organization_id')::uuid,
          (rec->>'work_item_id')::uuid,
          rec->>'workflow_type',
          rec->>'description',
          (rec->>'act_date')::date,
          rec->>'act_date_raw',
          (rec->>'event_date')::date,
          rec->>'event_summary',
          rec->>'source',
          rec->>'source_platform',
          ARRAY(SELECT jsonb_array_elements_text(rec->'sources')),
          rec->>'hash_fingerprint',
          (rec->>'scrape_date')::date,
          rec->>'despacho',
          rec->>'date_source',
          rec->>'date_confidence',
          rec->>'raw_schema_version',
          rec->'raw_data',
          now(), now(), v_content_hash
        );
        inserted_count := inserted_count + 1;

      ELSE
        -- Record exists: check if content changed
        IF v_existing.content_hash IS DISTINCT FROM v_content_hash AND v_existing.content_hash <> '' THEN
          -- Content CHANGED: update mutable fields + set changed_at
          UPDATE work_item_acts SET
            description = COALESCE(rec->>'description', description),
            event_summary = COALESCE(rec->>'event_summary', event_summary),
            despacho = COALESCE(rec->>'despacho', despacho),
            raw_data = COALESCE(rec->'raw_data', raw_data),
            content_hash = v_content_hash,
            changed_at = now(),
            last_seen_at = now(),
            sources = (
              SELECT array_agg(DISTINCT s ORDER BY s)
              FROM unnest(
                work_item_acts.sources || ARRAY(SELECT jsonb_array_elements_text(rec->'sources'))
              ) AS s
            ),
            scrape_date = COALESCE((rec->>'scrape_date')::date, scrape_date),
            updated_at = now()
          WHERE id = v_existing.id;
          changed_count := changed_count + 1;
          updated_count := updated_count + 1;

        ELSE
          -- Content unchanged: just update last_seen_at + merge sources
          UPDATE work_item_acts SET
            last_seen_at = now(),
            sources = (
              SELECT array_agg(DISTINCT s ORDER BY s)
              FROM unnest(
                work_item_acts.sources || ARRAY(SELECT jsonb_array_elements_text(rec->'sources'))
              ) AS s
            ),
            scrape_date = COALESCE((rec->>'scrape_date')::date, scrape_date),
            updated_at = now()
          WHERE id = v_existing.id
            AND NOT (
              work_item_acts.sources @> ARRAY(SELECT jsonb_array_elements_text(rec->'sources'))
            );
          
          -- Always update last_seen_at even if sources unchanged
          UPDATE work_item_acts SET last_seen_at = now() WHERE id = v_existing.id;
          
          IF v_existing.content_hash = '' THEN
            -- Backfill content_hash for existing rows that don't have it yet
            UPDATE work_item_acts SET content_hash = v_content_hash WHERE id = v_existing.id AND content_hash = '';
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

-- B) Updated RPC for publicaciones: content_hash computation + change detection
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
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(records)
  LOOP
    BEGIN
      -- Compute content_hash from canonical mutable fields
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

      -- Check if record exists
      SELECT id, content_hash INTO v_existing
        FROM work_item_publicaciones
        WHERE work_item_id = (rec->>'work_item_id')::uuid
          AND hash_fingerprint = rec->>'hash_fingerprint';

      IF v_existing.id IS NULL THEN
        -- INSERT new record
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
          COALESCE(ARRAY(SELECT jsonb_array_elements_text(rec->'sources')), ARRAY[rec->>'source']),
          now(), now(), v_content_hash
        );
        inserted_count := inserted_count + 1;

      ELSE
        IF v_existing.content_hash IS DISTINCT FROM v_content_hash AND v_existing.content_hash <> '' THEN
          -- Content CHANGED
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
                COALESCE(work_item_publicaciones.sources, ARRAY[]::text[]) || 
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(rec->'sources')), ARRAY[rec->>'source'])
              ) AS s
            ),
            updated_at = now()
          WHERE id = v_existing.id;
          changed_count := changed_count + 1;
          updated_count := updated_count + 1;

        ELSE
          -- Content unchanged: update last_seen_at + merge sources
          UPDATE work_item_publicaciones SET
            last_seen_at = now(),
            sources = (
              SELECT array_agg(DISTINCT s ORDER BY s)
              FROM unnest(
                COALESCE(work_item_publicaciones.sources, ARRAY[]::text[]) || 
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(rec->'sources')), ARRAY[rec->>'source'])
              ) AS s
            ),
            updated_at = now()
          WHERE id = v_existing.id
            AND NOT (
              COALESCE(work_item_publicaciones.sources, ARRAY[]::text[]) @> 
              COALESCE(ARRAY(SELECT jsonb_array_elements_text(rec->'sources')), ARRAY[rec->>'source'])
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

GRANT EXECUTE ON FUNCTION public.rpc_upsert_work_item_acts(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_work_item_publicaciones(jsonb) TO service_role;
