CREATE OR REPLACE FUNCTION public.finish_estado_attachment_download(p_id uuid, p_attempt integer, p_patch jsonb, p_primary jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      OR public.pp_public_document_path_matches(job.publicacion_id,job.remote_url,p_patch #> '{validation_evidence,correspondence}')
      OR COALESCE((p_patch #>> '{validation_evidence,correspondence,method}'='official_portal_recovery'
        AND p_patch #>> '{validation_evidence,correspondence,expected_sha256}' ~ '^[a-f0-9]{64}$'
        AND p_patch #>> '{validation_evidence,correspondence,expected_sha256}'=p_patch #>> '{validation_evidence,reading,sha256}'
        AND job.remote_url LIKE 'https://publicacionesprocesales.ramajudicial.gov.co/c/document_library/get_file?%'
        AND EXISTS (SELECT 1 FROM public.work_item_publicaciones wp WHERE wp.id=job.publicacion_id
          AND wp.raw_data->'recuperacion_oficial' @> jsonb_build_array(jsonb_build_object('url',job.remote_url,'sha256',p_patch #>> '{validation_evidence,correspondence,expected_sha256}')))),false))
    OR COALESCE((p_patch #>> '{validation_evidence,reading,pages}')::integer,0)<1
    OR (p_patch #>> '{validation_evidence,reading,pages}' IS DISTINCT FROM p_patch #>> '{validation_evidence,reading,pagesRead}'
      -- Multi-providencia package (official recovery): only the declared case
      -- pages are parsed; the whole-file SHA still binds the exact original.
      AND NOT COALESCE((p_patch #>> '{validation_evidence,correspondence,method}'='official_portal_recovery'
        AND p_patch #>> '{validation_evidence,paquete,verificado}'='true'
        AND COALESCE((p_patch #>> '{validation_evidence,reading,pagesRead}')::integer,0)>=1
        AND EXISTS (SELECT 1 FROM public.work_item_publicaciones wp WHERE wp.id=job.publicacion_id
          AND wp.raw_data->'recuperacion_oficial' @> jsonb_build_array(jsonb_build_object('url',job.remote_url,
            'paquete',jsonb_build_object('radicado',p_patch #>> '{validation_evidence,paquete,radicado}',
              'paginas_caso',p_patch #> '{validation_evidence,paquete,paginas_declaradas}'))))),false))
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
$function$;