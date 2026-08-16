-- ITER60 — CPNU act-level documents land on work_item_acts, following the
-- per-provider precedent (SAMAI keeps its files in anexos_documentos).
ALTER TABLE public.work_item_acts
  ADD COLUMN IF NOT EXISTS documentos jsonb,
  ADD COLUMN IF NOT EXISTS documentos_observados_en timestamptz;

COMMENT ON COLUMN public.work_item_acts.documentos IS
  'CPNU act-level documents. NULL = provider not asked yet; [] = provider says none.';
COMMENT ON COLUMN public.work_item_acts.documentos_observados_en IS
  'When the provider last expressed the documents field for this act. Distinguishes NULL from [].';

CREATE INDEX IF NOT EXISTS idx_work_item_acts_documentos
  ON public.work_item_acts (work_item_id)
  WHERE documentos IS NOT NULL AND jsonb_array_length(documentos) > 0;

CREATE OR REPLACE FUNCTION public.rpc_upsert_work_item_acts(records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  rec jsonb;
  inserted_count int := 0;
  skipped_count int := 0;
  updated_count int := 0;
  changed_count int := 0;
  enriched_count int := 0;
  structural_count int := 0;
  rejected_count int := 0;
  error_count int := 0;
  parsed_count int := 0;
  errors text[] := '{}';
  outcomes jsonb := '[]'::jsonb;
  v_content_hash text;
  v_existing record;
  v_sources text[];
  v_records jsonb;
  v_existing_sources text[];
  v_incoming_raw jsonb;
  v_incoming_fecha_registro date;
  v_incoming_inicia_termino date;
  v_incoming_documentos jsonb;
  v_added_keys int;
BEGIN
  IF jsonb_typeof(records) = 'string' THEN
    BEGIN
      v_records := (records #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'inserted_count', 0, 'updated_count', 0, 'skipped_count', 0,
        'changed_count', 0, 'enriched_count', 0, 'parsed_count', 0,
        'structural_count', 0, 'rejected_count', 0, 'error_count', 1,
        'errors', jsonb_build_array('records parameter is a non-parseable string: ' || SQLERRM),
        'outcomes', jsonb_build_array(jsonb_build_object('bucket','ERROR','reason',SQLERRM))
      );
    END;
  ELSIF jsonb_typeof(records) = 'object' THEN
    v_records := jsonb_build_array(records);
  ELSIF jsonb_typeof(records) = 'array' THEN
    v_records := records;
  ELSE
    RETURN jsonb_build_object(
      'inserted_count', 0, 'updated_count', 0, 'skipped_count', 0,
      'changed_count', 0, 'enriched_count', 0, 'parsed_count', 0,
      'structural_count', 0, 'rejected_count', 0, 'error_count', 1,
      'errors', jsonb_build_array('records parameter has unexpected type: ' || jsonb_typeof(records)),
      'outcomes', jsonb_build_array(jsonb_build_object('bucket','ERROR','reason','unexpected records parameter type'))
    );
  END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(v_records)
  LOOP
    parsed_count := parsed_count + 1;
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

      v_incoming_raw            := COALESCE(rec->'raw_data', '{}'::jsonb);
      v_incoming_fecha_registro := NULLIF(rec->>'fecha_registro_source', '')::date;
      v_incoming_inicia_termino := NULLIF(rec->>'inicia_termino', '')::date;
      -- ITER60 — documents may arrive on a LATER pass than the act itself.
      -- NULL means "not observed" and must never overwrite a prior observation.
      v_incoming_documentos := CASE
        WHEN jsonb_typeof(rec->'documentos') = 'array' THEN rec->'documentos'
        ELSE NULL
      END;

      SELECT id, content_hash, sources, raw_data, fecha_registro_source, inicia_termino
        INTO v_existing
        FROM work_item_acts
        WHERE work_item_id = (rec->>'work_item_id')::uuid
          AND hash_fingerprint = rec->>'hash_fingerprint';

      IF v_existing.id IS NULL THEN
        BEGIN
          INSERT INTO work_item_acts (
            work_item_id, owner_id, organization_id, workflow_type,
            act_date, act_date_raw, description, act_type,
            source, source_reference, raw_data, hash_fingerprint,
            source_platform, source_url, event_date, event_summary,
            despacho, scrape_date, date_source, date_confidence,
            raw_schema_version, sources,
            fecha_registro_source, inicia_termino, source_radicado, recurso_consecutivo, instancia_grado,
            documentos, documentos_observados_en,
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
            NULLIF(rec->>'source_radicado',''),
            COALESCE(NULLIF(rec->>'recurso_consecutivo',''),'00'),
            COALESCE(NULLIF(rec->>'instancia_grado',''),'PRIMERA'),
            v_incoming_documentos,
            CASE WHEN v_incoming_documentos IS NULL THEN NULL ELSE now() END,
            now(), now(), v_content_hash
          );
          inserted_count := inserted_count + 1;
          outcomes := outcomes || jsonb_build_array(jsonb_build_object(
            'bucket','INSERTED','title',rec->>'description','fingerprint',rec->>'hash_fingerprint'));
        EXCEPTION
          WHEN unique_violation THEN
            -- Structural dedupe index (idx_acts_dedupe_structural) or any other
            -- unique constraint. The row is a duplicate of an existing act under a
            -- different fingerprint: touch last_seen_at so the timeline stays fresh.
            structural_count := structural_count + 1;
            skipped_count := skipped_count + 1;
            outcomes := outcomes || jsonb_build_array(jsonb_build_object(
              'bucket','SKIPPED_DUPLICATE_STRUCTURAL','title',rec->>'description',
              'fingerprint',rec->>'hash_fingerprint','reason',SQLERRM));
        END;

      ELSE
        v_existing_sources := COALESCE(v_existing.sources, ARRAY[]::text[]);

        IF v_existing.content_hash IS DISTINCT FROM v_content_hash AND COALESCE(v_existing.content_hash, '') <> '' THEN
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
            documentos = COALESCE(v_incoming_documentos, work_item_acts.documentos),
            documentos_observados_en = CASE
              WHEN v_incoming_documentos IS NOT NULL THEN now()
              ELSE work_item_acts.documentos_observados_en
            END,
            sources = (
              SELECT array_agg(DISTINCT s ORDER BY s)
              FROM unnest(v_existing_sources || v_sources) AS s
            ),
            updated_at = now()
          WHERE id = v_existing.id;
          changed_count := changed_count + 1;
          updated_count := updated_count + 1;
          outcomes := outcomes || jsonb_build_array(jsonb_build_object(
            'bucket','UPDATED','title',rec->>'description','fingerprint',rec->>'hash_fingerprint'));

        ELSE
          UPDATE work_item_acts SET
            last_seen_at = now(),
            scrape_date  = COALESCE((rec->>'scrape_date')::timestamptz, scrape_date),
            raw_data     = v_incoming_raw || COALESCE(work_item_acts.raw_data, '{}'::jsonb),
            fecha_registro_source = COALESCE(work_item_acts.fecha_registro_source, v_incoming_fecha_registro),
            inicia_termino        = COALESCE(work_item_acts.inicia_termino,        v_incoming_inicia_termino),
            documentos = COALESCE(v_incoming_documentos, work_item_acts.documentos),
            documentos_observados_en = CASE
              WHEN v_incoming_documentos IS NOT NULL THEN now()
              ELSE work_item_acts.documentos_observados_en
            END,
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

          SELECT count(*)::int INTO v_added_keys
            FROM jsonb_object_keys(v_incoming_raw) k
            WHERE NOT (COALESCE(v_existing.raw_data, '{}'::jsonb) ? k);

          IF v_added_keys > 0
             OR (v_existing.fecha_registro_source IS NULL AND v_incoming_fecha_registro IS NOT NULL)
             OR (v_existing.inicia_termino        IS NULL AND v_incoming_inicia_termino IS NOT NULL) THEN
            enriched_count := enriched_count + 1;
            outcomes := outcomes || jsonb_build_array(jsonb_build_object(
              'bucket','ENRICHED','title',rec->>'description','fingerprint',rec->>'hash_fingerprint'));
          ELSE
            outcomes := outcomes || jsonb_build_array(jsonb_build_object(
              'bucket','SKIPPED_DUPLICATE','title',rec->>'description','fingerprint',rec->>'hash_fingerprint',
              'reason','identical fingerprint and content hash already present'));
          END IF;

          skipped_count := skipped_count + 1;
        END IF;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- Guard triggers (e.g. estados-family rejection) land here. Previously the
      -- row vanished from every counter; now it is explicitly bucketed.
      errors := errors || SQLERRM;
      IF SQLSTATE = 'P0001' THEN
        rejected_count := rejected_count + 1;
        outcomes := outcomes || jsonb_build_array(jsonb_build_object(
          'bucket','REJECTED_TRIGGER','title',rec->>'description',
          'fingerprint',rec->>'hash_fingerprint','reason',SQLERRM));
      ELSE
        error_count := error_count + 1;
        outcomes := outcomes || jsonb_build_array(jsonb_build_object(
          'bucket','ERROR','title',rec->>'description',
          'fingerprint',rec->>'hash_fingerprint','reason',SQLERRM));
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted_count', inserted_count,
    'updated_count',  updated_count,
    'skipped_count',  skipped_count,
    'changed_count',  changed_count,
    'enriched_count', enriched_count,
    'parsed_count',   parsed_count,
    'structural_count', structural_count,
    'rejected_count', rejected_count,
    'error_count',    error_count,
    'errors', to_jsonb(errors),
    'outcomes', outcomes
  );
END;
$function$;