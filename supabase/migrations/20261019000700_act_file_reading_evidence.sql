-- Preserve separately named ZIP/XLSX reading proof; it is never PDF evidence.
-- Preventive only; no historical row update.
CREATE OR REPLACE FUNCTION public.act_merge_document_observation(prior jsonb,doc jsonb,merged jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE before_at timestamptz:=public.act_observation_at(prior); incoming_at timestamptz:=public.act_observation_at(doc);
  fields text[]:=ARRAY['gcs','gcs_url','sha256','pdf_verificacion','archivo_verificacion','descarga_estado','descarga_error','descarga_intentos','descarga_observado_en','recuperacion_cache','disponible','url','urlDescarga','urlVer'];
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
    verified:=doc->>'descarga_estado'='descargado_y_leido' AND (jsonb_typeof(doc->'pdf_verificacion')='object' OR (doc#>>'{archivo_verificacion,lectura_completa}'='true' AND doc#>>'{archivo_verificacion,crc_comprobado}'='true' AND doc#>>'{archivo_verificacion,formato}' IN ('zip','xlsx')))
      AND COALESCE(NULLIF(doc->>'gcs_url',''),NULLIF(doc->>'urlDescarga',''),NULLIF(doc->>'url','')) IS NOT NULL;
    previous_verified:=prior->>'descarga_estado'='descargado_y_leido' AND (jsonb_typeof(prior->'pdf_verificacion')='object' OR (prior#>>'{archivo_verificacion,lectura_completa}'='true' AND prior#>>'{archivo_verificacion,crc_comprobado}'='true' AND prior#>>'{archivo_verificacion,formato}' IN ('zip','xlsx')))
      AND COALESCE(NULLIF(prior->>'gcs_url',''),NULLIF(prior->>'urlDescarga',''),NULLIF(prior->>'url','')) IS NOT NULL;
    IF COALESCE(verified,false) THEN
      FOREACH field IN ARRAY fields LOOP
        IF doc ? field THEN merged:=jsonb_set(merged,ARRAY[field],doc->field); ELSE merged:=merged-field; END IF;
      END LOOP;
      source_url:=COALESCE(NULLIF(doc->>'gcs_url',''),NULLIF(doc->>'urlDescarga',''),doc->>'url');
      merged:=(merged-'descarga_error')||jsonb_build_object('gcs',true,'gcs_url',source_url,'url',source_url,
        'urlDescarga',source_url,'urlVer',COALESCE(NULLIF(doc->>'urlVer',''),source_url),'disponible',true);
    ELSIF COALESCE(previous_verified,false) AND NOT public.act_current_copy_invalidated(prior,doc) THEN
      FOREACH field IN ARRAY ARRAY['gcs','gcs_url','sha256','pdf_verificacion','archivo_verificacion','descarga_estado','disponible','url','urlDescarga','urlVer'] LOOP
        IF prior ? field THEN merged:=jsonb_set(merged,ARRAY[field],prior->field); ELSE merged:=merged-field; END IF;
      END LOOP;
    ELSE
      source_url:=COALESCE(NULLIF(doc->>'url_origen',''),NULLIF(doc->>'urlDescargaOriginal',''),NULLIF(doc->>'urlDescarga',''),NULLIF(doc->>'url',''));
      merged:=(merged-'sha256'-'pdf_verificacion'-'archivo_verificacion')||jsonb_build_object('gcs',false,'gcs_url',NULL,'url',source_url,
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
