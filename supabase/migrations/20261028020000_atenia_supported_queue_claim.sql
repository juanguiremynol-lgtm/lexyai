-- Only the supervisor using this RPC claims these actions. Other consumers can
-- keep using the existing RPC; unsupported work remains untouched and visible.
CREATE OR REPLACE FUNCTION public.atenia_ai_claim_supported_queue(_limit integer DEFAULT 5)
RETURNS SETOF public.atenia_ai_remediation_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service only' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.atenia_ai_remediation_queue
    WHERE status = 'PENDING' AND run_after <= now() AND attempts < max_attempts
      AND action_type IN ('RETRY_ACTS','RETRY_PUBS','RETRY_PUBS_HEAVY','RUN_INTEGRATION_HEALTH')
    -- An hour of waiting adds one effective priority point. A fresh ACT
    -- retains its initial priority advantage, but an older PUB eventually
    -- outranks newly arriving ACTs. No stored priority is modified.
    ORDER BY priority + floor(greatest(0, extract(epoch FROM (now()-created_at))) / 3600) DESC,
      created_at ASC, id ASC
    LIMIT greatest(0, least(coalesce(_limit, 5), 5))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.atenia_ai_remediation_queue q
    SET status='RUNNING', attempts=attempts+1, updated_at=now()
  FROM candidates c WHERE q.id=c.id RETURNING q.*;
END $$;
REVOKE ALL ON FUNCTION public.atenia_ai_claim_supported_queue(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atenia_ai_claim_supported_queue(integer) TO service_role;

-- A dry-run uses the same eligibility and aged priority without acquiring a
-- lease or incrementing an attempt. Concurrent workers may change the queue
-- between preview and claim, so the preview is not a reservation.
CREATE OR REPLACE FUNCTION public.atenia_ai_preview_supported_queue(_limit integer DEFAULT 5)
RETURNS SETOF public.atenia_ai_remediation_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service only' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT q.* FROM public.atenia_ai_remediation_queue q
  WHERE status='PENDING' AND run_after<=now() AND attempts<max_attempts
    AND action_type IN ('RETRY_ACTS','RETRY_PUBS','RETRY_PUBS_HEAVY','RUN_INTEGRATION_HEALTH')
  ORDER BY priority + floor(greatest(0, extract(epoch FROM (now()-created_at))) / 3600) DESC,
    created_at ASC, id ASC
  LIMIT greatest(0, least(coalesce(_limit, 5), 5));
END $$;
REVOKE ALL ON FUNCTION public.atenia_ai_preview_supported_queue(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atenia_ai_preview_supported_queue(integer) TO service_role;
