-- Extend rpc_upsert_work_item_acts: enrich existing rows with fill-only-missing semantics.
-- Ratified by the Doctor 2026-07-15 to let CPACA→CPNU fallback (and future re-syncs)
-- absorb rich metadata (despacho, fecha_inicia_termino, fecha_registro) into rows that
-- were originally persisted shallow. Rules:
--   • raw_data = excluded.raw_data || work_item_acts.raw_data  (existing wins per-key)
--   • fecha_registro_source, inicia_termino: COALESCE(existing, incoming)  (fill-only)
--   • content_hash formula unchanged → alerts NOT triggered by raw_data merge
--   • trg_compute_deadline_on_act (AFTER UPDATE OF raw_data) fires on enrichment →
--     terms with FECHA_FIJACION anchor can naturally promote to DESPACHO when
--     the merge brings in fechaInicial/fecha_inicia_termino.
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
  enriched_count int := 0;
  errors text[] := '{}';
  v_content_hash text;
  v_existing record;
  v_sources text[];
  v_records jsonb;
  v_existing_sources text[];
  v_incoming_raw jsonb;
  v_incoming_fecha_registro date;
  v_incoming_inicia_termino date;
BEGIN
  IF jsonb_typeof(records) = 'string' THEN
    BEGIN
      v_records := (records #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'inserted_count', 0, 'updated_count', 0, 'skipped_count', 0,
        'changed_count', 0, 'enriched_count', 0,
        'errors', jsonb_build_array('records parameter is a non-parseable string: ' || SQLERRM)
      );
    END;
  ELSIF jsonb_typeof(records) = 'object' THEN
    v_records := jsonb_build_array(records);
  ELSIF jsonb_typeof(records) = 'array' THEN
    v_records := records;
  ELSE
    RETURN jsonb_build_object(
      'inserted_count', 0, 'updated_count', 0, 'skipped_count', 0,
      'changed_count', 0, 'enriched_count', 0,
      'errors', jsonb_build_array('records parameter has unexpected type: ' || jsonb_typeof(records))
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

      v_sources := safe_jsonb_to_text_array(rec->'sources');
      IF array_length(v_sources, 1) IS NULL AND rec->>'source' IS NOT NULL THEN
        v_sources := ARRAY[rec->>'source'];
      END IF;

      v_incoming_raw           := COALESCE(rec->'raw_data', '{}'::jsonb);
      v_incoming_fecha_registro := NULLIF(rec->>'fecha_registro_source', '')::date;
      v_incoming_inicia_termino := NULLIF(rec->>'inicia_termino', '')::date;

      SELECT id, content_hash, sources, raw_data, fecha_registro_source, inicia_termino
        INTO v_existing
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
          fecha_registro_source, inicia_termino,
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
          v_incoming_raw,
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
          v_incoming_fecha_registro,
          v_incoming_inicia_termino,
          now(), now(), v_content_hash
        );
        inserted_count := inserted_count + 1;

      ELSE
        v_existing_sources := COALESCE(v_existing.sources, ARRAY[]::text[]);

        IF v_existing.content_hash IS DISTINCT FROM v_content_hash AND COALESCE(v_existing.content_hash, '') <> '' THEN
          -- Content changed: full update (raw_data replaced but merged with existing keys as tiebreaker for missing).
          -- Fill-only semantics still apply to the dedicated metadata columns.
          UPDATE work_item_acts SET
            description = COALESCE(rec->>'description', description),
            act_type = COALESCE(rec->>'act_type', act_type),
            raw_data = v_incoming_raw || COALESCE(work_item_acts.raw_data, '{}'::jsonb),
            event_summary = COALESCE(rec->>'event_summary', event_summary),
            content_hash = v_content_hash,
            changed_at = now(),
            last_seen_at = now(),
            scrape_date = COALESCE((rec->>'scrape_date')::timestamptz, scrape_date),
            fecha_registro_source = COALESCE(work_item_acts.fecha_registro_source, v_incoming_fecha_registro),
            inicia_termino        = COALESCE(work_item_acts.inicia_termino,        v_incoming_inicia_termino),
            sources = (
              SELECT array_agg(DISTINCT s ORDER BY s)
              FROM unnest(v_existing_sources || v_sources) AS s
            ),
            updated_at = now()
          WHERE id = v_existing.id;
          changed_count := changed_count + 1;
          updated_count := updated_count + 1;

        ELSE
          -- Content unchanged: merge sources AND enrich (fill-only) raw_data / dedicated cols.
          -- raw_data merge with `existing` on the RIGHT so existing keys always win.
          -- This is what promotes shallow rows to full metadata on the next sync.
          UPDATE work_item_acts SET
            last_seen_at = now(),
            scrape_date  = COALESCE((rec->>'scrape_date')::timestamptz, scrape_date),
            raw_data     = v_incoming_raw || COALESCE(work_item_acts.raw_data, '{}'::jsonb),
            fecha_registro_source = COALESCE(work_item_acts.fecha_registro_source, v_incoming_fecha_registro),
            inicia_termino        = COALESCE(work_item_acts.inicia_termino,        v_incoming_inicia_termino),
            sources = (
              SELECT array_agg(DISTINCT s ORDER BY s)
              FROM unnest(v_existing_sources || v_sources) AS s
            ),
            updated_at = now()
          WHERE id = v_existing.id;

          IF COALESCE(v_existing.content_hash, '') = '' THEN
            UPDATE work_item_acts SET content_hash = v_content_hash
              WHERE id = v_existing.id AND COALESCE(content_hash, '') = '';
          END IF;

          -- Trace: did we actually enrich (add keys / fill NULL cols)?
          IF (v_incoming_raw <> '{}'::jsonb AND (v_incoming_raw - COALESCE(v_existing.raw_data, '{}'::jsonb)::text[]) <> '{}'::jsonb)
             OR (v_existing.fecha_registro_source IS NULL AND v_incoming_fecha_registro IS NOT NULL)
             OR (v_existing.inicia_termino        IS NULL AND v_incoming_inicia_termino IS NOT NULL) THEN
            enriched_count := enriched_count + 1;
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
    'updated_count',  updated_count,
    'skipped_count',  skipped_count,
    'changed_count',  changed_count,
    'enriched_count', enriched_count,
    'errors', to_jsonb(errors)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_upsert_work_item_acts(jsonb) TO service_role;