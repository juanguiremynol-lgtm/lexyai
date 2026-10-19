-- PP's original PDF route encodes the exact native object key. Its processed
-- auto/planilla hashes describe different files and must never be borrowed.
-- Verify this correspondence again against the persisted source record and
-- the owning work item's radicado; caller-supplied proof alone is insufficient.
CREATE OR REPLACE FUNCTION public.pp_public_document_path_matches(p_pub uuid,p_url text,p_proof jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE pub public.work_item_publicaciones; case_radicado text; encoded text; native_path text;
  source_gcs text; layer jsonb; article text; kind text; field text; prefix text; depth integer;
BEGIN
  SELECT p.* INTO pub FROM public.work_item_publicaciones p WHERE p.id=p_pub AND NOT p.is_archived;
  SELECT regexp_replace(w.radicado,'\D','','g') INTO case_radicado FROM public.work_items w WHERE w.id=pub.work_item_id;
  IF pub.source IS DISTINCT FROM 'publicaciones' OR case_radicado !~ '^\d{23}$'
    OR pub.source_radicado IS DISTINCT FROM case_radicado THEN RETURN false; END IF;
  encoded:=substring(p_url from '^https://publicaciones-procesales-api-11974381924\.us-central1\.run\.app/pdf/([A-Za-z0-9_-]+)$');
  IF encoded IS NULL THEN RETURN false; END IF;
  native_path:=convert_from(decode(translate(encoded,'-_','+/')||repeat('=',(4-length(encoded)%4)%4),'base64'),'UTF8');
  IF native_path ~ '[\\%?#]' OR EXISTS(SELECT 1 FROM unnest(string_to_array(native_path,'/')) p WHERE p IN ('','.','..')) THEN RETURN false; END IF;
  source_gcs:='https://storage.googleapis.com/andromeda-pp-documentos-2026/'||native_path;
  layer:=pub.raw_data;
  FOR depth IN 0..3 LOOP
    EXIT WHEN jsonb_typeof(layer) IS DISTINCT FROM 'object';
    article:=COALESCE(NULLIF(layer#>>'{estado,article_id}',''),layer->>'article_id');
    IF article ~ '^\d+$' AND jsonb_typeof(layer->'documentos_pdf')='array' THEN
      FOREACH kind IN ARRAY ARRAY['auto','estado'] LOOP
        field:=CASE WHEN kind='auto' THEN 'gcs_url_pdf_actuacion' ELSE 'gcs_url_pdf_estado' END;
        prefix:=case_radicado||CASE WHEN kind='auto' THEN '/raw/actuaciones/'||article||'/' ELSE '/raw/estados/' END;
        IF layer->>field=source_gcs AND left(native_path,length(prefix))=prefix
          AND substring(native_path from length(prefix)+1) ~* '^[^/]+\.pdf$'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(layer->'documentos_pdf') d WHERE d->>'tipo'=kind AND d->>'pdf_url'=p_url)
          AND p_proof=jsonb_build_object('method','public_source_document_path','case_radicado',case_radicado,
            'article_id',article,'document_kind',kind,'source_gcs_url',source_gcs,'source_path',native_path,'document_url',p_url)
        THEN RETURN true; END IF;
      END LOOP;
    END IF;
    layer:=layer->'raw_data';
  END LOOP;
  RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.pp_public_document_path_matches(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pp_public_document_path_matches(uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_estado_attachment_download(p_id uuid,p_attempt integer,p_patch jsonb,p_primary jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job public.estado_attachment_queue;
BEGIN
  SELECT * INTO job FROM public.estado_attachment_queue WHERE id=p_id FOR UPDATE;
  IF job.id IS NULL OR job.status<>'downloading' OR job.attempt_count<>p_attempt THEN RETURN false; END IF;
  IF p_patch->>'status' NOT IN ('pending','failed','downloaded') THEN RAISE EXCEPTION 'Invalid recovery status'; END IF;
  IF (p_patch #>> '{validation_evidence,queue_id}' IS NOT NULL AND p_patch #>> '{validation_evidence,queue_id}'<>job.id::text)
     OR (p_patch #>> '{validation_evidence,publicacion_id}' IS NOT NULL AND p_patch #>> '{validation_evidence,publicacion_id}'<>job.publicacion_id::text)
     OR (p_patch #>> '{validation_evidence,source_url}' IS NOT NULL AND p_patch #>> '{validation_evidence,source_url}'<>job.remote_url) THEN
    RAISE EXCEPTION 'Recovery evidence belongs to a different document';
  END IF;
  IF NULLIF(p_patch->>'storage_path','') IS NOT NULL AND p_patch->>'storage_path' IS DISTINCT FROM job.storage_path AND (
    p_patch->>'storage_path' IS DISTINCT FROM job.publicacion_id::text||'/'||job.id::text||'/'||(p_patch #>> '{validation_evidence,reading,sha256}')||'.pdf'
    OR p_patch #>> '{validation_evidence,queue_id}' IS DISTINCT FROM job.id::text
    OR p_patch #>> '{validation_evidence,publicacion_id}' IS DISTINCT FROM job.publicacion_id::text
    OR p_patch #>> '{validation_evidence,source_url}' IS DISTINCT FROM job.remote_url) THEN
    RAISE EXCEPTION 'Recovery storage path belongs to a different document';
  END IF;
  IF p_patch->>'status'='downloaded' AND (
    p_patch #>> '{validation_evidence,state}' IS DISTINCT FROM 'verified'
    OR NOT (COALESCE((p_patch #>> '{validation_evidence,correspondence,method}'='source_declared_sha256'
      AND p_patch #>> '{validation_evidence,correspondence,expected_sha256}' ~ '^[a-f0-9]{64}$'
      AND p_patch #>> '{validation_evidence,correspondence,expected_sha256}'=p_patch #>> '{validation_evidence,reading,sha256}'),false)
      OR public.pp_public_document_path_matches(job.publicacion_id,job.remote_url,p_patch #> '{validation_evidence,correspondence}'))
    OR COALESCE((p_patch #>> '{validation_evidence,reading,pages}')::integer,0)<1
    OR p_patch #>> '{validation_evidence,reading,pages}' IS DISTINCT FROM p_patch #>> '{validation_evidence,reading,pagesRead}'
    OR p_patch #>> '{validation_evidence,queue_id}' IS DISTINCT FROM job.id::text
    OR p_patch #>> '{validation_evidence,publicacion_id}' IS DISTINCT FROM job.publicacion_id::text
    OR p_patch #>> '{validation_evidence,source_url}' IS DISTINCT FROM job.remote_url
    OR p_patch->>'storage_path' IS DISTINCT FROM job.publicacion_id::text||'/'||job.id::text||'/'||(p_patch #>> '{validation_evidence,reading,sha256}')||'.pdf') THEN
    RAISE EXCEPTION 'Document validation evidence is incomplete';
  END IF;
  UPDATE public.estado_attachment_queue SET
    status=p_patch->>'status',storage_path=p_patch->>'storage_path',last_error=p_patch->>'last_error',
    downloaded_at=COALESCE(NULLIF(p_patch->>'downloaded_at','')::timestamptz,downloaded_at),
    next_retry_at=COALESCE(NULLIF(p_patch->>'next_retry_at','')::timestamptz,next_retry_at),
    validation_evidence=p_patch->'validation_evidence',validation_checked_at=NULLIF(p_patch->>'validation_checked_at','')::timestamptz
  WHERE id=job.id;
  IF p_primary IS NOT NULL THEN
    IF COALESCE((p_primary->>'available')::boolean,false) AND p_patch->>'status'<>'downloaded' THEN RAISE EXCEPTION 'Unvalidated primary document'; END IF;
    IF COALESCE((p_primary->>'available')::boolean,false) AND p_primary->>'path' IS DISTINCT FROM p_patch->>'storage_path' THEN RAISE EXCEPTION 'Primary path does not match validated document'; END IF;
    IF NOT COALESCE((p_primary->>'available')::boolean,false) AND p_primary->>'path' IS NOT NULL THEN RAISE EXCEPTION 'Unavailable primary must not acquire a new path'; END IF;
    UPDATE public.work_item_publicaciones SET
      pdf_available=COALESCE((p_primary->>'available')::boolean,false),pdf_storage_path=p_primary->>'path'
    WHERE id=job.publicacion_id AND pdf_url=job.remote_url;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_estado_attachment_download(uuid,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_estado_attachment_download(uuid,integer,jsonb,jsonb) TO service_role;
