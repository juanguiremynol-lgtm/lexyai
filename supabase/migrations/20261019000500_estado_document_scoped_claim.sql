-- Controlled document runs may claim only their explicitly selected matters.
-- Existing cron uses the original global function unchanged. No historical
-- document is requeued, and expired rows outside the scope are not touched.
CREATE OR REPLACE FUNCTION public.claim_estado_attachment_downloads_scoped(
  p_work_item_ids uuid[], p_limit integer DEFAULT 1
)
RETURNS SETOF public.estado_attachment_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_work_item_ids IS NULL OR cardinality(p_work_item_ids) NOT BETWEEN 1 AND 2
     OR array_position(p_work_item_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Explicit scope requires one or two work item ids';
  END IF;
  UPDATE public.estado_attachment_queue q
  SET status='failed',last_error=COALESCE(q.last_error,'worker_lease_expired_at_attempt_limit')
  WHERE q.work_item_id=ANY(p_work_item_ids)
    AND EXISTS (SELECT 1 FROM public.work_item_publicaciones p
                WHERE p.id=q.publicacion_id AND p.work_item_id=q.work_item_id AND p.organization_id=q.organization_id)
    AND q.status IN ('pending','downloading') AND q.next_retry_at<=now() AND q.attempt_count>=q.max_attempts;
  RETURN QUERY
  WITH ready AS (
    SELECT q.id FROM public.estado_attachment_queue q
    WHERE q.work_item_id=ANY(p_work_item_ids)
      AND EXISTS (SELECT 1 FROM public.work_item_publicaciones p
                  WHERE p.id=q.publicacion_id AND p.work_item_id=q.work_item_id AND p.organization_id=q.organization_id)
      AND q.status IN ('pending','downloading') AND q.next_retry_at<=now() AND q.attempt_count<q.max_attempts
    ORDER BY q.next_retry_at,q.created_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),10)
  )
  UPDATE public.estado_attachment_queue q
  SET status='downloading',attempt_count=q.attempt_count+1,next_retry_at=now()+interval '3 minutes'
  FROM ready WHERE q.id=ready.id RETURNING q.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_estado_attachment_downloads_scoped(uuid[],integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_estado_attachment_downloads_scoped(uuid[],integer) TO service_role;
