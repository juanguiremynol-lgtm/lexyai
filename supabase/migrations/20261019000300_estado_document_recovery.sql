-- Preventive queue changes only; no historical job or document is rerun here.
ALTER TABLE public.estado_attachment_queue
  ADD COLUMN IF NOT EXISTS validation_evidence jsonb,
  ADD COLUMN IF NOT EXISTS validation_checked_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_estado_attachment_downloads(p_limit integer DEFAULT 1)
RETURNS SETOF public.estado_attachment_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  -- A crashed final attempt is terminal once its lease expires.
  UPDATE public.estado_attachment_queue
  SET status='failed',last_error=COALESCE(last_error,'worker_lease_expired_at_attempt_limit')
  WHERE status IN ('pending','downloading') AND next_retry_at<=now() AND attempt_count>=max_attempts;
  RETURN QUERY
  WITH ready AS (
    SELECT id FROM public.estado_attachment_queue
    WHERE status IN ('pending','downloading') AND next_retry_at<=now() AND attempt_count<max_attempts
    ORDER BY next_retry_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),10)
  )
  UPDATE public.estado_attachment_queue q
  SET status='downloading',attempt_count=q.attempt_count+1,next_retry_at=now()+interval '3 minutes'
  FROM ready WHERE q.id=ready.id RETURNING q.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_estado_attachment_downloads(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_estado_attachment_downloads(integer) TO service_role;

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
    OR NULLIF(p_patch #>> '{validation_evidence,correspondence,expected_sha256}','') IS NULL
    OR p_patch #>> '{validation_evidence,correspondence,expected_sha256}' IS DISTINCT FROM p_patch #>> '{validation_evidence,reading,sha256}'
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
