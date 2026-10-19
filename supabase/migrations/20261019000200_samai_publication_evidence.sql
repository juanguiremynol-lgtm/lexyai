-- Prevent a partial SAMAI estado response from deleting previously observed
-- documents/relationships. This is preventive only: no historical row update.
CREATE OR REPLACE FUNCTION public.samai_publication_merge_evidence(existing jsonb, incoming jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE result jsonb; field text; value jsonb; doc jsonb; prior jsonb; pos integer;
BEGIN
  IF incoming IS NULL OR incoming='null'::jsonb OR incoming='""'::jsonb THEN RETURN existing; END IF;
  IF existing IS NULL OR existing='null'::jsonb THEN RETURN incoming; END IF;
  IF jsonb_typeof(existing)='object' AND jsonb_typeof(incoming)='object' THEN
    -- A structural title/date match is insufficient to merge distinct source
    -- rows. Surface the conflict through the RPC outcome instead of mixing.
    IF NULLIF(existing->>'source_act_id','') IS NOT NULL
       AND NULLIF(incoming->>'source_act_id','') IS NOT NULL
       AND existing->>'source_act_id' <> incoming->>'source_act_id' THEN
      RAISE EXCEPTION 'SAMAI_PUBLICATION_ORIGIN_CONFLICT: % <> %', existing->>'source_act_id', incoming->>'source_act_id';
    END IF;
    result := existing;
    FOR field,value IN SELECT * FROM jsonb_each(incoming) LOOP
      result := jsonb_set(result,ARRAY[field],COALESCE(public.samai_publication_merge_evidence(result->field,value),'null'::jsonb));
    END LOOP;
    RETURN result;
  END IF;
  IF jsonb_typeof(existing)='array' AND jsonb_typeof(incoming)='array' THEN
    result := existing;
    FOR doc IN SELECT * FROM jsonb_array_elements(incoming) LOOP
      pos := NULL;
      SELECT ord::integer-1,d INTO pos,prior
      FROM jsonb_array_elements(result) WITH ORDINALITY e(d,ord)
      WHERE d=doc OR (
        jsonb_typeof(d)='object' AND jsonb_typeof(doc)='object'
        AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['id','id_documento','tokenDocumento']) k
          WHERE NULLIF(d->>k,'') IS NOT NULL AND NULLIF(doc->>k,'') IS NOT NULL AND d->>k<>doc->>k)
        AND (EXISTS (SELECT 1 FROM unnest(ARRAY['id','id_documento','tokenDocumento']) k
            WHERE NULLIF(d->>k,'') IS NOT NULL AND d->>k=doc->>k)
          OR EXISTS (SELECT 1 FROM unnest(ARRAY['url','urlDescarga','url_descarga','urlVer','gcs_url','pdf_url']) a,
             unnest(ARRAY['url','urlDescarga','url_descarga','urlVer','gcs_url','pdf_url']) b
            WHERE NULLIF(d->>a,'') IS NOT NULL AND d->>a=doc->>b))) LIMIT 1;
      IF pos IS NULL THEN result := result || jsonb_build_array(doc);
      ELSE result := jsonb_set(result,ARRAY[pos::text],public.samai_publication_merge_evidence(prior,doc)); END IF;
    END LOOP;
    RETURN result;
  END IF;
  RETURN incoming;
END;
$$;

DO $$
DECLARE definition text; anchor text := 'raw_data = COALESCE(rec->''raw_data'', raw_data),'; replacement text :=
 'raw_data = CASE WHEN work_item_publicaciones.source = ''samai_estados'' AND rec->>''source'' = ''samai_estados'' THEN public.samai_publication_merge_evidence(work_item_publicaciones.raw_data, rec->''raw_data'') ELSE COALESCE(rec->''raw_data'', raw_data) END,';
BEGIN
  SELECT pg_get_functiondef('public.rpc_upsert_work_item_publicaciones(jsonb)'::regprocedure) INTO definition;
  IF position(replacement in definition)>0 THEN RETURN; END IF;
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 THEN
    RAISE EXCEPTION 'Unexpected publicaciones RPC definition; refusing to replace evidence logic';
  END IF;
  EXECUTE replace(definition,anchor,replacement);
END;
$$;
