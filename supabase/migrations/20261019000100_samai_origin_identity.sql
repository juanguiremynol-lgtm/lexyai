-- Preventive only. No historical row is rewritten and fingerprints stay fixed.
-- A schema change is required before distinct requests can coexist.

CREATE OR REPLACE FUNCTION public.act_origin_components(description text, raw_data jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'solicitud', COALESCE((regexp_match(description, 'solicitud\s+No\.?\s*(\d{4,})', 'i'))[1], NULLIF(raw_data->>'origen_solicitud','')),
    'radicada_en', COALESCE((regexp_match(description, 'de\s+fecha:\s*(\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}(:\d{2})?)', 'i'))[1], NULLIF(raw_data->>'origen_radicada_en','')),
    'indice', regexp_replace(COALESCE(NULLIF(raw_data->>'origen_indice',''), NULLIF(raw_data->>'indice','')), '^0+(?=\d)', '')
  ));
$$;

CREATE OR REPLACE FUNCTION public.act_origin_relation(a jsonb,b jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM unnest(ARRAY['solicitud','radicada_en','indice']) k WHERE a->>k IS NOT NULL AND b->>k IS NOT NULL AND a->>k <> b->>k) THEN 'conflict'
    WHEN EXISTS (SELECT 1 FROM unnest(ARRAY['solicitud','radicada_en','indice']) k WHERE a->>k IS NOT NULL AND b->>k IS NOT NULL AND a->>k = b->>k) THEN 'equivalent'
    ELSE 'indeterminate' END;
$$;

CREATE OR REPLACE FUNCTION public.act_structural_origin(source text,description text,raw_data jsonb,fingerprint text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
  SELECT CASE WHEN lower(COALESCE(source,'')) LIKE 'samai%' THEN
    COALESCE('solicitud:'||(o->>'solicitud'), 'radicada:'||(o->>'radicada_en'), 'indice:'||(o->>'indice'), 'unconfirmed:'||COALESCE(fingerprint,description,''))
    ELSE '' END
  FROM (SELECT public.act_origin_components(description,raw_data) o) origins;
$$;

CREATE OR REPLACE FUNCTION public.act_merge_documentos(existing jsonb,incoming jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE result jsonb := CASE WHEN jsonb_typeof(existing)='array' THEN existing ELSE '[]'::jsonb END;
  doc jsonb; prior jsonb; pos int; field text; value jsonb; merged jsonb; urls jsonb;
BEGIN
  IF jsonb_typeof(incoming) IS DISTINCT FROM 'array' THEN RETURN existing; END IF;
  FOR doc IN SELECT * FROM jsonb_array_elements(incoming) LOOP
    IF jsonb_typeof(doc) <> 'object' THEN CONTINUE; END IF;
    pos := NULL;
    SELECT ord::int-1, d INTO pos,prior FROM jsonb_array_elements(result) WITH ORDINALITY e(d,ord)
    WHERE NOT (NULLIF(d->>'sha256','') IS NOT NULL AND NULLIF(doc->>'sha256','') IS NOT NULL AND d->>'sha256' <> doc->>'sha256')
      AND NOT (NULLIF(d->>'id','') IS NOT NULL AND NULLIF(doc->>'id','') IS NOT NULL AND d->>'id' <> doc->>'id')
      AND (d=doc OR (NULLIF(d->>'id','') IS NOT NULL AND d->>'id'=doc->>'id')
        OR EXISTS (SELECT 1 FROM unnest(ARRAY['url','gcs_url','url_origen']) k1, unnest(ARRAY['url','gcs_url','url_origen']) k2 WHERE NULLIF(d->>k1,'') IS NOT NULL AND d->>k1=doc->>k2)) LIMIT 1;
    IF pos IS NULL THEN result := result || jsonb_build_array(doc);
    ELSE
      merged := doc || prior;
      FOR field,value IN SELECT * FROM jsonb_each(doc) LOOP
        IF merged->field IS NULL OR merged->field='null'::jsonb OR merged->field='""'::jsonb THEN merged := jsonb_set(merged,ARRAY[field],value); END IF;
      END LOOP;
      SELECT jsonb_agg(DISTINCT u) INTO urls FROM (
        SELECT e.value u FROM jsonb_array_elements(COALESCE(prior->'url_alternativas','[]'::jsonb) || COALESCE(doc->'url_alternativas','[]'::jsonb)) AS e(value)
        UNION ALL SELECT to_jsonb(v) FROM unnest(ARRAY[prior->>'url',prior->>'gcs_url',prior->>'url_origen',doc->>'url',doc->>'gcs_url',doc->>'url_origen']) v WHERE NULLIF(v,'') IS NOT NULL
      ) links WHERE u <> 'null'::jsonb;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(urls,'[]'::jsonb)) u WHERE u IS DISTINCT FROM merged->>'url' AND u IS DISTINCT FROM merged->>'gcs_url' AND u IS DISTINCT FROM merged->>'url_origen') THEN merged := merged || jsonb_build_object('url_alternativas',urls); END IF;
      result := jsonb_set(result,ARRAY[pos::text],merged);
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- Fill absent/empty evidence without replacing protected source text. In
-- particular a stored JSON null indice must not mask an arriving indice.
CREATE OR REPLACE FUNCTION public.act_merge_raw_data(existing jsonb,incoming jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE result jsonb := CASE WHEN jsonb_typeof(existing)='object' THEN existing ELSE '{}'::jsonb END;
  field text; value jsonb;
BEGIN
  IF jsonb_typeof(incoming) IS DISTINCT FROM 'object' THEN RETURN result; END IF;
  FOR field,value IN SELECT * FROM jsonb_each(incoming) LOOP
    IF result->field IS NULL OR result->field='null'::jsonb OR result->field='""'::jsonb THEN
      result := jsonb_set(result,ARRAY[field],value);
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

DROP INDEX public.idx_acts_dedupe_structural;
CREATE UNIQUE INDEX idx_acts_dedupe_structural ON public.work_item_acts
  (work_item_id, canon_normalize_title(canon_strip_title_noise(description)), act_date,
   canon_extract_party(NULL::text,raw_data->>'parte'), COALESCE(recurso_consecutivo,'00'),
   public.act_structural_origin(source,description,raw_data,hash_fingerprint))
  WHERE is_archived=false;

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
  v_affected int;
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
      v_incoming_documentos := public.act_merge_documentos(
        CASE WHEN jsonb_typeof(v_incoming_raw->'documentos')='array' THEN v_incoming_raw->'documentos' ELSE NULL END,
        CASE WHEN jsonb_typeof(rec->'documentos')='array' THEN rec->'documentos' ELSE NULL END
      );

      -- Serializes concurrent insert decisions for this work item. No lock
      -- escapes the RPC transaction and no historical row is re-keyed.
      PERFORM pg_advisory_xact_lock(hashtextextended(rec->>'work_item_id',0));
      SELECT id, description, source, content_hash, sources, raw_data, documentos, fecha_registro_source, inicia_termino
        INTO v_existing
        FROM work_item_acts
        WHERE work_item_id = (rec->>'work_item_id')::uuid
          AND hash_fingerprint = rec->>'hash_fingerprint'
          AND is_archived=false
        FOR UPDATE;

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
          GET DIAGNOSTICS v_affected = ROW_COUNT;
          IF v_affected <> 1 THEN RAISE EXCEPTION 'Act INSERT affected % rows',v_affected USING ERRCODE='P0002'; END IF;
          inserted_count := inserted_count + 1;
          outcomes := outcomes || jsonb_build_array(jsonb_build_object(
            'bucket','INSERTED','title',rec->>'description','fingerprint',rec->>'hash_fingerprint'));
        EXCEPTION WHEN unique_violation THEN
          -- A rejected structural write is never a successful duplicate.
          -- The outer handler reports its SQLSTATE and leaves no partial row.
          RAISE;
        END;

      ELSE
        IF (lower(COALESCE(rec->>'source','')) LIKE 'samai%' OR lower(COALESCE(v_existing.source,'')) LIKE 'samai%')
          AND NOT (
            public.act_origin_relation(public.act_origin_components(v_existing.description,v_existing.raw_data),public.act_origin_components(rec->>'description',v_incoming_raw))='equivalent'
            OR (public.act_origin_components(v_existing.description,v_existing.raw_data)='{}'::jsonb
                AND public.act_origin_components(rec->>'description',v_incoming_raw)='{}'::jsonb
                AND v_existing.description IS NOT DISTINCT FROM rec->>'description')
          ) THEN
          RAISE EXCEPTION 'ACT_ORIGIN_CONFLICT: stale fingerprint or insufficient origin evidence' USING ERRCODE='22023';
        END IF;
        v_existing_sources := COALESCE(v_existing.sources, ARRAY[]::text[]);

        IF v_existing.content_hash IS DISTINCT FROM v_content_hash AND COALESCE(v_existing.content_hash, '') <> '' THEN
          UPDATE work_item_acts SET
            act_type = COALESCE(rec->>'act_type', act_type),
            raw_data = public.act_merge_raw_data(work_item_acts.raw_data,v_incoming_raw) || CASE WHEN public.act_merge_documentos(public.act_merge_documentos(work_item_acts.documentos,work_item_acts.raw_data->'documentos'),v_incoming_documentos) IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('documentos',public.act_merge_documentos(public.act_merge_documentos(work_item_acts.documentos,work_item_acts.raw_data->'documentos'),v_incoming_documentos)) END,
            event_summary = COALESCE(event_summary, rec->>'event_summary'),
            content_hash = v_content_hash,
            changed_at = now(),
            last_seen_at = now(),
            scrape_date = COALESCE((rec->>'scrape_date')::timestamptz, scrape_date),
            fecha_registro_source = COALESCE(work_item_acts.fecha_registro_source, v_incoming_fecha_registro),
            inicia_termino        = COALESCE(work_item_acts.inicia_termino,        v_incoming_inicia_termino),
            documentos = public.act_merge_documentos(public.act_merge_documentos(work_item_acts.documentos,work_item_acts.raw_data->'documentos'),v_incoming_documentos),
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
          GET DIAGNOSTICS v_affected = ROW_COUNT;
          IF v_affected <> 1 THEN RAISE EXCEPTION 'Act UPDATE affected % rows',v_affected USING ERRCODE='P0002'; END IF;
          changed_count := changed_count + 1;
          updated_count := updated_count + 1;
          outcomes := outcomes || jsonb_build_array(jsonb_build_object(
            'bucket','UPDATED','title',rec->>'description','fingerprint',rec->>'hash_fingerprint'));

        ELSE
          UPDATE work_item_acts SET
            last_seen_at = now(),
            scrape_date  = COALESCE((rec->>'scrape_date')::timestamptz, scrape_date),
            raw_data     = public.act_merge_raw_data(work_item_acts.raw_data,v_incoming_raw) || CASE WHEN public.act_merge_documentos(public.act_merge_documentos(work_item_acts.documentos,work_item_acts.raw_data->'documentos'),v_incoming_documentos) IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('documentos',public.act_merge_documentos(public.act_merge_documentos(work_item_acts.documentos,work_item_acts.raw_data->'documentos'),v_incoming_documentos)) END,
            fecha_registro_source = COALESCE(work_item_acts.fecha_registro_source, v_incoming_fecha_registro),
            inicia_termino        = COALESCE(work_item_acts.inicia_termino,        v_incoming_inicia_termino),
            documentos = public.act_merge_documentos(public.act_merge_documentos(work_item_acts.documentos,work_item_acts.raw_data->'documentos'),v_incoming_documentos),
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
          GET DIAGNOSTICS v_affected = ROW_COUNT;
          IF v_affected <> 1 THEN RAISE EXCEPTION 'Act UPDATE affected % rows',v_affected USING ERRCODE='P0002'; END IF;

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
