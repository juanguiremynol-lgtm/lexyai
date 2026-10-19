-- Preventive only: preserve current document observations across both RPC and
-- conditional enrichment. No historical row, protected act text or origin changes.
CREATE OR REPLACE FUNCTION public.act_observation_at(doc jsonb)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE value text;
BEGIN
  value:=COALESCE(NULLIF(doc->>'descarga_observado_en',''),NULLIF(doc->>'observado_en',''),
    doc #>> '{descarga_intentos,-1,observado_en}',doc #>> '{intentos,-1,observado_en}',doc #>> '{pdf_verificacion,verificado_en}');
  IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}T' THEN RETURN NULL; END IF;
  RETURN value::timestamptz;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.act_document_history(values_json jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE result jsonb:='[]'::jsonb; candidate jsonb;
BEGIN
  FOR candidate IN SELECT * FROM jsonb_array_elements(COALESCE(values_json,'[]'::jsonb)) LOOP
    IF jsonb_typeof(candidate)<>'object' THEN CONTINUE; END IF;
    candidate:=candidate-'metadata_variants';
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result) v WHERE v=candidate) THEN result:=result||jsonb_build_array(candidate); END IF;
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.act_current_copy_invalidated(prior jsonb,doc jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE cache jsonb:=doc->'recuperacion_cache'; fact jsonb; facts jsonb; checked timestamptz; previous_at timestamptz:=public.act_observation_at(prior);
BEGIN
  facts:=jsonb_build_array(jsonb_build_object('cacheIssue',cache->>'cacheIssue','cachedObjectUrl',cache->>'cachedObjectUrl',
    'observado_en',COALESCE(cache->>'cacheObservedAt',doc->>'descarga_observado_en',doc #>> '{descarga_intentos,-1,observado_en}')));
  IF jsonb_typeof(cache->'knownInvalidCopies')='array' THEN
    FOR fact IN SELECT * FROM jsonb_array_elements(cache->'knownInvalidCopies') LOOP
      facts:=facts||jsonb_build_array(fact||jsonb_build_object('observado_en',fact->>'observedAt'));
    END LOOP;
  END IF;
  FOR fact IN SELECT * FROM jsonb_array_elements(facts) LOOP
    checked:=public.act_observation_at(fact);
    IF fact->>'cacheIssue'=ANY(ARRAY['stored_object_missing','stored_hash_mismatch','stored_pdf_invalid'])
      AND NULLIF(fact->>'cachedObjectUrl','') IS NOT NULL
      AND fact->>'cachedObjectUrl'=ANY(ARRAY[prior->>'gcs_url',prior->>'urlDescarga',prior->>'urlVer',prior->>'url'])
      AND (previous_at IS NULL OR checked>previous_at) THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.act_merge_document_observation(prior jsonb,doc jsonb,merged jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE before_at timestamptz:=public.act_observation_at(prior); incoming_at timestamptz:=public.act_observation_at(doc);
  fields text[]:=ARRAY['gcs','gcs_url','sha256','pdf_verificacion','descarga_estado','descarga_error','descarga_intentos','descarga_observado_en','recuperacion_cache','disponible','url','urlDescarga','urlVer'];
  field text; variants jsonb; verified boolean; previous_verified boolean; source_url text;
BEGIN
  IF before_at IS NULL AND incoming_at IS NULL THEN RETURN merged; END IF;
  variants:=public.act_document_history(COALESCE(prior->'metadata_variants','[]'::jsonb)||COALESCE(doc->'metadata_variants','[]'::jsonb));
  IF incoming_at IS NULL OR (before_at IS NOT NULL AND incoming_at<before_at) THEN
    FOREACH field IN ARRAY fields LOOP
      IF prior ? field THEN merged:=jsonb_set(merged,ARRAY[field],prior->field); ELSE merged:=merged-field; END IF;
    END LOOP;
    IF incoming_at IS NOT NULL THEN variants:=public.act_document_history(variants||jsonb_build_array(doc)); END IF;
  ELSE
    FOREACH field IN ARRAY ARRAY['descarga_estado','descarga_error','descarga_intentos','descarga_observado_en','recuperacion_cache'] LOOP
      IF doc ? field THEN merged:=jsonb_set(merged,ARRAY[field],doc->field); ELSE merged:=merged-field; END IF;
    END LOOP;
    verified:=doc->>'descarga_estado'='descargado_y_leido' AND jsonb_typeof(doc->'pdf_verificacion')='object'
      AND COALESCE(NULLIF(doc->>'gcs_url',''),NULLIF(doc->>'urlDescarga',''),NULLIF(doc->>'url','')) IS NOT NULL;
    previous_verified:=prior->>'descarga_estado'='descargado_y_leido' AND jsonb_typeof(prior->'pdf_verificacion')='object'
      AND COALESCE(NULLIF(prior->>'gcs_url',''),NULLIF(prior->>'urlDescarga',''),NULLIF(prior->>'url','')) IS NOT NULL;
    IF COALESCE(verified,false) THEN
      FOREACH field IN ARRAY fields LOOP
        IF doc ? field THEN merged:=jsonb_set(merged,ARRAY[field],doc->field); ELSE merged:=merged-field; END IF;
      END LOOP;
      source_url:=COALESCE(NULLIF(doc->>'gcs_url',''),NULLIF(doc->>'urlDescarga',''),doc->>'url');
      merged:=(merged-'descarga_error')||jsonb_build_object('gcs',true,'gcs_url',source_url,'url',source_url,
        'urlDescarga',source_url,'urlVer',COALESCE(NULLIF(doc->>'urlVer',''),source_url),'disponible',true);
    ELSIF COALESCE(previous_verified,false) AND NOT public.act_current_copy_invalidated(prior,doc) THEN
      FOREACH field IN ARRAY ARRAY['gcs','gcs_url','sha256','pdf_verificacion','descarga_estado','disponible','url','urlDescarga','urlVer'] LOOP
        IF prior ? field THEN merged:=jsonb_set(merged,ARRAY[field],prior->field); ELSE merged:=merged-field; END IF;
      END LOOP;
    ELSE
      source_url:=COALESCE(NULLIF(doc->>'url_origen',''),NULLIF(doc->>'urlDescargaOriginal',''),NULLIF(doc->>'urlDescarga',''),NULLIF(doc->>'url',''));
      merged:=(merged-'sha256'-'pdf_verificacion')||jsonb_build_object('gcs',false,'gcs_url',NULL,'url',source_url,
        'urlDescarga',source_url,'urlVer',COALESCE(NULLIF(doc->>'urlVerOriginal',''),source_url),'disponible',false);
    END IF;
    IF EXISTS(SELECT 1 FROM unnest(fields) k WHERE prior->k IS DISTINCT FROM merged->k) THEN
      variants:=public.act_document_history(variants||jsonb_build_array(prior));
    END IF;
  END IF;
  IF jsonb_array_length(variants)>0 THEN merged:=merged||jsonb_build_object('metadata_variants',variants); END IF;
  RETURN merged;
END;
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
      merged := public.act_merge_document_observation(prior,doc,merged);
      result := jsonb_set(result,ARRAY[pos::text],merged);
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.act_merge_raw_data(existing jsonb,incoming jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE result jsonb:=CASE WHEN jsonb_typeof(existing)='object' THEN existing ELSE '{}'::jsonb END;
  field text; value jsonb; previous jsonb; observation jsonb; variants jsonb; old_at timestamptz; new_at timestamptz;
BEGIN
  IF jsonb_typeof(incoming) IS DISTINCT FROM 'object' THEN RETURN result; END IF;
  previous:=result->'anexos_observacion'; observation:=incoming->'anexos_observacion';
  FOR field,value IN SELECT * FROM jsonb_each(incoming) LOOP
    IF result->field IS NULL OR result->field='null'::jsonb OR result->field='""'::jsonb THEN result:=jsonb_set(result,ARRAY[field],value); END IF;
  END LOOP;
  IF jsonb_typeof(observation)='object' THEN
    old_at:=public.act_observation_at(previous); new_at:=public.act_observation_at(observation);
    variants:=CASE WHEN jsonb_typeof(existing->'anexos_observacion_historial')='array' THEN existing->'anexos_observacion_historial' ELSE '[]'::jsonb END;
    IF previous IS NULL OR previous='null'::jsonb OR (new_at IS NOT NULL AND (old_at IS NULL OR new_at>old_at)) THEN
      IF previous IS NOT NULL AND previous<>'null'::jsonb AND previous<>observation THEN variants:=public.act_document_history(variants||jsonb_build_array(previous)); END IF;
      result:=result||jsonb_build_object('anexos_observacion',observation);
    ELSIF previous<>observation THEN variants:=public.act_document_history(variants||jsonb_build_array(observation)); END IF;
    IF jsonb_array_length(variants)>0 THEN result:=result||jsonb_build_object('anexos_observacion_historial',variants); END IF;
  END IF;
  RETURN result;
END;
$$;
