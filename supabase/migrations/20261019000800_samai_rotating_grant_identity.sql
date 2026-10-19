-- Preventive functions only; no historical row update or association deletion.
CREATE OR REPLACE FUNCTION public.act_samai_grant_identity(doc jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE token text:=COALESCE(doc->>'tokenDocumento',doc->>'id'); parts text[]; payload jsonb; encoded text; label text;
BEGIN
 parts:=regexp_split_to_array(token,'[,.]');
 IF cardinality(parts)<>3 THEN RETURN NULL; END IF;
 encoded:=translate(parts[2],'-_','+/');
 payload:=convert_from(decode(encoded||repeat('=',(4-length(encoded)%4)%4),'base64'),'UTF8')::jsonb;
 label:=btrim(COALESCE(NULLIF(doc->>'descripcion',''),doc->>'nombre',''));
 IF COALESCE(payload->>'r','') !~ '^\d{23}$' OR COALESCE(payload->>'h','') !~ '^[a-fA-F0-9]{64}$' OR label='' OR (NULLIF(doc->>'radicado','') IS NOT NULL AND doc->>'radicado'<>payload->>'r') THEN RETURN NULL; END IF;
 RETURN jsonb_build_array(payload->>'r',upper(payload->>'h'),COALESCE(payload->>'dt',''),COALESCE(payload->>'c',''),COALESCE(payload->>'d',''),COALESCE(payload->>'cu',''),label);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.act_same_samai_grant(a jsonb,b jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE left_key jsonb:=public.act_samai_grant_identity(a); right_key jsonb:=public.act_samai_grant_identity(b);
BEGIN
 IF left_key IS NULL OR right_key IS NULL THEN RETURN NULL; END IF;
 IF EXISTS (SELECT 1 FROM unnest(ARRAY['solicitud','indice_actuacion']) k WHERE NULLIF(a->>k,'') IS NOT NULL AND NULLIF(b->>k,'') IS NOT NULL AND regexp_replace(a->>k,'^0+(?=\d)','')<>regexp_replace(b->>k,'^0+(?=\d)','')) THEN RETURN false; END IF;
 IF NULLIF(a->>'id','') IS NOT NULL AND NULLIF(b->>'id','') IS NOT NULL AND a->>'id' IS DISTINCT FROM a->>'tokenDocumento' AND b->>'id' IS DISTINCT FROM b->>'tokenDocumento' AND a->>'id'<>b->>'id' THEN RETURN false; END IF;
 RETURN left_key=right_key;
END;
$$;
CREATE OR REPLACE FUNCTION public.act_merge_documentos(existing jsonb,incoming jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE result jsonb := '[]'::jsonb;
  doc jsonb; prior jsonb; pos int; field text; value jsonb; merged jsonb; urls jsonb;
BEGIN
  IF jsonb_typeof(incoming) IS DISTINCT FROM 'array' THEN RETURN existing; END IF;
  FOR doc IN SELECT * FROM jsonb_array_elements((CASE WHEN jsonb_typeof(existing)='array' THEN existing ELSE '[]'::jsonb END)||incoming) LOOP
    IF jsonb_typeof(doc) <> 'object' THEN CONTINUE; END IF;
    pos := NULL;
    SELECT ord::int-1, d INTO pos,prior FROM jsonb_array_elements(result) WITH ORDINALITY e(d,ord)
    WHERE NOT (NULLIF(d->>'sha256','') IS NOT NULL AND NULLIF(doc->>'sha256','') IS NOT NULL AND d->>'sha256' <> doc->>'sha256')
      AND (public.act_same_samai_grant(d,doc) IS TRUE OR (public.act_same_samai_grant(d,doc) IS NULL AND NOT (NULLIF(d->>'id','') IS NOT NULL AND NULLIF(doc->>'id','') IS NOT NULL AND d->>'id' <> doc->>'id')
      AND (d=doc OR (NULLIF(d->>'id','') IS NOT NULL AND d->>'id'=doc->>'id')
        OR EXISTS (SELECT 1 FROM unnest(ARRAY['url','gcs_url','url_origen']) k1, unnest(ARRAY['url','gcs_url','url_origen']) k2 WHERE NULLIF(d->>k1,'') IS NOT NULL AND d->>k1=doc->>k2)))) LIMIT 1;
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
      IF public.act_same_samai_grant(prior,doc) IS TRUE THEN
        SELECT jsonb_agg(DISTINCT t) INTO urls FROM jsonb_array_elements(COALESCE(prior->'token_aliases','[]'::jsonb)||COALESCE(doc->'token_aliases','[]'::jsonb)||jsonb_build_array(prior->'tokenDocumento',doc->'tokenDocumento')) t WHERE t<>'null'::jsonb;
        merged:=merged||jsonb_build_object('token_aliases',COALESCE(urls,'[]'::jsonb));
      END IF;
      merged := public.act_merge_document_observation(prior,doc,merged);
      result := jsonb_set(result,ARRAY[pos::text],merged);
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

